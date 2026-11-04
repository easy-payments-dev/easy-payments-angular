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
import { CreateKlarnaPaymentResponse } from '../../models/create-payment.model';
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
import { buildKlarnaReturnUrl } from './klarna-return';
import {
  KLARNA_PAYMENT_ELEMENT_OPTIONS,
  KlarnaSessionResult,
} from './klarna.types';

const KLARNA_SUPPORTED_CURRENCIES = new Set(['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'SEK', 'NOK', 'DKK']);

function looksLikeSecretKey(value: string): boolean {
  return /^sk_(test|live)_/i.test(value.trim());
}

function looksLikePublishableKey(value: string): boolean {
  return /^pk_(test|live)_/i.test(value.trim());
}

function mapKlarnaStripeError(error: unknown): PaymentError {
  const mapped = mapStripeError(error);
  return new PaymentError({
    code: mapped.code,
    message: mapped.message,
    method: 'klarna',
    provider: 'klarna',
    originalError: mapped.originalError ?? error,
  });
}

@Injectable({ providedIn: 'root' })
export class KlarnaAdapter extends BaseProviderAdapter {
  readonly provider = 'klarna' as const;

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
   * Validates Klarna + Stripe gateway config only. Does not load Stripe.js until needed.
   */
  async initialize(): Promise<void> {
    const snapshot = this.configService.getSnapshot();
    const klarna = snapshot.providers?.klarna;
    const stripeKey = snapshot.providers?.stripe?.publishableKey?.trim() ?? '';

    if (!klarna || typeof klarna !== 'object') {
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
    if (!snapshot.providers?.klarna || !this.configReady) {
      return false;
    }
    if (!key || looksLikeSecretKey(key) || !looksLikePublishableKey(key)) {
      return false;
    }
    if (!backendEndpointUrl(snapshot.backend, snapshot.backend?.klarnaCreatePaymentUrl)) {
      return false;
    }
    if (!KLARNA_SUPPORTED_CURRENCIES.has(context.product.currency)) {
      return false;
    }
    if (context.product.amount <= 0) {
      return false;
    }
    return true;
  }

  /**
   * Interactive Klarna Payment Element flow is handled by KlarnaPaymentComponent.
   * Calling createPayment directly is not supported for real Klarna payments.
   */
  async createPayment(_request: PaymentRequest): Promise<PaymentResult> {
    throw new PaymentError({
      code: 'PROVIDER_UNAVAILABLE',
      message:
        'Klarna payments require the secure Payment Element UI. Use the klarna method inside <easy-payments>.',
      method: 'klarna',
      provider: 'klarna',
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
        message: 'Stripe publishableKey is missing (required for Klarna via Stripe).',
        method: 'klarna',
        provider: 'klarna',
      });
    }

    if (looksLikeSecretKey(key)) {
      throw new PaymentError({
        code: 'CONFIG_INVALID',
        message:
          'Stripe secret keys must never be used in Angular. Provide a publishable key (pk_...) only.',
        method: 'klarna',
        provider: 'klarna',
      });
    }

    if (!looksLikePublishableKey(key)) {
      throw new PaymentError({
        code: 'CONFIG_INVALID',
        message: 'Stripe publishableKey appears invalid. Expected a pk_test_... or pk_live_... value.',
        method: 'klarna',
        provider: 'klarna',
      });
    }

    if (!this.browser.isBrowser) {
      throw new PaymentError({
        code: 'PROVIDER_UNAVAILABLE',
        message: 'Stripe.js can only load in the browser.',
        method: 'klarna',
        provider: 'klarna',
      });
    }

    this.loadPromise = (async () => {
      try {
        const stripe = await this.sdkLoader.load(key);
        if (!stripe) {
          throw new PaymentError({
            code: 'SDK_LOAD_FAILED',
            message: 'Stripe.js failed to initialize.',
            method: 'klarna',
            provider: 'klarna',
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
          method: 'klarna',
          provider: 'klarna',
          originalError: error,
        });
      }
    })();

    return this.loadPromise;
  }

  async createPaymentSession(
    product: PaymentProduct,
    _checkout?: CheckoutOptions,
    preferredLocale?: string,
    ownerId?: string,
  ): Promise<KlarnaSessionResult> {
    if (!this.configService.getSnapshot().backend?.klarnaCreatePaymentUrl?.trim()) {
      throw new PaymentError({
        code: 'BACKEND_ERROR',
        message: 'Backend klarnaCreatePaymentUrl is not configured.',
        method: 'klarna',
        provider: 'klarna',
      });
    }

    const metadata = assertMerchantMetadata(product.metadata, 'klarna', 'klarna');
    const response = await this.backend.createKlarnaPayment({
      productId: product.id,
      quantity: product.quantity ?? 1,
      currency: product.currency,
      ...(preferredLocale?.trim() ? { preferredLocale: preferredLocale.trim() } : {}),
      ...(metadata ? { metadata } : {}),
    });
    this.assertValidKlarnaResponse(response);

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
      session.paymentElement = elements.create('payment', KLARNA_PAYMENT_ELEMENT_OPTIONS);
      session.paymentElement.mount(container);
    } catch (error) {
      throw new PaymentError({
        code: 'SDK_LOAD_FAILED',
        message: 'Klarna Payment Element failed to initialize.',
        method: 'klarna',
        provider: 'klarna',
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
        message: 'A Klarna payment confirmation is already in progress.',
        method: 'klarna',
        provider: 'klarna',
      });
    }

    const release = this.gate.acquire(`klarna:${ownerId ?? 'legacy'}`, 'klarna', 'klarna');
    session.confirming = true;

    try {
      const stripe = await this.ensureStripeLoaded();
      const elements = session.elements;
      if (!elements) {
        throw new PaymentError({
          code: 'PROVIDER_UNAVAILABLE',
          message: 'Klarna Payment Element is not ready.',
          method: 'klarna',
          provider: 'klarna',
        });
      }

      const { error: submitError } = await elements.submit();
      if (submitError) {
        throw mapKlarnaStripeError(submitError);
      }

      // Klarna is redirect-based. Stamp ep_method=klarna on return_url so the
      // remounted app can resume as Klarna (Stripe preserves custom query params).
      const resolvedReturnUrl = this.browser.isBrowser
        ? buildKlarnaReturnUrl(returnUrl)
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
        throw mapKlarnaStripeError(error);
      }

      // When Klarna redirects, confirmPayment does not resolve in this page —
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
    return this.redirectRecovery.retrieveReturningPayment('klarna', clientSecret);
  }

  /**
   * Idempotent Klarna redirect recovery — delegates to shared Stripe BNPL recovery.
   */
  consumeStripeReturn(): Promise<PaymentResult | null> {
    return this.redirectRecovery.consumeReturn();
  }

  /** True after a Stripe BNPL return was consumed on this page load. */
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

  private assertValidKlarnaResponse(response: CreateKlarnaPaymentResponse): void {
    if (!response || typeof response !== 'object') {
      throw new PaymentError({
        code: 'BACKEND_ERROR',
        message: 'Backend returned an invalid Klarna payment response.',
        method: 'klarna',
        provider: 'klarna',
      });
    }

    if (response.provider && response.provider !== 'klarna') {
      throw new PaymentError({
        code: 'BACKEND_ERROR',
        message: 'Backend response provider must be "klarna".',
        method: 'klarna',
        provider: 'klarna',
      });
    }

    if (!response.clientSecret || typeof response.clientSecret !== 'string') {
      throw new PaymentError({
        code: 'BACKEND_ERROR',
        message: 'Backend did not return a Klarna clientSecret.',
        method: 'klarna',
        provider: 'klarna',
      });
    }
  }

  private normalizeIntent(
    paymentIntent: PaymentIntentLike | undefined,
    session: StripeElementSession,
  ): PaymentResult {
    const status = paymentIntent?.status;

    // Terminal success only. Do not treat `processing` as success — Klarna may
    // still be settling asynchronously after customer authorization.
    if (status === 'succeeded') {
      return normalizePaymentResult({
        status: 'success',
        method: 'klarna',
        provider: 'klarna',
        transactionId: paymentIntent?.id ?? session.paymentIntentId,
        sessionId: session.sessionId,
        message: 'Klarna payment completed successfully.',
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
        method: 'klarna',
        provider: 'klarna',
        transactionId: paymentIntent?.id ?? session.paymentIntentId,
        sessionId: session.sessionId,
        message:
          'Klarna payment is authorized and requires capture. Confirm capture and fulfillment on your backend — this is not proof of captured funds.',
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
        method: 'klarna',
        provider: 'klarna',
        transactionId: paymentIntent?.id ?? session.paymentIntentId,
        sessionId: session.sessionId,
        message: 'Klarna payment was cancelled.',
        metadata: {
          gateway: 'stripe',
        },
      });
    }

    if (status === 'requires_payment_method') {
      throw new PaymentError({
        code: 'PAYMENT_FAILED',
        message: 'Klarna payment was not completed. Please try again.',
        method: 'klarna',
        provider: 'klarna',
        originalError: paymentIntent,
      });
    }

    if (status === 'requires_action' || status === 'requires_confirmation') {
      throw new PaymentError({
        code: 'AUTHENTICATION_REQUIRED',
        message: 'Klarna payment still requires additional customer action.',
        method: 'klarna',
        provider: 'klarna',
        originalError: paymentIntent,
      });
    }

    if (status === 'processing') {
      return normalizePaymentResult({
        status: 'processing',
        method: 'klarna',
        provider: 'klarna',
        transactionId: paymentIntent?.id ?? session.paymentIntentId,
        sessionId: session.sessionId,
        message:
          'Klarna payment is still processing. Do not retry — confirm the final status on your backend.',
        metadata: { stripeStatus: status, gateway: 'stripe' },
      });
    }

    throw new PaymentError({
      code: 'PAYMENT_FAILED',
      message: `Unexpected PaymentIntent status: ${status ?? 'unknown'}.`,
      method: 'klarna',
      provider: 'klarna',
      originalError: paymentIntent,
    });
  }
}

interface PaymentIntentLike {
  id?: string;
  status?: string;
}

@Injectable({ providedIn: 'root' })
export class KlarnaMockAdapter extends BaseMockAdapter {
  readonly provider = 'klarna' as const;
  readonly method = 'klarna' as const;
}
