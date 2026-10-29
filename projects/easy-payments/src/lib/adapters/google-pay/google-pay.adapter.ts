import { inject, Injectable } from '@angular/core';
import type { Stripe } from '@stripe/stripe-js';
import { EasyPaymentsConfigService } from '../../config/easy-payments-config.service';
import { backendEndpointUrl } from '../../config/resolve-backend-url';
import {
  CheckoutOptions,
  PaymentContext,
  PaymentProduct,
  PaymentRequest,
  PaymentResult,
  ResolvedPaymentTheme,
  normalizePaymentResult,
} from '../../models';
import { CreatePaymentRequest } from '../../models/create-payment.model';
import { buildStripeRequestMetadata } from '../../metadata/merchant-metadata';
import { PaymentError } from '../../errors/payment-error';
import { BackendService } from '../../services/backend.service';
import { BrowserGuard } from '../../utils/browser-guard';
import { BaseMockAdapter, BaseProviderAdapter } from '../base.adapter';
import { StripeSdkLoader } from '../stripe/stripe-sdk.loader';
import { mapGooglePayError } from './google-pay-error.mapper';
import { GooglePaySdkLoader } from './google-pay-sdk.loader';
import {
  GOOGLE_PAY_API_VERSION,
  GOOGLE_PAY_API_VERSION_MINOR,
  GOOGLE_PAY_TEST_MERCHANT_ID,
  GooglePayAllowedPaymentMethod,
  GooglePayButtonOptions,
  GooglePayPaymentsClient,
  GooglePaymentData,
  GooglePaymentDataRequest,
  STRIPE_GOOGLE_PAY_API_VERSION,
  STRIPE_GOOGLE_PAY_GATEWAY,
  formatGooglePayTotalPrice,
} from './google-pay.types';

@Injectable({ providedIn: 'root' })
export class GooglePayAdapter extends BaseProviderAdapter {
  readonly provider = 'googlePay' as const;

  private readonly configService = inject(EasyPaymentsConfigService);
  private readonly backend = inject(BackendService);
  private readonly browser = inject(BrowserGuard);
  private readonly googlePaySdk = inject(GooglePaySdkLoader);
  private readonly stripeSdk = inject(StripeSdkLoader);

  private paymentsClient: GooglePayPaymentsClient | null = null;
  private stripe: Stripe | null = null;
  private configReady = false;
  private processing = false;
  /**
   * Per-host official button mounts. Destroying one host must not clear another's DOM.
   * Keyed by opaque mount ids owned by GooglePayPaymentComponent instances.
   */
  private readonly buttonMounts = new Map<string, HTMLElement>();
  private nextMountId = 0;

  /**
   * Validates Google Pay + Stripe gateway prerequisites.
   * Does not load pay.js until needed.
   */
  async initialize(): Promise<void> {
    const snapshot = this.configService.getSnapshot();
    const googlePay = snapshot.providers?.googlePay;
    const stripeKey = snapshot.providers?.stripe?.publishableKey?.trim() ?? '';

    if (!googlePay) {
      this.configReady = false;
      this.initialized = false;
      return;
    }

    if (!stripeKey || /^sk_/i.test(stripeKey) || !/^pk_(test|live)_/i.test(stripeKey)) {
      this.configReady = false;
      this.initialized = false;
      return;
    }

    if (!backendEndpointUrl(snapshot.backend, snapshot.backend?.createPaymentUrl)) {
      this.configReady = false;
      this.initialized = false;
      return;
    }

    if ((googlePay.environment ?? 'TEST') === 'PRODUCTION' && !googlePay.merchantId?.trim()) {
      this.configReady = false;
      this.initialized = false;
      throw new PaymentError({
        code: 'CONFIG_INVALID',
        message: 'Google Pay PRODUCTION requires a real merchantId from Google Pay & Wallet Console.',
        method: 'google-pay',
        provider: 'googlePay',
      });
    }

    this.configReady = true;
    this.initialized = true;
  }

  async isAvailable(_context: PaymentContext): Promise<boolean> {
    if (!this.configReady) {
      return false;
    }

    try {
      const client = await this.ensurePaymentsClient();
      const response = await client.isReadyToPay({
        apiVersion: GOOGLE_PAY_API_VERSION,
        apiVersionMinor: GOOGLE_PAY_API_VERSION_MINOR,
        allowedPaymentMethods: [this.buildAllowedPaymentMethod()],
      });
      return !!response.result;
    } catch {
      return false;
    }
  }

  async createPayment(_request: PaymentRequest): Promise<PaymentResult> {
    throw new PaymentError({
      code: 'PROVIDER_UNAVAILABLE',
      message:
        'Google Pay requires the official Google Pay button UI. Use the google-pay method inside <easy-payments>.',
      method: 'google-pay',
      provider: 'googlePay',
    });
  }

  async ensurePaymentsClient(): Promise<GooglePayPaymentsClient> {
    if (this.paymentsClient) {
      return this.paymentsClient;
    }

    const google = await this.googlePaySdk.load();
    const environment = this.getEnvironment();
    this.paymentsClient = new google.payments.api.PaymentsClient({ environment });
    return this.paymentsClient;
  }

  async ensureStripeLoaded(): Promise<Stripe> {
    if (this.stripe) {
      return this.stripe;
    }

    const key = this.configService.getSnapshot().providers?.stripe?.publishableKey?.trim() ?? '';
    if (!key) {
      throw new PaymentError({
        code: 'CONFIG_MISSING',
        message: 'Stripe publishableKey is required for Google Pay (Stripe gateway).',
        method: 'google-pay',
        provider: 'googlePay',
      });
    }

    const stripe = await this.stripeSdk.load(key);
    if (!stripe) {
      throw new PaymentError({
        code: 'SDK_LOAD_FAILED',
        message: 'Stripe.js failed to load for Google Pay confirmation.',
        method: 'google-pay',
        provider: 'googlePay',
      });
    }

    this.stripe = stripe;
    return stripe;
  }

  /**
   * Renders Google's official createButton into the host under an ownership-scoped mount id.
   * Theme only affects official buttonColor — does not start payments.
   * Re-rendering with the same `mountId` replaces only that mount; sibling hosts stay intact.
   * @returns The mount id to pass to {@link destroyButtonMount} on host teardown.
   */
  async renderOfficialButton(
    host: HTMLElement,
    options: {
      theme: ResolvedPaymentTheme;
      onClick: () => void | Promise<void>;
      /** ISO 639-1 button locale (en / es / pt). Affects button text only. */
      buttonLocale?: string;
    },
    mountId?: string,
  ): Promise<string> {
    const id = mountId ?? this.allocateMountId();
    // Replace only this owner's previous button instance.
    this.destroyButtonMount(id);

    const client = await this.ensurePaymentsClient();
    host.replaceChildren();

    const buttonOptions: GooglePayButtonOptions = {
      onClick: (event) => {
        event.preventDefault();
        void options.onClick();
      },
      buttonColor: options.theme === 'dark' ? 'white' : 'black',
      buttonType: 'pay',
      buttonSizeMode: 'fill',
      ...(options.buttonLocale ? { buttonLocale: options.buttonLocale } : {}),
    };

    const button = client.createButton(buttonOptions);
    host.appendChild(button);
    this.buttonMounts.set(id, host);
    return id;
  }

  /**
   * Clears one official button mount (host teardown) or all mounts when `mountId` is omitted.
   */
  destroyButtonMount(mountId?: string): void {
    if (mountId !== undefined) {
      const host = this.buttonMounts.get(mountId);
      this.buttonMounts.delete(mountId);
      host?.replaceChildren();
      return;
    }

    for (const host of this.buttonMounts.values()) {
      host.replaceChildren();
    }
    this.buttonMounts.clear();
  }

  /** @deprecated Prefer {@link destroyButtonMount}; kept for callers that clear “the” host. */
  clearButtonHost(): void {
    this.destroyButtonMount();
  }

  /** Active ownership-scoped button mounts (test / diagnostics). */
  getActiveButtonMountCount(): number {
    return this.buttonMounts.size;
  }

  private allocateMountId(): string {
    this.nextMountId += 1;
    return `google-pay-button-${this.nextMountId}`;
  }

  isProcessing(): boolean {
    return this.processing;
  }

  /**
   * Full click flow: trusted PaymentIntent → Google sheet → Stripe confirm.
   * PaymentIntent is created only on user click (not on mount/theme).
   */
  async payWithGooglePay(
    product: PaymentProduct,
    checkout?: CheckoutOptions,
  ): Promise<PaymentResult> {
    if (this.processing) {
      throw new PaymentError({
        code: 'PAYMENT_FAILED',
        message: 'A Google Pay payment is already in progress.',
        method: 'google-pay',
        provider: 'googlePay',
      });
    }

    this.processing = true;
    try {
      const quantity = product.quantity ?? 1;
      const totalPrice = formatGooglePayTotalPrice(product.amount, quantity);
      const currencyCode = product.currency.trim().toUpperCase();

      // 1) Create PaymentIntent with trusted server price (catalog), not browser amount alone.
      const session = await this.createPaymentSession(product, checkout);

      // 2) Open official Google Pay sheet with the same displayed total.
      const client = await this.ensurePaymentsClient();
      let paymentData: GooglePaymentData;
      try {
        paymentData = await client.loadPaymentData(
          this.buildPaymentDataRequest({
            totalPrice,
            currencyCode,
          }),
        );
      } catch (error) {
        throw mapGooglePayError(error);
      }

      // 3) Confirm via Stripe using the gateway token (no raw card data handled by Easy Payments).
      return await this.confirmWithStripeToken(paymentData, session.clientSecret, session.paymentIntentId);
    } finally {
      this.processing = false;
    }
  }

  buildPaymentDataRequest(input: {
    totalPrice: string;
    currencyCode: string;
  }): GooglePaymentDataRequest {
    const googlePay = this.configService.getSnapshot().providers?.googlePay;
    const environment = this.getEnvironment();
    const merchantName = googlePay?.merchantName?.trim() || 'Easy Payments Demo';
    const merchantId =
      googlePay?.merchantId?.trim() ||
      (environment === 'TEST' ? GOOGLE_PAY_TEST_MERCHANT_ID : undefined);

    const merchantInfo: GooglePaymentDataRequest['merchantInfo'] = {
      merchantName,
    };
    if (merchantId) {
      merchantInfo.merchantId = merchantId;
    }

    return {
      apiVersion: GOOGLE_PAY_API_VERSION,
      apiVersionMinor: GOOGLE_PAY_API_VERSION_MINOR,
      allowedPaymentMethods: [this.buildAllowedPaymentMethod()],
      transactionInfo: {
        countryCode: (googlePay?.countryCode ?? 'US').trim().toUpperCase() || 'US',
        currencyCode: input.currencyCode,
        totalPriceStatus: 'FINAL',
        totalPrice: input.totalPrice,
      },
      merchantInfo,
    };
  }

  buildAllowedPaymentMethod(): GooglePayAllowedPaymentMethod {
    const publishableKey =
      this.configService.getSnapshot().providers?.stripe?.publishableKey?.trim() ?? '';

    return {
      type: 'CARD',
      parameters: {
        allowedAuthMethods: ['PAN_ONLY', 'CRYPTOGRAM_3DS'],
        allowedCardNetworks: ['AMEX', 'DISCOVER', 'INTERAC', 'JCB', 'MASTERCARD', 'VISA'],
      },
      tokenizationSpecification: {
        type: 'PAYMENT_GATEWAY',
        parameters: {
          gateway: STRIPE_GOOGLE_PAY_GATEWAY,
          'stripe:version': STRIPE_GOOGLE_PAY_API_VERSION,
          'stripe:publishableKey': publishableKey,
        },
      },
    };
  }

  private getEnvironment(): 'TEST' | 'PRODUCTION' {
    return this.configService.getSnapshot().providers?.googlePay?.environment ?? 'TEST';
  }

  private async createPaymentSession(
    product: PaymentProduct,
    checkout?: CheckoutOptions,
  ): Promise<{ clientSecret: string; paymentIntentId?: string }> {
    const payload: CreatePaymentRequest = {
      provider: 'stripe',
      productId: product.id,
      quantity: product.quantity ?? 1,
      currency: product.currency.trim().toUpperCase(),
      // Display only — Nest ignores and uses trusted catalog.
      amount: product.amount,
      metadata: buildStripeRequestMetadata(
        product.metadata,
        {
          productName: product.name,
          checkoutMethod: 'google-pay',
          customerEmail: checkout?.customer?.email,
        },
        'google-pay',
        'googlePay',
      ),
    };

    try {
      const response = await this.backend.createStripePayment(payload);
      if (
        response.provider !== 'stripe' ||
        typeof response.clientSecret !== 'string' ||
        !response.clientSecret.trim()
      ) {
        throw new PaymentError({
          code: 'BACKEND_ERROR',
          message: 'Invalid Stripe create-payment response for Google Pay.',
          method: 'google-pay',
          provider: 'googlePay',
        });
      }
      return {
        clientSecret: response.clientSecret,
        paymentIntentId: response.paymentIntentId,
      };
    } catch (error) {
      throw mapGooglePayError(error, 'BACKEND_ERROR', 'Failed to create payment session for Google Pay.');
    }
  }

  private async confirmWithStripeToken(
    paymentData: GooglePaymentData,
    clientSecret: string,
    paymentIntentId?: string,
  ): Promise<PaymentResult> {
    const tokenRaw = paymentData.paymentMethodData?.tokenizationData?.token;
    if (!tokenRaw) {
      throw new PaymentError({
        code: 'PAYMENT_FAILED',
        message: 'Google Pay did not return a payment token.',
        method: 'google-pay',
        provider: 'googlePay',
      });
    }

    let tokenId: string;
    try {
      const parsed = JSON.parse(tokenRaw) as { id?: string };
      tokenId = parsed.id?.trim() ?? '';
    } catch (error) {
      throw new PaymentError({
        code: 'PAYMENT_FAILED',
        message: 'Google Pay returned an invalid payment token.',
        method: 'google-pay',
        provider: 'googlePay',
        originalError: error,
      });
    }

    if (!tokenId) {
      throw new PaymentError({
        code: 'PAYMENT_FAILED',
        message:
          'Google Pay token was empty. In Google Pay TEST environment tokens are not chargeable — see docs.',
        method: 'google-pay',
        provider: 'googlePay',
      });
    }

    const stripe = await this.ensureStripeLoaded();

    const { paymentMethod, error: pmError } = await stripe.createPaymentMethod({
      type: 'card',
      card: { token: tokenId },
    });

    if (pmError || !paymentMethod) {
      throw mapGooglePayError(
        pmError ?? new Error('Failed to create Stripe PaymentMethod from Google Pay token.'),
      );
    }

    const { error, paymentIntent } = await stripe.confirmCardPayment(clientSecret, {
      payment_method: paymentMethod.id,
    });

    if (error) {
      throw mapGooglePayError(error);
    }

    const status = paymentIntent?.status;
    if (status === 'succeeded' || status === 'processing' || status === 'requires_capture') {
      return normalizePaymentResult({
        status: 'success',
        method: 'google-pay',
        provider: 'googlePay',
        transactionId: paymentIntent?.id ?? paymentIntentId,
        sessionId: paymentIntent?.id ?? paymentIntentId,
        message: 'Google Pay payment completed.',
        metadata: {
          processor: 'stripe',
          stripeStatus: status,
          cardNetwork: paymentData.paymentMethodData?.info?.cardNetwork,
          cardDetails: paymentData.paymentMethodData?.info?.cardDetails,
          googlePayEnvironment: this.getEnvironment(),
        },
      });
    }

    if (status === 'canceled') {
      return normalizePaymentResult({
        status: 'cancelled',
        method: 'google-pay',
        provider: 'googlePay',
        message: 'Google Pay payment was cancelled.',
        sessionId: paymentIntent?.id ?? paymentIntentId,
      });
    }

    throw new PaymentError({
      code: 'PAYMENT_FAILED',
      message: `Google Pay payment ended with status: ${status ?? 'unknown'}.`,
      method: 'google-pay',
      provider: 'googlePay',
    });
  }

  /**
   * Full adapter reset: clears every button mount and in-flight processing flag.
   * Prefer {@link destroyButtonMount}(mountId) from individual payment hosts.
   */
  async destroy(): Promise<void> {
    this.destroyButtonMount();
    this.processing = false;
  }
}

@Injectable({ providedIn: 'root' })
export class GooglePayMockAdapter extends BaseMockAdapter {
  readonly provider = 'googlePay' as const;
  readonly method = 'google-pay' as const;
}
