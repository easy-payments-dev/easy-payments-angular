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
import { CreatePaymentRequest, CreateStripePaymentResponse } from '../../models/create-payment.model';
import { buildStripeRequestMetadata } from '../../metadata/merchant-metadata';
import { PaymentError } from '../../errors/payment-error';
import { BackendService } from '../../services/backend.service';
import { BrowserGuard } from '../../utils/browser-guard';
import { BaseMockAdapter, BaseProviderAdapter } from '../base.adapter';
import {
  mapResolvedThemeToStripeAppearance,
  STRIPE_PAYMENT_ELEMENT_OPTIONS,
} from './stripe-appearance';
import { StripeConfirmationGate } from './stripe-confirmation-gate';
import { resolveSameOriginStripeReturnUrl } from './stripe-redirect-return';
import { StripeElementSession, StripeElementSessionStore } from './stripe-element-sessions';
import { mapStripeError } from './stripe-error.mapper';
import { StripeSdkLoader } from './stripe-sdk.loader';
import { StripeSessionResult } from './stripe.types';

function looksLikeSecretKey(value: string): boolean {
  return /^sk_(test|live)_/i.test(value.trim());
}

function looksLikePublishableKey(value: string): boolean {
  return /^pk_(test|live)_/i.test(value.trim());
}

@Injectable({ providedIn: 'root' })
export class StripeCardAdapter extends BaseProviderAdapter {
  readonly provider = 'stripe' as const;

  private readonly configService = inject(EasyPaymentsConfigService);
  private readonly backend = inject(BackendService);
  private readonly browser = inject(BrowserGuard);
  private readonly sdkLoader = inject(StripeSdkLoader);

  private readonly gate = inject(StripeConfirmationGate);

  private stripe: Stripe | null = null;
  private readonly sessions = new StripeElementSessionStore();
  private loadPromise: Promise<Stripe> | null = null;
  private configReady = false;

  /**
   * Validates Stripe frontend config only. Does not load Stripe.js until needed.
   */
  async initialize(): Promise<void> {
    const stripeConfig = this.configService.getSnapshot().providers?.stripe;
    const key = stripeConfig?.publishableKey?.trim() ?? '';

    if (!key) {
      this.configReady = false;
      this.initialized = false;
      return;
    }

    if (looksLikeSecretKey(key)) {
      this.configReady = false;
      this.initialized = false;
      throw new PaymentError({
        code: 'CONFIG_INVALID',
        message:
          'Stripe secret keys must never be used in Angular. Provide a publishable key (pk_...) only.',
        method: 'card',
        provider: 'stripe',
      });
    }

    this.configReady = true;
    this.initialized = true;
  }

  async isAvailable(_context: PaymentContext): Promise<boolean> {
    const snapshot = this.configService.getSnapshot();
    const key = snapshot.providers?.stripe?.publishableKey?.trim() ?? '';
    if (!key || looksLikeSecretKey(key) || !this.configReady) {
      return false;
    }
    if (!backendEndpointUrl(snapshot.backend, snapshot.backend?.createPaymentUrl)) {
      return false;
    }
    return true;
  }

  /**
   * Interactive Stripe Payment Element flow is handled by StripeCardPaymentComponent.
   * Calling createPayment directly is not supported for real card payments.
   */
  async createPayment(_request: PaymentRequest): Promise<PaymentResult> {
    throw new PaymentError({
      code: 'PROVIDER_UNAVAILABLE',
      message:
        'Stripe card payments require the secure Payment Element UI. Use the card method inside <easy-payments>.',
      method: 'card',
      provider: 'stripe',
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
        message: 'Stripe publishableKey is missing.',
        method: 'card',
        provider: 'stripe',
      });
    }

    if (looksLikeSecretKey(key)) {
      throw new PaymentError({
        code: 'CONFIG_INVALID',
        message:
          'Stripe secret keys must never be used in Angular. Provide a publishable key (pk_...) only.',
        method: 'card',
        provider: 'stripe',
      });
    }

    if (!looksLikePublishableKey(key)) {
      throw new PaymentError({
        code: 'CONFIG_INVALID',
        message: 'Stripe publishableKey appears invalid. Expected a pk_test_... or pk_live_... value.',
        method: 'card',
        provider: 'stripe',
      });
    }

    if (!this.browser.isBrowser) {
      throw new PaymentError({
        code: 'PROVIDER_UNAVAILABLE',
        message: 'Stripe.js can only load in the browser.',
        method: 'card',
        provider: 'stripe',
      });
    }

    this.loadPromise = (async () => {
      try {
        const stripe = await this.sdkLoader.load(key);
        if (!stripe) {
          throw new PaymentError({
            code: 'SDK_LOAD_FAILED',
            message: 'Stripe.js failed to initialize.',
            method: 'card',
            provider: 'stripe',
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
          method: 'card',
          provider: 'stripe',
          originalError: error,
        });
      }
    })();

    return this.loadPromise;
  }

  async createPaymentSession(
    product: PaymentProduct,
    checkout?: CheckoutOptions,
    ownerId?: string,
  ): Promise<StripeSessionResult> {
    if (!this.configService.getSnapshot().backend?.createPaymentUrl?.trim()) {
      throw new PaymentError({
        code: 'BACKEND_ERROR',
        message: 'Backend createPaymentUrl is not configured.',
        method: 'card',
        provider: 'stripe',
      });
    }

    const payload: CreatePaymentRequest = {
      provider: 'stripe',
      productId: product.id,
      quantity: product.quantity ?? 1,
      currency: product.currency,
      // Sent for local demos only — production backends must re-price server-side.
      amount: product.amount,
      metadata: buildStripeRequestMetadata(
        product.metadata,
        {
          productName: product.name,
          productDescription: product.description,
          customerEmail: checkout?.customer?.email,
          customerName: checkout?.customer?.name,
        },
        'card',
        'stripe',
      ),
    };

    const response = await this.backend.createStripePayment(payload);
    this.assertValidStripeResponse(response);

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
      session.paymentElement = elements.create('payment', STRIPE_PAYMENT_ELEMENT_OPTIONS);
      session.paymentElement.mount(container);
    } catch (error) {
      throw new PaymentError({
        code: 'SDK_LOAD_FAILED',
        message: 'Stripe Payment Element failed to initialize.',
        method: 'card',
        provider: 'stripe',
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
        message: 'A Stripe payment confirmation is already in progress.',
        method: 'card',
        provider: 'stripe',
      });
    }

    const release = this.gate.acquire(`card:${ownerId ?? 'legacy'}`, 'card', 'stripe');
    session.confirming = true;

    try {
      const stripe = await this.ensureStripeLoaded();
      const elements = session.elements;
      if (!elements) {
        throw new PaymentError({
          code: 'PROVIDER_UNAVAILABLE',
          message: 'Stripe Payment Element is not ready.',
          method: 'card',
          provider: 'stripe',
        });
      }

      const { error: submitError } = await elements.submit();
      if (submitError) {
        throw mapStripeError(submitError);
      }

      const resolvedReturnUrl = returnUrl?.trim()
        ? resolveSameOriginStripeReturnUrl(returnUrl, undefined, 'card').href
        : this.browser.isBrowser
          ? `${window.location.origin}${window.location.pathname}`
          : undefined;

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
        throw mapStripeError(error);
      }

      return this.normalizeIntent(paymentIntent, session);
    } finally {
      session.confirming = false;
      release();
    }
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

  private assertValidStripeResponse(response: CreateStripePaymentResponse): void {
    if (!response || typeof response !== 'object') {
      throw new PaymentError({
        code: 'BACKEND_ERROR',
        message: 'Backend returned an invalid Stripe payment response.',
        method: 'card',
        provider: 'stripe',
      });
    }

    if (response.provider && response.provider !== 'stripe') {
      throw new PaymentError({
        code: 'BACKEND_ERROR',
        message: 'Backend response provider must be "stripe".',
        method: 'card',
        provider: 'stripe',
      });
    }

    if (!response.clientSecret || typeof response.clientSecret !== 'string') {
      throw new PaymentError({
        code: 'BACKEND_ERROR',
        message: 'Backend did not return a Stripe clientSecret.',
        method: 'card',
        provider: 'stripe',
      });
    }
  }

  private normalizeIntent(
    paymentIntent: PaymentIntentLike | undefined,
    session: StripeElementSession,
  ): PaymentResult {
    const status = paymentIntent?.status;

    if (status === 'processing') {
      // Not success and not a definitive failure. Do not retry; backend/webhook is authoritative.
      return normalizePaymentResult({
        status: 'processing',
        method: 'card',
        provider: 'stripe',
        transactionId: paymentIntent?.id ?? session.paymentIntentId,
        sessionId: session.sessionId,
        message:
          'Card payment is still processing. Do not retry — confirm the final status on your backend.',
        metadata: { stripeStatus: status },
      });
    }

    if (status === 'succeeded') {
      return normalizePaymentResult({
        status: 'success',
        method: 'card',
        provider: 'stripe',
        transactionId: paymentIntent?.id ?? session.paymentIntentId,
        sessionId: session.sessionId,
        message: 'Card payment completed successfully.',
        metadata: {
          stripeStatus: status,
        },
      });
    }

    if (status === 'requires_capture') {
      // Public status stays "success" for compatibility; metadata marks authorization-only.
      return normalizePaymentResult({
        status: 'success',
        method: 'card',
        provider: 'stripe',
        transactionId: paymentIntent?.id ?? session.paymentIntentId,
        sessionId: session.sessionId,
        message:
          'Card payment is authorized and requires capture. Confirm capture and fulfillment on your backend — this is not proof of captured funds.',
        metadata: {
          stripeStatus: status,
          authorizationOnly: true,
        },
      });
    }

    if (status === 'canceled') {
      return normalizePaymentResult({
        status: 'cancelled',
        method: 'card',
        provider: 'stripe',
        transactionId: paymentIntent?.id ?? session.paymentIntentId,
        sessionId: session.sessionId,
        message: 'Card payment was cancelled.',
      });
    }

    throw new PaymentError({
      code: 'PAYMENT_FAILED',
      message: `Unexpected PaymentIntent status: ${status ?? 'unknown'}.`,
      method: 'card',
      provider: 'stripe',
      originalError: paymentIntent,
    });
  }
}

interface PaymentIntentLike {
  id?: string;
  status?: string;
}

@Injectable({ providedIn: 'root' })
export class StripeCardMockAdapter extends BaseMockAdapter {
  readonly provider = 'stripe' as const;
  readonly method = 'card' as const;
}
