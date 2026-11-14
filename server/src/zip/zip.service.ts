import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { getCatalogProduct } from '../catalog/product-catalog';
import { acceptMerchantMetadata } from '../metadata/merchant-metadata';
import { CaptureZipOrderDto } from './dto/capture-zip-order.dto';
import { CreateZipCheckoutDto } from './dto/create-zip-checkout.dto';
import { VerifyZipReturnDto } from './dto/verify-zip-return.dto';
import {
  signZipJsonBody,
  verifyZipJsonBody,
  verifyZipQueryString,
} from './zip-signature.util';

export interface CreateZipCheckoutResult {
  provider: 'zip';
  merchantReference: string;
  merchantId: string;
  amount: number;
  currency: string;
  requestBody: Record<string, unknown>;
  signature: string;
  sdkScriptUrl: string;
  mock?: boolean;
}

export interface VerifyZipReturnResult {
  provider: 'zip';
  merchantReference: string;
  orderId: string;
  status: 'confirmed' | 'declined' | 'abandoned' | 'created' | 'unknown';
  success: boolean;
  amount: number;
  currency: string;
  alreadyReported?: boolean;
  mock?: boolean;
}

export interface CaptureZipOrderResult {
  provider: 'zip';
  orderId: string;
  merchantReference: string;
  status: string;
  alreadyCaptured?: boolean;
  mock?: boolean;
}

export interface ZipWebhookApplyResult {
  duplicate: boolean;
  ignored: boolean;
  orderId: string;
  merchantReference: string;
  success: boolean;
}

interface PendingZipOrder {
  merchantReference: string;
  merchantId: string;
  amount: number;
  currency: string;
  productId: string;
  quantity: number;
  capture: boolean;
  createdAt: string;
  orderId?: string;
  /** Terminal provider outcome once known. */
  outcome?: 'confirmed' | 'declined' | 'abandoned';
  /** Client already received a success verify response. */
  reportedSuccess?: boolean;
}

@Injectable()
export class ZipService {
  private readonly logger = new Logger(ZipService.name);
  private readonly merchantId: string;
  private readonly apiSecret: string;
  private readonly apiBase: string;
  private readonly sdkScriptUrl: string;
  private readonly callbackUrl: string;
  private readonly configured: boolean;
  /** In-memory pending checkouts keyed by merchantReference (demo server). */
  private readonly pending = new Map<string, PendingZipOrder>();
  /** Captures already completed (idempotent retry). */
  private readonly capturedOrders = new Set<string>();
  /** Processed webhook event keys (orderId + timestamp). */
  private readonly webhookEvents = new Set<string>();

  constructor(private readonly config: ConfigService) {
    this.merchantId = this.config.get<string>('ZIP_MERCHANT_ID')?.trim() ?? '';
    this.apiSecret = this.config.get<string>('ZIP_API_SECRET')?.trim() ?? '';
    const mode = (this.config.get<string>('ZIP_MODE')?.trim() || 'sandbox').toLowerCase();
    this.callbackUrl = this.config.get<string>('ZIP_CALLBACK_URL')?.trim() ?? '';

    this.apiBase =
      mode === 'live'
        ? 'https://gateway.us.zip.co'
        : 'https://gateway.sand.us.zip.co';
    this.sdkScriptUrl =
      mode === 'live'
        ? 'https://cdn.us.zip.co/v1/zip.js'
        : 'https://cdn.sand.us.zip.co/v1/zip.js';

    this.configured = !!(this.merchantId && this.apiSecret);

    if (!this.configured) {
      this.logger.warn(
        'ZIP_MERCHANT_ID / ZIP_API_SECRET are not configured. Zip APIs use local mock signing.',
      );
    } else if (mode === 'live') {
      this.logger.warn(
        'ZIP_MODE=live is set. This demo server is intended for Sandbox testing only.',
      );
    }
  }

  isConfigured(): boolean {
    return this.configured;
  }

  /** Secret used for HMAC (real or mock). */
  signingSecret(): string {
    return this.configured ? this.apiSecret : 'zip-mock-secret';
  }

  createCheckout(dto: CreateZipCheckoutDto): CreateZipCheckoutResult {
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

    if (product.currency !== 'USD') {
      throw new BadRequestException('Zip US supports USD only.');
    }

    const total = Number((product.unitAmount * dto.quantity).toFixed(2));
    if (!Number.isFinite(total) || total < 0.01) {
      throw new BadRequestException('Computed order amount is invalid.');
    }

    const metadata = acceptMerchantMetadata(dto.metadata);
    const merchantReference = `zip_${randomUUID().replace(/-/g, '').slice(0, 24)}`;
    const merchantId = this.configured
      ? this.merchantId
      : '00000000-0000-0000-0000-000000000000';
    const secret = this.signingSecret();
    const callbackUrl = this.callbackUrl || 'http://localhost:3001/api/webhooks/zip';

    const requestBody: Record<string, unknown> = {
      merchantId,
      merchantReference,
      order: {
        currency: product.currency,
        amount: total,
        description: product.name,
        lineItems: [
          {
            name: product.name.slice(0, 100),
            description: product.description.slice(0, 100),
            quantity: dto.quantity,
            price: product.unitAmount,
            sku: product.id,
          },
        ],
      },
      callbackUrl,
      capture: true,
      checkoutFlow: 'standard',
      redirectConfirmUrl: dto.redirectConfirmUrl.trim(),
      redirectCancelUrl: dto.redirectCancelUrl.trim(),
      ...(metadata ? { metadata } : {}),
    };

    const jsonBody = JSON.stringify(requestBody);
    const signature = signZipJsonBody(secret, jsonBody);

    this.pending.set(merchantReference, {
      merchantReference,
      merchantId,
      amount: total,
      currency: product.currency,
      productId: product.id,
      quantity: dto.quantity,
      capture: true,
      createdAt: new Date().toISOString(),
    });

    return {
      provider: 'zip',
      merchantReference,
      merchantId,
      amount: total,
      currency: product.currency,
      requestBody,
      signature,
      sdkScriptUrl: this.sdkScriptUrl,
      ...(this.configured ? {} : { mock: true }),
    };
  }

  verifyReturn(dto: VerifyZipReturnDto): VerifyZipReturnResult {
    const merchantReference = dto.merchantReference?.trim();
    if (!merchantReference) {
      throw new BadRequestException('merchantReference is required.');
    }

    const pending = this.pending.get(merchantReference);
    if (!pending) {
      throw new BadRequestException(
        `Unknown Zip merchantReference "${merchantReference}".`,
      );
    }

    const secret = this.signingSecret();
    let orderId = dto.orderId?.trim() ?? '';
    let successFlag: boolean | null = null;

    if (dto.returnQuery?.trim()) {
      const verified = verifyZipQueryString(secret, dto.returnQuery.trim());
      if (!verified.valid) {
        throw new BadRequestException('Invalid Zip return signature.');
      }
      const ref = verified.params.merchantReference?.trim();
      if (ref && ref !== merchantReference) {
        throw new BadRequestException('Zip return merchantReference mismatch.');
      }
      orderId = verified.params.orderId?.trim() || orderId;
      const successRaw = (verified.params.success ?? '').toLowerCase();
      successFlag = successRaw === 'true' || successRaw === '1';
    } else if (dto.clientResult && typeof dto.clientResult === 'object') {
      const clientOrder = dto.clientResult['order'] as Record<string, unknown> | undefined;
      const clientSuccess =
        dto.clientResult['success'] === true || clientOrder?.['isSuccess'] === true;
      const clientOrderId =
        (typeof clientOrder?.['orderId'] === 'string'
          ? clientOrder['orderId']
          : typeof dto.clientResult['orderId'] === 'string'
            ? dto.clientResult['orderId']
            : '') || '';
      const clientRef =
        (typeof clientOrder?.['merchantReference'] === 'string'
          ? clientOrder['merchantReference']
          : typeof dto.clientResult['merchantReference'] === 'string'
            ? dto.clientResult['merchantReference']
            : '') || '';
      if (clientRef && clientRef !== merchantReference) {
        throw new BadRequestException('Zip clientResult merchantReference mismatch.');
      }
      orderId = clientOrderId || orderId;
      successFlag = clientSuccess;
    } else {
      throw new BadRequestException('Zip verify requires returnQuery or clientResult.');
    }

    if (!orderId) {
      orderId = `mock_${merchantReference}`;
    }
    pending.orderId = orderId;

    if (pending.outcome === 'confirmed') {
      const alreadyReported = !!pending.reportedSuccess;
      pending.reportedSuccess = true;
      return this.verifyResult(pending, orderId, 'confirmed', true, alreadyReported);
    }
    if (pending.outcome === 'declined') {
      return this.verifyResult(pending, orderId, 'declined', false, false);
    }
    if (pending.outcome === 'abandoned') {
      return this.verifyResult(pending, orderId, 'abandoned', false, false);
    }

    if (successFlag === false) {
      pending.outcome = 'declined';
      return this.verifyResult(pending, orderId, 'declined', false, false);
    }

    if (successFlag !== true) {
      return this.verifyResult(pending, orderId, 'unknown', false, false);
    }

    const alreadyReported = !!pending.reportedSuccess;
    pending.outcome = 'confirmed';
    pending.reportedSuccess = true;
    return this.verifyResult(pending, orderId, 'confirmed', true, alreadyReported);
  }

  /**
   * Deferred-fund-capture merchants only. Auto-capture (`capture: true` on create)
   * does not need this. Safe to retry — alreadyCaptured when previously captured.
   */
  async captureOrder(dto: CaptureZipOrderDto): Promise<CaptureZipOrderResult> {
    const orderId = dto.orderId?.trim();
    const merchantReference = dto.merchantReference?.trim();
    if (!orderId || !merchantReference) {
      throw new BadRequestException('orderId and merchantReference are required.');
    }

    const pending = this.pending.get(merchantReference);
    if (!pending) {
      throw new BadRequestException(
        `Unknown Zip merchantReference "${merchantReference}".`,
      );
    }

    if (this.capturedOrders.has(orderId)) {
      return {
        provider: 'zip',
        orderId,
        merchantReference,
        status: 'CAPTURED',
        alreadyCaptured: true,
        ...(this.configured ? {} : { mock: true }),
      };
    }

    if (!this.configured) {
      this.capturedOrders.add(orderId);
      pending.outcome = 'confirmed';
      return {
        provider: 'zip',
        orderId,
        merchantReference,
        status: 'CAPTURED',
        alreadyCaptured: false,
        mock: true,
      };
    }

    const amount = dto.amount ?? pending.amount;
    const currency = (dto.currency ?? pending.currency).toUpperCase();
    const body = {
      orderId,
      merchantId: this.merchantId,
      currency,
      amount,
      merchantReference,
      callbackUrl: this.callbackUrl || 'http://localhost:3001/api/webhooks/zip',
      singleCapture: true,
    };
    const jsonBody = JSON.stringify(body);
    const signature = signZipJsonBody(this.apiSecret, jsonBody);

    try {
      const response = await fetch(
        `${this.apiBase}/orders/${encodeURIComponent(orderId)}/capture?sync=true`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-QP-Signature': signature,
          },
          body: jsonBody,
        },
      );

      if (!response.ok && response.status !== 204) {
        const text = await response.text().catch(() => '');
        this.logger.warn(`Zip capture failed status=${response.status} body=${text}`);
        throw new InternalServerErrorException('Zip capture failed.');
      }

      this.capturedOrders.add(orderId);
      pending.outcome = 'confirmed';
      return {
        provider: 'zip',
        orderId,
        merchantReference,
        status: 'CAPTURED',
        alreadyCaptured: false,
      };
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof InternalServerErrorException) {
        throw error;
      }
      this.logger.error('Zip capture request failed', error as Error);
      throw new InternalServerErrorException('Zip capture request failed.');
    }
  }

  /**
   * Handle Zip webhook. Verifies HMAC over the exact raw body string.
   * Duplicate callbacks (same orderId + timestamp) are no-ops.
   */
  applyWebhook(
    body: Record<string, unknown>,
    rawBody: string,
    signature: string,
  ): ZipWebhookApplyResult {
    if (!verifyZipJsonBody(this.signingSecret(), rawBody, signature)) {
      throw new BadRequestException('Invalid Zip webhook signature.');
    }

    const orderId =
      typeof body['orderId'] === 'string' ? body['orderId'].trim() : '';
    const merchantReference =
      typeof body['merchantReference'] === 'string'
        ? body['merchantReference'].trim()
        : '';
    const success = body['success'] === true;
    const timestamp =
      typeof body['timestamp'] === 'string' ? body['timestamp'] : '';

    if (!orderId) {
      throw new BadRequestException('Zip webhook missing orderId.');
    }

    const eventKey = `${orderId}:${timestamp || signZipJsonBody(this.signingSecret(), rawBody)}`;
    if (this.webhookEvents.has(eventKey)) {
      return {
        duplicate: true,
        ignored: true,
        orderId,
        merchantReference,
        success,
      };
    }
    this.webhookEvents.add(eventKey);

    if (merchantReference) {
      const pending = this.pending.get(merchantReference);
      if (pending) {
        pending.orderId = orderId;
        if (pending.outcome === 'confirmed' || pending.outcome === 'declined') {
          return {
            duplicate: false,
            ignored: true,
            orderId,
            merchantReference,
            success,
          };
        }
        pending.outcome = success ? 'confirmed' : 'declined';
      }
    }

    return {
      duplicate: false,
      ignored: false,
      orderId,
      merchantReference,
      success,
    };
  }

  /** Test helper */
  clearPendingForTests(): void {
    this.pending.clear();
    this.capturedOrders.clear();
    this.webhookEvents.clear();
  }

  getPendingForTests(merchantReference: string): PendingZipOrder | undefined {
    return this.pending.get(merchantReference);
  }

  private verifyResult(
    pending: PendingZipOrder,
    orderId: string,
    status: VerifyZipReturnResult['status'],
    success: boolean,
    alreadyReported: boolean,
  ): VerifyZipReturnResult {
    return {
      provider: 'zip',
      merchantReference: pending.merchantReference,
      orderId,
      status,
      success,
      amount: pending.amount,
      currency: pending.currency,
      alreadyReported,
      ...(this.configured ? {} : { mock: true }),
    };
  }
}
