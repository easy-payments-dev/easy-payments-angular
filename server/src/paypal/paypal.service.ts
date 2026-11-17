import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { formatMajorAmount, getCatalogProduct } from '../catalog/product-catalog';
import { acceptPayPalOrderReference } from '../metadata/merchant-metadata';
import { CreatePayPalOrderDto } from './dto/create-paypal-order.dto';
import { CreateVenmoHandoffDto } from './dto/create-venmo-handoff.dto';
import { CompleteVenmoHandoffDto } from './dto/complete-venmo-handoff.dto';
import { VenmoAttemptStore } from './venmo-attempt.store';

export interface CreatePayPalOrderResult {
  provider: 'paypal';
  orderId: string;
}

export interface CapturePayPalOrderResult {
  provider: 'paypal';
  orderId: string;
  captureId: string;
  status: string;
}

export interface PayPalOrderStatusResult {
  provider: 'paypal';
  orderId: string;
  status: string;
  captureId?: string;
}

export interface PayPalOrderLinkSummary {
  rel: string;
  href: string;
  method?: string;
}

export interface CreateVenmoHandoffResult {
  provider: 'paypal';
  funding: 'venmo';
  attemptId: string;
  orderId: string;
  status: string;
  /** HATEOAS links from the create-order response (as returned by Sandbox). */
  links: PayPalOrderLinkSummary[];
  /**
   * Buyer approval URL when PayPal returns rel=payer-action or rel=approve.
   * Sandbox Venmo create currently returns only rel=self — then null.
   */
  approvalUrl: string | null;
  handoff: 'approval_url' | 'official_button';
  product: {
    productId: string;
    name: string;
    quantity: number;
    amount: string;
    currency: string;
  };
}

export interface CompleteVenmoHandoffResult {
  provider: 'paypal';
  funding: 'venmo';
  attemptId: string;
  orderId: string;
  status: string;
  captureId?: string;
  /** True when capture was already COMPLETED before this call. */
  idempotent: boolean;
}

interface PayPalAccessTokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

interface PayPalOrderResponse {
  id?: string;
  status?: string;
  links?: Array<{ rel?: string; href?: string; method?: string }>;
  purchase_units?: Array<{
    payments?: {
      captures?: Array<{ id?: string; status?: string }>;
    };
  }>;
  message?: string;
  details?: Array<{ issue?: string; description?: string }>;
  name?: string;
}

@Injectable()
export class PayPalService {
  private readonly logger = new Logger(PayPalService.name);
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly apiBase: string;
  private readonly configured: boolean;

  private cachedToken: string | null = null;
  private tokenExpiresAt = 0;

  constructor(
    private readonly config: ConfigService,
    private readonly venmoAttempts: VenmoAttemptStore,
  ) {
    this.clientId = this.config.get<string>('PAYPAL_CLIENT_ID')?.trim() ?? '';
    this.clientSecret = this.config.get<string>('PAYPAL_CLIENT_SECRET')?.trim() ?? '';
    const mode = (this.config.get<string>('PAYPAL_MODE')?.trim() || 'sandbox').toLowerCase();

    this.apiBase =
      mode === 'live'
        ? 'https://api-m.paypal.com'
        : 'https://api-m.sandbox.paypal.com';

    this.configured = !!(this.clientId && this.clientSecret);

    if (!this.configured) {
      this.logger.warn(
        'PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET are not configured. PayPal order APIs will fail.',
      );
    } else if (mode === 'live') {
      this.logger.warn(
        'PAYPAL_MODE=live is set. This demo server is intended for Sandbox testing only.',
      );
    }
  }

  async createOrder(dto: CreatePayPalOrderDto): Promise<CreatePayPalOrderResult> {
    this.ensureConfigured();

    const product = getCatalogProduct(dto.productId);
    if (!product) {
      throw new BadRequestException(
        `Unknown productId "${dto.productId}". Use a catalog product (e.g. premium-plan).`,
      );
    }

    if (dto.currency && dto.currency.toUpperCase() !== product.currency) {
      throw new BadRequestException(
        `Currency mismatch: catalog product uses ${product.currency}, got ${dto.currency}.`,
      );
    }

    const total = Number((product.unitAmount * dto.quantity).toFixed(2));
    if (!Number.isFinite(total) || total < 0.01) {
      throw new BadRequestException('Computed order amount is invalid.');
    }

    const orderReference = acceptPayPalOrderReference(dto.orderReference);
    const customId = orderReference ?? product.id.slice(0, 127);

    const body = {
      intent: 'CAPTURE',
      purchase_units: [
        {
          reference_id: product.id,
          description: product.name,
          custom_id: customId,
          amount: {
            currency_code: product.currency,
            value: formatMajorAmount(total),
            breakdown: {
              item_total: {
                currency_code: product.currency,
                value: formatMajorAmount(total),
              },
            },
          },
          items: [
            {
              name: product.name.slice(0, 127),
              description: product.description.slice(0, 127),
              quantity: String(dto.quantity),
              unit_amount: {
                currency_code: product.currency,
                value: formatMajorAmount(product.unitAmount),
              },
              category: 'DIGITAL_GOODS',
            },
          ],
        },
      ],
    };

    try {
      const order = await this.paypalRequest<PayPalOrderResponse>('POST', '/v2/checkout/orders', body);

      if (!order.id) {
        throw new InternalServerErrorException('PayPal did not return an order id.');
      }

      return {
        provider: 'paypal',
        orderId: order.id,
      };
    } catch (error) {
      this.rethrowPayPalError(error, 'Failed to create PayPal order.');
    }
  }

  /**
   * Ionic smoke: create Orders v2 with payment_source.venmo, bind attempt↔order,
   * and surface any documented buyer approval link PayPal returns.
   */
  async createVenmoHandoff(dto: CreateVenmoHandoffDto): Promise<CreateVenmoHandoffResult> {
    this.ensureConfigured();

    const product = getCatalogProduct(dto.productId);
    if (!product) {
      throw new BadRequestException(
        `Unknown productId "${dto.productId}". Use a catalog product (e.g. premium-plan).`,
      );
    }

    const quantity = dto.quantity ?? 1;
    const total = Number((product.unitAmount * quantity).toFixed(2));
    if (!Number.isFinite(total) || total < 0.01) {
      throw new BadRequestException('Computed order amount is invalid.');
    }

    const amount = formatMajorAmount(total);
    const attemptId = dto.attemptId.trim();
    const returnUrl = dto.returnUrl.trim();
    const cancelUrl = dto.cancelUrl.trim();
    this.assertHttpsAbsoluteUrl(returnUrl, 'returnUrl');
    this.assertHttpsAbsoluteUrl(cancelUrl, 'cancelUrl');

    const body = {
      intent: 'CAPTURE',
      payment_source: {
        venmo: {
          experience_context: {
            brand_name: 'EP Ionic Smoke',
            shipping_preference: 'NO_SHIPPING',
            user_action: 'PAY_NOW',
            // Documented in PayPal Save-Venmo / Orders v2 experience_context patterns.
            return_url: returnUrl,
            cancel_url: cancelUrl,
          },
        },
      },
      purchase_units: [
        {
          reference_id: product.id,
          description: product.name,
          custom_id: attemptId.slice(0, 127),
          amount: {
            currency_code: product.currency,
            value: amount,
            breakdown: {
              item_total: {
                currency_code: product.currency,
                value: amount,
              },
            },
          },
          items: [
            {
              name: product.name.slice(0, 127),
              description: product.description.slice(0, 127),
              quantity: String(quantity),
              unit_amount: {
                currency_code: product.currency,
                value: formatMajorAmount(product.unitAmount),
              },
              category: 'DIGITAL_GOODS',
            },
          ],
        },
      ],
    };

    try {
      const order = await this.paypalRequest<PayPalOrderResponse>(
        'POST',
        '/v2/checkout/orders',
        body,
        {
          Prefer: 'return=representation',
          'PayPal-Request-Id': `ep-venmo-handoff-${attemptId}-${Date.now()}`,
        },
      );

      if (!order.id) {
        throw new InternalServerErrorException('PayPal did not return a Venmo order id.');
      }

      const links = this.summarizeLinks(order.links);
      const approvalUrl = this.pickBuyerApprovalUrl(links);
      const handoff = approvalUrl ? 'approval_url' : 'official_button';

      this.venmoAttempts.put({
        attemptId,
        orderId: order.id,
        productId: product.id,
        productName: product.name,
        quantity,
        amount,
        currency: product.currency,
        returnUrl,
        cancelUrl,
        createdAt: Date.now(),
        lastStatus: order.status,
      });

      this.logger.log(
        `Venmo handoff create attempt=${attemptId} order=${order.id} status=${order.status ?? 'UNKNOWN'} links=${links.map((l) => l.rel).join(',') || 'none'} handoff=${handoff}`,
      );

      return {
        provider: 'paypal',
        funding: 'venmo',
        attemptId,
        orderId: order.id,
        status: order.status ?? 'UNKNOWN',
        links,
        approvalUrl,
        handoff,
        product: {
          productId: product.id,
          name: product.name,
          quantity,
          amount,
          currency: product.currency,
        },
      };
    } catch (error) {
      this.rethrowPayPalError(error, 'Failed to create Venmo handoff order.');
    }
  }

  /**
   * Reconcile attempt↔order, capture when APPROVED, idempotent when already COMPLETED.
   */
  async completeVenmoHandoff(dto: CompleteVenmoHandoffDto): Promise<CompleteVenmoHandoffResult> {
    this.ensureConfigured();

    const attemptId = dto.attemptId.trim();
    const orderId = dto.orderId.trim();
    const binding = this.venmoAttempts.getByAttempt(attemptId);
    if (!binding) {
      throw new BadRequestException('Unknown Venmo attempt — open Continue with Venmo again.');
    }
    if (binding.orderId !== orderId) {
      throw new BadRequestException('PayPal order does not match the bound Venmo attempt.');
    }

    const status = await this.getOrderStatus(orderId);
    if (status.status === 'COMPLETED' && status.captureId) {
      this.venmoAttempts.patch(attemptId, {
        captureId: status.captureId,
        lastStatus: status.status,
      });
      return {
        provider: 'paypal',
        funding: 'venmo',
        attemptId,
        orderId,
        status: status.status,
        captureId: status.captureId,
        idempotent: true,
      };
    }

    // Buyer must have approved before capture (approval ≠ capture).
    if (status.status !== 'APPROVED' && status.status !== 'COMPLETED') {
      throw new BadRequestException(
        `Venmo order is not ready to capture (status=${status.status}).`,
      );
    }

    const captured = await this.captureOrder(orderId);
    this.venmoAttempts.patch(attemptId, {
      captureId: captured.captureId,
      lastStatus: captured.status,
    });

    return {
      provider: 'paypal',
      funding: 'venmo',
      attemptId,
      orderId: captured.orderId,
      status: captured.status,
      captureId: captured.captureId,
      idempotent: false,
    };
  }

  getVenmoAttempt(attemptId: string) {
    const binding = this.venmoAttempts.getByAttempt(attemptId);
    if (!binding) {
      throw new BadRequestException('Unknown Venmo attempt.');
    }
    return {
      provider: 'paypal' as const,
      funding: 'venmo' as const,
      attemptId: binding.attemptId,
      orderId: binding.orderId,
      product: {
        productId: binding.productId,
        name: binding.productName,
        quantity: binding.quantity,
        amount: binding.amount,
        currency: binding.currency,
      },
      captureId: binding.captureId,
      lastStatus: binding.lastStatus,
    };
  }

  /**
   * Verifies a PayPal webhook using the official verify-webhook-signature API.
   * Returns false on FAILURE. Throws on transport / config errors.
   */
  async verifyWebhookSignature(input: {
    authAlgo: string;
    certUrl: string;
    transmissionId: string;
    transmissionSig: string;
    transmissionTime: string;
    webhookId: string;
    webhookEvent: unknown;
  }): Promise<boolean> {
    this.ensureConfigured();

    const body = {
      auth_algo: input.authAlgo,
      cert_url: input.certUrl,
      transmission_id: input.transmissionId,
      transmission_sig: input.transmissionSig,
      transmission_time: input.transmissionTime,
      webhook_id: input.webhookId,
      webhook_event: input.webhookEvent,
    };

    try {
      const result = await this.paypalRequest<{ verification_status?: string }>(
        'POST',
        '/v1/notifications/verify-webhook-signature',
        body,
      );
      return result.verification_status === 'SUCCESS';
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof ServiceUnavailableException ||
        error instanceof InternalServerErrorException
      ) {
        throw error;
      }
      this.logger.error('PayPal webhook verification request failed.');
      throw new InternalServerErrorException('PayPal webhook verification failed.');
    }
  }

  /**
   * Read-only order status for App Link / leave-app return verification.
   * Never treat a deep link as success without this (or an equivalent) check.
   */
  async getOrderStatus(orderId: string): Promise<PayPalOrderStatusResult> {
    this.ensureConfigured();

    const id = orderId?.trim();
    if (!id) {
      throw new BadRequestException('orderId is required.');
    }

    try {
      const order = await this.paypalRequest<PayPalOrderResponse>(
        'GET',
        `/v2/checkout/orders/${encodeURIComponent(id)}`,
      );
      const capture = order.purchase_units?.[0]?.payments?.captures?.[0];
      const captureId = capture?.id?.trim();
      return {
        provider: 'paypal',
        orderId: order.id ?? id,
        status: capture?.status ?? order.status ?? 'UNKNOWN',
        ...(captureId ? { captureId } : {}),
      };
    } catch (error) {
      this.rethrowPayPalError(error, 'Failed to load PayPal order status.');
    }
  }

  async captureOrder(orderId: string): Promise<CapturePayPalOrderResult> {
    this.ensureConfigured();

    const id = orderId?.trim();
    if (!id) {
      throw new BadRequestException('orderId is required.');
    }

    // Idempotent: already-captured orders must not create a second capture.
    try {
      const existing = await this.getOrderStatus(id);
      if (existing.status === 'COMPLETED' && existing.captureId) {
        return {
          provider: 'paypal',
          orderId: existing.orderId,
          captureId: existing.captureId,
          status: existing.status,
        };
      }
    } catch {
      // Fall through to capture — getOrderStatus errors are uncommon here.
    }

    try {
      const order = await this.paypalRequest<PayPalOrderResponse>(
        'POST',
        `/v2/checkout/orders/${encodeURIComponent(id)}/capture`,
        {},
      );

      const capture = order.purchase_units?.[0]?.payments?.captures?.[0];
      const captureId = capture?.id;
      const status = capture?.status ?? order.status ?? 'UNKNOWN';

      if (!captureId) {
        // ORDER_ALREADY_CAPTURED-style responses: re-read status.
        const again = await this.getOrderStatus(id);
        if (again.status === 'COMPLETED' && again.captureId) {
          return {
            provider: 'paypal',
            orderId: again.orderId,
            captureId: again.captureId,
            status: again.status,
          };
        }
        throw new InternalServerErrorException(
          'PayPal capture completed without a capture id. The order may be in an invalid state.',
        );
      }

      return {
        provider: 'paypal',
        orderId: order.id ?? id,
        captureId,
        status,
      };
    } catch (error) {
      if (
        error instanceof BadRequestException &&
        /already.?captured|ORDER_ALREADY_CAPTURED/i.test(String(error.message))
      ) {
        const again = await this.getOrderStatus(id);
        if (again.status === 'COMPLETED' && again.captureId) {
          return {
            provider: 'paypal',
            orderId: again.orderId,
            captureId: again.captureId,
            status: again.status,
          };
        }
      }
      this.rethrowPayPalError(error, 'Failed to capture PayPal order.');
    }
  }

  private ensureConfigured(): void {
    if (!this.configured) {
      throw new ServiceUnavailableException(
        'PayPal is not configured. Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET in server/.env',
      );
    }
  }

  private async getAccessToken(): Promise<string> {
    const now = Date.now();
    if (this.cachedToken && now < this.tokenExpiresAt - 30_000) {
      return this.cachedToken;
    }

    const auth = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
    const response = await fetch(`${this.apiBase}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });

    const payload = (await response.json()) as PayPalAccessTokenResponse;

    if (!response.ok || !payload.access_token) {
      this.logger.error(
        `PayPal OAuth failed: ${payload.error ?? response.status} ${payload.error_description ?? ''}`.trim(),
      );
      throw new ServiceUnavailableException('Failed to authenticate with PayPal.');
    }

    this.cachedToken = payload.access_token;
    this.tokenExpiresAt = now + (payload.expires_in ?? 300) * 1000;
    return this.cachedToken;
  }

  private async paypalRequest<T>(
    method: 'POST' | 'GET',
    path: string,
    body?: unknown,
    extraHeaders?: Record<string, string>,
  ): Promise<T> {
    const token = await this.getAccessToken();
    const response = await fetch(`${this.apiBase}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(extraHeaders ?? {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    const payload = (await response.json().catch(() => ({}))) as T & PayPalOrderResponse;

    if (!response.ok) {
      const detail =
        payload.details?.[0]?.description ||
        payload.message ||
        payload.name ||
        `PayPal API error (${response.status})`;

      this.logger.error(`PayPal ${method} ${path} failed: ${detail}`);

      if (response.status >= 400 && response.status < 500) {
        throw new BadRequestException(detail);
      }

      throw new InternalServerErrorException('PayPal API request failed.');
    }

    return payload;
  }

  private summarizeLinks(
    links: PayPalOrderResponse['links'] | undefined,
  ): PayPalOrderLinkSummary[] {
    if (!Array.isArray(links)) {
      return [];
    }
    return links
      .filter((l): l is { rel: string; href: string; method?: string } => !!l?.rel && !!l?.href)
      .map((l) => ({
        rel: l.rel,
        href: l.href,
        ...(l.method ? { method: l.method } : {}),
      }));
  }

  /** Prefer documented payer-action (with payment_source) then approve. Never invent URLs. */
  private pickBuyerApprovalUrl(links: PayPalOrderLinkSummary[]): string | null {
    const payerAction = links.find((l) => l.rel === 'payer-action');
    if (payerAction?.href) {
      return payerAction.href;
    }
    const approve = links.find((l) => l.rel === 'approve');
    if (approve?.href) {
      return approve.href;
    }
    return null;
  }

  private assertHttpsAbsoluteUrl(value: string, field: string): void {
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      throw new BadRequestException(`${field} must be a valid absolute URL.`);
    }
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
      throw new BadRequestException(`${field} must be an https URL without credentials.`);
    }
  }

  private rethrowPayPalError(error: unknown, fallback: string): never {
    if (
      error instanceof BadRequestException ||
      error instanceof ServiceUnavailableException ||
      error instanceof InternalServerErrorException
    ) {
      throw error;
    }

    this.logger.error(fallback, error instanceof Error ? error.stack : undefined);
    throw new InternalServerErrorException(fallback);
  }
}
