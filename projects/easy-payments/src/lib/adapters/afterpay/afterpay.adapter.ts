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
import { CreateAfterpayPaymentResponse } from '../../models/create-payment.model';
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
  AFTERPAY_PAYMENT_ELEMENT_OPTIONS,
  AfterpaySessionResult,
} from './afterpay.types';

/**
 * Stripe Afterpay/Clearpay presentment currencies (domestic).
 * @see https://docs.stripe.com/payments/afterpay-clearpay
 */
const AFTERPAY_LIMITS: Readonly<Record<string, { min: number; max: number }>> = {
  USD: { min: 1, max: 4000 },
  CAD: { min: 1, max: 2000 },
  AUD: { min: 1, max: 4000 },
  NZD: { min: 1, max: 4000 },
  GBP: { min: 1, max: 1200 },
};

export function afterpayAmountAllowed(currency: string, total: number): boolean {
  const limits = AFTERPAY_LIMITS[currency.trim().toUpperCase()];
  if (!limits || !Number.isFinite(total)) {
    return false;
  }
  return total >= limits.min && total <= limits.max;
}

function looksLikeSecretKey(value: string): boolean {
  return /^sk_(test|live)_/i.test(value.trim());
}

function looksLikePublishableKey(value: string): boolean {
  return /^pk_(test|live)_/i.test(value.trim());
}

function mapAfterpayStripeError(error: unknown): PaymentError {
  const mapped = mapStripeError(error);
  return new PaymentError({
    code: mapped.code,
    message: mapped.message,
    method: 'afterpay',
    provider: 'afterpay',
    originalError: mapped.originalError ?? error,
  });
}

@Injectable({ providedIn: 'root' })
export class AfterpayAdapter extends BaseProviderAdapter {
  readonly provider = 'afterpay' as const;

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
   * Validates Afterpay + Stripe gateway config only. Does not load Stripe.js until needed.
   */
  async initialize(): Promise<void> {
    const snapshot = this.configService.getSnapshot();
    const afterpay = snapshot.providers?.afterpay;
    const stripeKey = snapshot.providers?.stripe?.publishableKey?.trim() ?? '';

    if (!afterpay || typeof afterpay !== 'object') {
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
    if (!snapshot.providers?.afterpay || !this.configReady) {
      return false;
    }
    if (!key || looksLikeSecretKey(key) || !looksLikePublishableKey(key)) {
      return false;
    }
    if (!backendEndpointUrl(snapshot.backend, snapshot.backend?.afterpayCreatePaymentUrl)) {
      return false;
    }
    const currency = context.product.currency?.trim().toUpperCase() ?? '';
    const total = context.product.amount * (context.product.quantity ?? 1);
    return afterpayAmountAllowed(currency, total);
  }

  /**
   * Interactive Afterpay Payment Element flow is handled by AfterpayPaymentComponent.
   * Calling createPayment directly is not supported for real Afterpay payments.
   */
  async createPayment(_request: PaymentRequest): Promise<PaymentResult> {
    throw new PaymentError({
      code: 'PROVIDER_UNAVAILABLE',
      message:
        'Afterpay payments require the secure Payment Element UI. Use the afterpay method inside <easy-payments>.',
      method: 'afterpay',
      provider: 'afterpay',
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
        message: 'Stripe publishableKey is missing (required for Afterpay via Stripe).',
        method: 'afterpay',
        provider: 'afterpay',
      });
    }

    if (looksLikeSecretKey(key)) {
      throw new PaymentError({
        code: 'CONFIG_INVALID',
        message:
          'Stripe secret keys must never be used in Angular. Provide a publishable key (pk_...) only.',
        method: 'afterpay',
        provider: 'afterpay',
      });
    }

    if (!looksLikePublishableKey(key)) {
      throw new PaymentError({
        code: 'CONFIG_INVALID',
        message: 'Stripe publishableKey appears invalid. Expected a pk_test_... or pk_live_... value.',
        method: 'afterpay',
        provider: 'afterpay',
      });
    }

    if (!this.browser.isBrowser) {
      throw new PaymentError({
        code: 'PROVIDER_UNAVAILABLE',
        message: 'Stripe.js can only load in the browser.',
        method: 'afterpay',
        provider: 'afterpay',
      });
    }

    this.loadPromise = (async () => {
      try {
        const stripe = await this.sdkLoader.load(key);
        if (!stripe) {
          throw new PaymentError({
            code: 'SDK_LOAD_FAILED',
            message: 'Stripe.js failed to initialize.',
            method: 'afterpay',
            provider: 'afterpay',
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
          method: 'afterpay',
          provider: 'afterpay',
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
  ): Promise<AfterpaySessionResult> {
    if (!this.configService.getSnapshot().backend?.afterpayCreatePaymentUrl?.trim()) {
      throw new PaymentError({
        code: 'BACKEND_ERROR',
        message: 'Backend afterpayCreatePaymentUrl is not configured.',
        method: 'afterpay',
        provider: 'afterpay',
      });
    }

    const metadata = assertMerchantMetadata(product.metadata, 'afterpay', 'afterpay');
    const response = await this.backend.createAfterpayPayment({
      productId: product.id,
      quantity: product.quantity ?? 1,
      currency: product.currency,
      ...(metadata ? { metadata } : {}),
    });
    this.assertValidAfterpayResponse(response);

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
      session.paymentElement = elements.create('payment', AFTERPAY_PAYMENT_ELEMENT_OPTIONS);
      session.paymentElement.mount(container);
    } catch (error) {
      throw new PaymentError({
        code: 'SDK_LOAD_FAILED',
        message: 'Afterpay Payment Element failed to initialize.',
        method: 'afterpay',
        provider: 'afterpay',
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
        message: 'A Afterpay payment confirmation is already in progress.',
        method: 'afterpay',
        provider: 'afterpay',
      });
    }

    const release = this.gate.acquire(
      `afterpay:${ownerId ?? 'legacy'}`,
      'afterpay',
      'afterpay',
    );
    session.confirming = true;

    try {
      const stripe = await this.ensureStripeLoaded();
      const elements = session.elements;
      if (!elements) {
        throw new PaymentError({
          code: 'PROVIDER_UNAVAILABLE',
          message: 'Afterpay Payment Element is not ready.',
          method: 'afterpay',
          provider: 'afterpay',
        });
      }

      const { error: submitError } = await elements.submit();
      if (submitError) {
        throw mapAfterpayStripeError(submitError);
      }

      // Afterpay requires a return_url for redirect auth. Stamp ep_method=afterpay
      // so the remounted app can resume.
      const resolvedReturnUrl = this.browser.isBrowser
        ? buildStripeReturnUrl('afterpay', returnUrl)
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
        throw mapAfterpayStripeError(error);
      }

      // When Afterpay redirects, confirmPayment does not resolve in this page —
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
    return this.redirectRecovery.retrieveReturningPayment('afterpay', clientSecret);
  }

  /**
   * Idempotent Afterpay redirect recovery — delegates to shared Stripe redirect recovery.
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

  private assertValidAfterpayResponse(response: CreateAfterpayPaymentResponse): void {
    if (!response || typeof response !== 'object') {
      throw new PaymentError({
        code: 'BACKEND_ERROR',
        message: 'Backend returned an invalid Afterpay payment response.',
        method: 'afterpay',
        provider: 'afterpay',
      });
    }

    if (response.provider && response.provider !== 'afterpay') {
      throw new PaymentError({
        code: 'BACKEND_ERROR',
        message: 'Backend response provider must be "afterpay".',
        method: 'afterpay',
        provider: 'afterpay',
      });
    }

    if (!response.clientSecret || typeof response.clientSecret !== 'string') {
      throw new PaymentError({
        code: 'BACKEND_ERROR',
        message: 'Backend did not return a Afterpay clientSecret.',
        method: 'afterpay',
        provider: 'afterpay',
      });
    }
  }

  private normalizeIntent(
    paymentIntent: PaymentIntentLike | undefined,
    session: StripeElementSession,
  ): PaymentResult {
    const status = paymentIntent?.status;

    // Terminal success only. Do not treat `processing` as success — Afterpay may
    // still be settling asynchronously after customer authorization.
    if (status === 'succeeded') {
      return normalizePaymentResult({
        status: 'success',
        method: 'afterpay',
        provider: 'afterpay',
        transactionId: paymentIntent?.id ?? session.paymentIntentId,
        sessionId: session.sessionId,
        message: 'Afterpay payment completed successfully.',
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
        method: 'afterpay',
        provider: 'afterpay',
        transactionId: paymentIntent?.id ?? session.paymentIntentId,
        sessionId: session.sessionId,
        message:
          'Afterpay payment is authorized and requires capture. Confirm capture and fulfillment on your backend — this is not proof of captured funds.',
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
        method: 'afterpay',
        provider: 'afterpay',
        transactionId: paymentIntent?.id ?? session.paymentIntentId,
        sessionId: session.sessionId,
        message: 'Afterpay payment was cancelled.',
        metadata: {
          gateway: 'stripe',
        },
      });
    }

    if (status === 'requires_payment_method') {
      // Declined, or the ~3 hour Afterpay authorization session expired.
      throw new PaymentError({
        code: 'PAYMENT_FAILED',
        message: 'Afterpay payment was not completed. Please try again.',
        method: 'afterpay',
        provider: 'afterpay',
        originalError: paymentIntent,
      });
    }

    if (status === 'requires_action' || status === 'requires_confirmation') {
      throw new PaymentError({
        code: 'AUTHENTICATION_REQUIRED',
        message: 'Afterpay payment still requires additional customer action.',
        method: 'afterpay',
        provider: 'afterpay',
        originalError: paymentIntent,
      });
    }

    if (status === 'processing') {
      return normalizePaymentResult({
        status: 'processing',
        method: 'afterpay',
        provider: 'afterpay',
        transactionId: paymentIntent?.id ?? session.paymentIntentId,
        sessionId: session.sessionId,
        message:
          'Afterpay payment is still processing. Do not retry — confirm the final status on your backend.',
        metadata: { stripeStatus: status, gateway: 'stripe' },
      });
    }

    throw new PaymentError({
      code: 'PAYMENT_FAILED',
      message: `Unexpected PaymentIntent status: ${status ?? 'unknown'}.`,
      method: 'afterpay',
      provider: 'afterpay',
      originalError: paymentIntent,
    });
  }
}

interface PaymentIntentLike {
  id?: string;
  status?: string;
}

@Injectable({ providedIn: 'root' })
export class AfterpayMockAdapter extends BaseMockAdapter {
  readonly provider = 'afterpay' as const;
  readonly method = 'afterpay' as const;
}
