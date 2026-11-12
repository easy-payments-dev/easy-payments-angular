import { inject, Injectable } from '@angular/core';
import type { Stripe, StripeElementLocale } from '@stripe/stripe-js';
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
import { CreateCashAppPayPaymentResponse } from '../../models/create-payment.model';
import { assertMerchantMetadata } from '../../metadata/merchant-metadata';
import { PaymentError } from '../../errors/payment-error';
import { BackendService } from '../../services/backend.service';
import { BrowserGuard } from '../../utils/browser-guard';
import { BaseMockAdapter, BaseProviderAdapter } from '../base.adapter';
import { mapResolvedThemeToStripeAppearance } from '../stripe/stripe-appearance';
import { StripeConfirmationGate } from '../stripe/stripe-confirmation-gate';
import { StripeElementSession, StripeElementSessionStore } from '../stripe/stripe-element-sessions';
import { mapStripeError } from '../stripe/stripe-error.mapper';
import { StripeSdkLoader } from '../stripe/stripe-sdk.loader';
import { StripeRedirectRecoveryService } from '../stripe/stripe-redirect-recovery.service';
import { buildStripeReturnUrl } from '../stripe/stripe-redirect-return';
import {
  CASH_APP_PAY_PAYMENT_ELEMENT_OPTIONS,
  CashAppPaySessionResult,
} from './cash-app-pay.types';

/** Stripe Cash App Pay supports USD only. */
const CASH_APP_PAY_CURRENCY = 'USD';
/** Stripe minimum for Cash App Pay: $0.50. */
const CASH_APP_PAY_MIN_AMOUNT = 0.5;

function looksLikeSecretKey(value: string): boolean {
  return /^sk_(test|live)_/i.test(value.trim());
}

function looksLikePublishableKey(value: string): boolean {
  return /^pk_(test|live)_/i.test(value.trim());
}

function mapCashAppPayStripeError(error: unknown): PaymentError {
  const mapped = mapStripeError(error);
  return new PaymentError({
    code: mapped.code,
    message: mapped.message,
    method: 'cash-app-pay',
    provider: 'cashAppPay',
    originalError: mapped.originalError ?? error,
  });
}

@Injectable({ providedIn: 'root' })
export class CashAppPayAdapter extends BaseProviderAdapter {
  readonly provider = 'cashAppPay' as const;

  private readonly configService = inject(EasyPaymentsConfigService);
  private readonly backend = inject(BackendService);
  private readonly browser = inject(BrowserGuard);
  private readonly sdkLoader = inject(StripeSdkLoader);
  private readonly redirectRecovery = inject(StripeRedirectRecoveryService);

  private readonly gate = inject(StripeConfirmationGate);

  private stripe: Stripe | null = null;
  private readonly sessions = new StripeElementSessionStore();
  private loadPromise: Promise<Stripe> | null = null;
  private configReady = false;

  /**
   * Validates Cash App Pay + Stripe gateway config only. Does not load Stripe.js until needed.
   */
  async initialize(): Promise<void> {
    const snapshot = this.configService.getSnapshot();
    const cashAppPay = snapshot.providers?.cashAppPay;
    const stripeKey = snapshot.providers?.stripe?.publishableKey?.trim() ?? '';

    if (!cashAppPay || typeof cashAppPay !== 'object') {
      this.configReady = false;
      this.initialized = false;
      return;
    }

    if (!stripeKey || looksLikeSecretKey(stripeKey) || !looksLikePublishableKey(stripeKey)) {
      this.configReady = false;
      this.initialized = false;
      return;
    }

    this.configReady = true;
    this.initialized = true;
  }

  async isAvailable(context: PaymentContext): Promise<boolean> {
    const snapshot = this.configService.getSnapshot();
    const key = snapshot.providers?.stripe?.publishableKey?.trim() ?? '';
    if (!snapshot.providers?.cashAppPay || !this.configReady) {
      return false;
    }
    if (!key || looksLikeSecretKey(key) || !looksLikePublishableKey(key)) {
      return false;
    }
    if (!backendEndpointUrl(snapshot.backend, snapshot.backend?.cashAppPayCreatePaymentUrl)) {
      return false;
    }
    if (context.product.currency?.trim().toUpperCase() !== CASH_APP_PAY_CURRENCY) {
      return false;
    }
    const total = context.product.amount * (context.product.quantity ?? 1);
    if (!Number.isFinite(total) || total < CASH_APP_PAY_MIN_AMOUNT) {
      return false;
    }
    return true;
  }

  /**
   * Interactive Cash App Pay Payment Element flow is handled by CashAppPayPaymentComponent.
   * Calling createPayment directly is not supported for real Cash App Pay payments.
   */
  async createPayment(_request: PaymentRequest): Promise<PaymentResult> {
    throw new PaymentError({
      code: 'PROVIDER_UNAVAILABLE',
      message:
        'Cash App Pay payments require the secure Payment Element UI. Use the cash-app-pay method inside <easy-payments>.',
      method: 'cash-app-pay',
      provider: 'cashAppPay',
    });
  }

  async ensureStripeLoaded(): Promise<Stripe> {
    if (this.stripe) {
      return this.stripe;
    }

    if (this.loadPromise) {
      return this.loadPromise;
    }

    const key = this.configService.getSnapshot().providers?.stripe?.publishableKey?.trim() ?? '';
    if (!key) {
      throw new PaymentError({
        code: 'CONFIG_MISSING',
        message: 'Stripe publishableKey is missing (required for Cash App Pay via Stripe).',
        method: 'cash-app-pay',
        provider: 'cashAppPay',
      });
    }

    if (looksLikeSecretKey(key)) {
      throw new PaymentError({
        code: 'CONFIG_INVALID',
        message:
          'Stripe secret keys must never be used in Angular. Provide a publishable key (pk_...) only.',
        method: 'cash-app-pay',
        provider: 'cashAppPay',
      });
    }

    if (!looksLikePublishableKey(key)) {
      throw new PaymentError({
        code: 'CONFIG_INVALID',
        message: 'Stripe publishableKey appears invalid. Expected a pk_test_... or pk_live_... value.',
        method: 'cash-app-pay',
        provider: 'cashAppPay',
      });
    }

    if (!this.browser.isBrowser) {
      throw new PaymentError({
        code: 'PROVIDER_UNAVAILABLE',
        message: 'Stripe.js can only load in the browser.',
        method: 'cash-app-pay',
        provider: 'cashAppPay',
      });
    }

    this.loadPromise = (async () => {
      try {
        const stripe = await this.sdkLoader.load(key);
        if (!stripe) {
          throw new PaymentError({
            code: 'SDK_LOAD_FAILED',
            message: 'Stripe.js failed to initialize.',
            method: 'cash-app-pay',
            provider: 'cashAppPay',
          });
        }
        this.stripe = stripe;
        return stripe;
      } catch (error) {
        this.loadPromise = null;
        if (error instanceof PaymentError) {
          throw error;
        }
        throw new PaymentError({
          code: 'SDK_LOAD_FAILED',
          message: 'Stripe.js failed to load.',
          method: 'cash-app-pay',
          provider: 'cashAppPay',
          originalError: error,
        });
      }
    })();

    return this.loadPromise;
  }

  async createPaymentSession(
    product: PaymentProduct,
    _checkout?: CheckoutOptions,
    ownerId?: string,
  ): Promise<CashAppPaySessionResult> {
    if (!this.configService.getSnapshot().backend?.cashAppPayCreatePaymentUrl?.trim()) {
      throw new PaymentError({
        code: 'BACKEND_ERROR',
        message: 'Backend cashAppPayCreatePaymentUrl is not configured.',
        method: 'cash-app-pay',
        provider: 'cashAppPay',
      });
    }

    const metadata = assertMerchantMetadata(product.metadata, 'cash-app-pay', 'cashAppPay');
    const response = await this.backend.createCashAppPayPayment({
      productId: product.id,
      quantity: product.quantity ?? 1,
      currency: product.currency,
      ...(metadata ? { metadata } : {}),
    });
    this.assertValidCashAppPayResponse(response);

    const session = this.sessions.get(ownerId);
    session.clientSecret = response.clientSecret;
    session.sessionId = response.sessionId;
    session.paymentIntentId = response.paymentIntentId;

    return {
      clientSecret: response.clientSecret,
      sessionId: response.sessionId,
      paymentIntentId: response.paymentIntentId,
    };
  }

  async mountPaymentElement(
    container: HTMLElement,
    clientSecret: string,
    theme: ResolvedPaymentTheme,
    locale?: string,
    ownerId?: string,
  ): Promise<void> {
    const stripe = await this.ensureStripeLoaded();

    this.sessions.unmount(ownerId);
    const session = this.sessions.get(ownerId);

    try {
      session.clientSecret = clientSecret;
      const elements = stripe.elements({
        clientSecret,
        appearance: mapResolvedThemeToStripeAppearance(theme),
        ...(locale ? { locale: locale as StripeElementLocale } : {}),
      });
      session.elements = elements;
      session.paymentElement = elements.create('payment', CASH_APP_PAY_PAYMENT_ELEMENT_OPTIONS);
      session.paymentElement.mount(container);
    } catch (error) {
      throw new PaymentError({
        code: 'SDK_LOAD_FAILED',
        message: 'Cash App Pay Payment Element failed to initialize.',
        method: 'cash-app-pay',
        provider: 'cashAppPay',
        originalError: error,
      });
    }
  }

  async updateAppearance(theme: ResolvedPaymentTheme, ownerId?: string): Promise<void> {
    const elements = this.sessions.peek(ownerId)?.elements;
    if (!elements) {
      return;
    }
    elements.update({
      appearance: mapResolvedThemeToStripeAppearance(theme),
    });
  }

  async confirmPayment(returnUrl?: string, ownerId?: string): Promise<PaymentResult> {
    const session = this.sessions.get(ownerId);
    if (session.confirming) {
      throw new PaymentError({
        code: 'PAYMENT_FAILED',
        message: 'A Cash App Pay payment confirmation is already in progress.',
        method: 'cash-app-pay',
        provider: 'cashAppPay',
      });
    }

    const release = this.gate.acquire(
      `cash-app-pay:${ownerId ?? 'legacy'}`,
      'cash-app-pay',
      'cashAppPay',
    );
    session.confirming = true;

    try {
      const stripe = await this.ensureStripeLoaded();
      const elements = session.elements;
      if (!elements) {
        throw new PaymentError({
          code: 'PROVIDER_UNAVAILABLE',
          message: 'Cash App Pay Payment Element is not ready.',
          method: 'cash-app-pay',
          provider: 'cashAppPay',
        });
      }

      const { error: submitError } = await elements.submit();
      if (submitError) {
        throw mapCashAppPayStripeError(submitError);
      }

      // Cash App Pay requires a return_url: mobile redirects to Cash App and back, desktop
      // shows a QR code. Stamp ep_method=cash-app-pay so the remounted app can resume.
      const resolvedReturnUrl = this.browser.isBrowser
        ? buildStripeReturnUrl('cash-app-pay', returnUrl)
        : returnUrl;

      const { error, paymentIntent } = await stripe.confirmPayment({
        elements,
        confirmParams: resolvedReturnUrl
          ? {
              return_url: resolvedReturnUrl,
            }
          : undefined,
        redirect: 'if_required',
      });

      if (error) {
        throw mapCashAppPayStripeError(error);
      }

      // When Cash App Pay redirects, confirmPayment does not resolve in this page —
      // the return path uses retrieveReturningPayment instead.
      return this.normalizeIntent(paymentIntent, session);
    } finally {
      session.confirming = false;
      release();
    }
  }

  /**
   * After Stripe redirects back, recover via shared StripeRedirectRecoveryService.
   */
  async retrieveReturningPayment(clientSecret: string): Promise<PaymentResult> {
    return this.redirectRecovery.retrieveReturningPayment('cash-app-pay', clientSecret);
  }

  /**
   * Idempotent Cash App Pay redirect recovery — delegates to shared Stripe redirect recovery.
   */
  consumeStripeReturn(): Promise<PaymentResult | null> {
    return this.redirectRecovery.consumeReturn();
  }

  /** True after a Stripe redirect return was consumed on this page load. */
  wasReturnConsumed(): boolean {
    return this.redirectRecovery.wasReturnConsumed();
  }

  isConfirming(ownerId?: string): boolean {
    return this.sessions.peek(ownerId)?.confirming ?? false;
  }

  unmountPaymentElement(ownerId?: string): void {
    this.sessions.unmount(ownerId);
  }

  hasMountedElement(ownerId?: string): boolean {
    const session = this.sessions.peek(ownerId);
    return !!session?.elements && !!session.paymentElement;
  }

  /** Destroys one host's session, or every session (adapter re-init) when ownerId is omitted. */
  async destroy(ownerId?: string): Promise<void> {
    this.sessions.destroy(ownerId);
  }

  private assertValidCashAppPayResponse(response: CreateCashAppPayPaymentResponse): void {
    if (!response || typeof response !== 'object') {
      throw new PaymentError({
        code: 'BACKEND_ERROR',
        message: 'Backend returned an invalid Cash App Pay payment response.',
        method: 'cash-app-pay',
        provider: 'cashAppPay',
      });
    }

    if (response.provider && response.provider !== 'cashAppPay') {
      throw new PaymentError({
        code: 'BACKEND_ERROR',
        message: 'Backend response provider must be "cashAppPay".',
        method: 'cash-app-pay',
        provider: 'cashAppPay',
      });
    }

    if (!response.clientSecret || typeof response.clientSecret !== 'string') {
      throw new PaymentError({
        code: 'BACKEND_ERROR',
        message: 'Backend did not return a Cash App Pay clientSecret.',
        method: 'cash-app-pay',
        provider: 'cashAppPay',
      });
    }
  }

  private normalizeIntent(
    paymentIntent: PaymentIntentLike | undefined,
    session: StripeElementSession,
  ): PaymentResult {
    const status = paymentIntent?.status;

    // Terminal success only. Do not treat `processing` as success — Cash App Pay may
    // still be settling asynchronously after customer authorization.
    if (status === 'succeeded') {
      return normalizePaymentResult({
        status: 'success',
        method: 'cash-app-pay',
        provider: 'cashAppPay',
        transactionId: paymentIntent?.id ?? session.paymentIntentId,
        sessionId: session.sessionId,
        message: 'Cash App Pay payment completed successfully.',
        metadata: {
          stripeStatus: status,
          gateway: 'stripe',
        },
      });
    }

    if (status === 'requires_capture') {
      // Public status stays "success" for compatibility; metadata marks authorization-only.
      return normalizePaymentResult({
        status: 'success',
        method: 'cash-app-pay',
        provider: 'cashAppPay',
        transactionId: paymentIntent?.id ?? session.paymentIntentId,
        sessionId: session.sessionId,
        message:
          'Cash App Pay payment is authorized and requires capture. Confirm capture and fulfillment on your backend — this is not proof of captured funds.',
        metadata: {
          stripeStatus: status,
          gateway: 'stripe',
          authorizationOnly: true,
        },
      });
    }

    if (status === 'canceled') {
      return normalizePaymentResult({
        status: 'cancelled',
        method: 'cash-app-pay',
        provider: 'cashAppPay',
        transactionId: paymentIntent?.id ?? session.paymentIntentId,
        sessionId: session.sessionId,
        message: 'Cash App Pay payment was cancelled.',
        metadata: {
          gateway: 'stripe',
        },
      });
    }

    if (status === 'requires_payment_method') {
      // Declined, or the ~10 minute Cash App authorization session expired.
      throw new PaymentError({
        code: 'PAYMENT_FAILED',
        message: 'Cash App Pay payment was not completed. Please try again.',
        method: 'cash-app-pay',
        provider: 'cashAppPay',
        originalError: paymentIntent,
      });
    }

    if (status === 'requires_action' || status === 'requires_confirmation') {
      throw new PaymentError({
        code: 'AUTHENTICATION_REQUIRED',
        message: 'Cash App Pay payment still requires additional customer action.',
        method: 'cash-app-pay',
        provider: 'cashAppPay',
        originalError: paymentIntent,
      });
    }

    if (status === 'processing') {
      return normalizePaymentResult({
        status: 'processing',
        method: 'cash-app-pay',
        provider: 'cashAppPay',
        transactionId: paymentIntent?.id ?? session.paymentIntentId,
        sessionId: session.sessionId,
        message:
          'Cash App Pay payment is still processing. Do not retry — confirm the final status on your backend.',
        metadata: { stripeStatus: status, gateway: 'stripe' },
      });
    }

    throw new PaymentError({
      code: 'PAYMENT_FAILED',
      message: `Unexpected PaymentIntent status: ${status ?? 'unknown'}.`,
      method: 'cash-app-pay',
      provider: 'cashAppPay',
      originalError: paymentIntent,
    });
  }
}

interface PaymentIntentLike {
  id?: string;
  status?: string;
}

@Injectable({ providedIn: 'root' })
export class CashAppPayMockAdapter extends BaseMockAdapter {
  readonly provider = 'cashAppPay' as const;
  readonly method = 'cash-app-pay' as const;
}
