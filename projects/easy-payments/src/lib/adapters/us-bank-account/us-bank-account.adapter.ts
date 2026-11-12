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
import { CreateUsBankAccountPaymentResponse } from '../../models/create-payment.model';
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
import { logAchLifecycle } from './us-bank-account-lifecycle';
import {
  ACH_CONFIRM_HANG_MS,
  ACH_RECONCILE_DELAY_MS,
  ACH_RECONCILE_MAX_ATTEMPTS,
  ACH_RETRIEVE_TIMEOUT_MS,
  buildAchReturnUrl,
  delay as achDelay,
} from './us-bank-account-return';
import {
  US_BANK_ACCOUNT_PAYMENT_ELEMENT_OPTIONS,
  UsBankAccountSessionResult,
} from './us-bank-account.types';

/** ACH Direct Debit via Stripe is US-dollar presentment for this milestone. */
const US_BANK_ACCOUNT_SUPPORTED_CURRENCIES = new Set(['USD']);

function looksLikeSecretKey(value: string): boolean {
  return /^sk_(test|live)_/i.test(value.trim());
}

function looksLikePublishableKey(value: string): boolean {
  return /^pk_(test|live)_/i.test(value.trim());
}

function mapUsBankAccountStripeError(error: unknown): PaymentError {
  const mapped = mapStripeError(error);
  return new PaymentError({
    code: mapped.code,
    message: mapped.message,
    method: 'us-bank-account',
    provider: 'usBankAccount',
    originalError: mapped.originalError ?? error,
  });
}

@Injectable({ providedIn: 'root' })
export class UsBankAccountAdapter extends BaseProviderAdapter {
  readonly provider = 'usBankAccount' as const;

  private readonly configService = inject(EasyPaymentsConfigService);
  private readonly backend = inject(BackendService);
  private readonly browser = inject(BrowserGuard);
  private readonly sdkLoader = inject(StripeSdkLoader);
  private readonly gate = inject(StripeConfirmationGate);

  private stripe: Stripe | null = null;
  private readonly sessions = new StripeElementSessionStore();
  private readonly confirmEpochByOwner = new Map<string, number>();
  private loadPromise: Promise<Stripe> | null = null;
  private configReady = false;

  /**
   * Validates ACH + Stripe gateway config only. Does not load Stripe.js until needed.
   */
  async initialize(): Promise<void> {
    const snapshot = this.configService.getSnapshot();
    const usBankAccount = snapshot.providers?.usBankAccount;
    const stripeKey = snapshot.providers?.stripe?.publishableKey?.trim() ?? '';

    if (!usBankAccount || typeof usBankAccount !== 'object') {
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
    if (!snapshot.providers?.usBankAccount || !this.configReady) {
      return false;
    }
    if (!key || looksLikeSecretKey(key) || !looksLikePublishableKey(key)) {
      return false;
    }
    if (!backendEndpointUrl(snapshot.backend, snapshot.backend?.createUsBankAccountPaymentUrl)) {
      return false;
    }
    if (!US_BANK_ACCOUNT_SUPPORTED_CURRENCIES.has(context.product.currency)) {
      return false;
    }
    if (context.product.amount <= 0) {
      return false;
    }
    return true;
  }

  /**
   * Interactive ACH Payment Element flow is handled by UsBankAccountPaymentComponent.
   * Calling createPayment directly is not supported for real ACH payments.
   */
  async createPayment(_request: PaymentRequest): Promise<PaymentResult> {
    throw new PaymentError({
      code: 'PROVIDER_UNAVAILABLE',
      message:
        'US bank account payments require the secure Payment Element UI. Use the us-bank-account method in Full Checkout, Payment Buttons Only, or Headless Checkout.',
      method: 'us-bank-account',
      provider: 'usBankAccount',
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
        message: 'Stripe publishableKey is missing (required for ACH via Stripe).',
        method: 'us-bank-account',
        provider: 'usBankAccount',
      });
    }

    if (looksLikeSecretKey(key)) {
      throw new PaymentError({
        code: 'CONFIG_INVALID',
        message:
          'Stripe secret keys must never be used in Angular. Provide a publishable key (pk_...) only.',
        method: 'us-bank-account',
        provider: 'usBankAccount',
      });
    }

    if (!looksLikePublishableKey(key)) {
      throw new PaymentError({
        code: 'CONFIG_INVALID',
        message: 'Stripe publishableKey appears invalid. Expected a pk_test_... or pk_live_... value.',
        method: 'us-bank-account',
        provider: 'usBankAccount',
      });
    }

    if (!this.browser.isBrowser) {
      throw new PaymentError({
        code: 'PROVIDER_UNAVAILABLE',
        message: 'Stripe.js can only load in the browser.',
        method: 'us-bank-account',
        provider: 'usBankAccount',
      });
    }

    this.loadPromise = (async () => {
      try {
        const stripe = await this.sdkLoader.load(key);
        if (!stripe) {
          throw new PaymentError({
            code: 'SDK_LOAD_FAILED',
            message: 'Stripe.js failed to initialize.',
            method: 'us-bank-account',
            provider: 'usBankAccount',
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
          method: 'us-bank-account',
          provider: 'usBankAccount',
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
  ): Promise<UsBankAccountSessionResult> {
    if (!this.configService.getSnapshot().backend?.createUsBankAccountPaymentUrl?.trim()) {
      throw new PaymentError({
        code: 'BACKEND_ERROR',
        message: 'Backend createUsBankAccountPaymentUrl is not configured.',
        method: 'us-bank-account',
        provider: 'usBankAccount',
      });
    }

    const metadata = assertMerchantMetadata(product.metadata, 'us-bank-account', 'usBankAccount');
    const response = await this.backend.createUsBankAccountPayment({
      productId: product.id,
      quantity: product.quantity ?? 1,
      currency: product.currency,
      ...(metadata ? { metadata } : {}),
    });
    this.assertValidResponse(response);

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
      session.paymentElement = elements.create('payment', US_BANK_ACCOUNT_PAYMENT_ELEMENT_OPTIONS);
      session.paymentElement.mount(container);
    } catch (error) {
      throw new PaymentError({
        code: 'SDK_LOAD_FAILED',
        message: 'US bank account Payment Element failed to initialize.',
        method: 'us-bank-account',
        provider: 'usBankAccount',
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
        message: 'A US bank account payment confirmation is already in progress.',
        method: 'us-bank-account',
        provider: 'usBankAccount',
      });
    }

    const release = this.gate.acquire(
      `us-bank-account:${ownerId ?? 'legacy'}`,
      'us-bank-account',
      'usBankAccount',
    );
    session.confirming = true;
    const ownerKey = ownerId ?? 'legacy';
    const confirmEpoch = (this.confirmEpochByOwner.get(ownerKey) ?? 0) + 1;
    this.confirmEpochByOwner.set(ownerKey, confirmEpoch);

    try {
      const stripe = await this.ensureStripeLoaded();
      const elements = session.elements;
      if (!elements) {
        throw new PaymentError({
          code: 'PROVIDER_UNAVAILABLE',
          message: 'US bank account Payment Element is not ready.',
          method: 'us-bank-account',
          provider: 'usBankAccount',
        });
      }

      const { error: submitError } = await elements.submit();
      if (submitError) {
        throw mapUsBankAccountStripeError(submitError);
      }

      // Always stamp return_url with ep_method=us-bank-account (card parity + ACH recovery).
      // Prefer in-page completion via redirect: 'if_required'. When confirmPayment hangs
      // (next-action / remount), reconcile the SAME client secret via retrieve only.
      const resolvedReturnUrl = this.browser.isBrowser
        ? buildAchReturnUrl(returnUrl?.trim() || undefined)
        : returnUrl?.trim() || undefined;

      logAchLifecycle('confirm_started', {
        paymentIntentId: session.paymentIntentId,
        status: 'confirming',
      });

      const confirmPromise = stripe
        .confirmPayment({
          elements,
          confirmParams: resolvedReturnUrl
            ? {
                return_url: resolvedReturnUrl,
              }
            : undefined,
          redirect: 'if_required',
        })
        .then((result) => ({ kind: 'confirm' as const, result, epoch: confirmEpoch }));

      const reconcilePromise = this.reconcileWhenConfirmHangs(
        stripe,
        session.clientSecret,
        ownerKey,
        confirmEpoch,
        session.paymentIntentId,
      ).then((paymentIntent) => ({
        kind: 'reconcile' as const,
        paymentIntent,
        epoch: confirmEpoch,
      }));

      const winner = await Promise.race([confirmPromise, reconcilePromise]);

      // Late/superseded attempt — do not emit a second success/pending.
      if (winner.epoch !== this.confirmEpochByOwner.get(ownerKey)) {
        return this.statusCheckResult(session);
      }

      if (winner.kind === 'confirm') {
        const { error, paymentIntent } = winner.result;
        if (error) {
          throw mapUsBankAccountStripeError(error);
        }
        let intent: PaymentIntentLike | undefined = paymentIntent ?? undefined;
        if (!intent && session.clientSecret) {
          intent = await this.retrieveIntent(stripe, session.clientSecret);
        }
        logAchLifecycle('confirm_resolved', {
          paymentIntentId: intent?.id ?? session.paymentIntentId,
          status: intent?.status ?? 'unknown',
        });
        return this.normalizeIntent(intent, session);
      }

      if (winner.paymentIntent === null) {
        return this.statusCheckResult(session);
      }
      logAchLifecycle('confirm_hang_reconcile', {
        paymentIntentId: winner.paymentIntent.id ?? session.paymentIntentId,
        status: winner.paymentIntent.status ?? 'unknown',
      });
      return this.normalizeIntent(winner.paymentIntent, session);
    } finally {
      session.confirming = false;
      release();
    }
  }

  /**
   * Recover an ACH PaymentIntent after a browser return. Retrieves only —
   * never creates or confirms a second payment.
   */
  async recoverReturningPayment(clientSecret: string): Promise<PaymentResult> {
    logAchLifecycle('return_recover_started', { status: 'retrieving' });
    const stripe = await this.ensureStripeLoaded();
    const intent = await this.retrieveIntent(stripe, clientSecret.trim());
    logAchLifecycle('return_recover_resolved', {
      paymentIntentId: intent?.id ?? null,
      status: intent?.status ?? 'unknown',
    });
    return this.normalizeIntent(intent, {
      elements: null,
      paymentElement: null,
      clientSecret: clientSecret.trim(),
      sessionId: undefined,
      paymentIntentId: intent?.id,
      confirming: false,
    });
  }

  /**
   * After confirmPayment appears hung, poll retrievePaymentIntent for the same
   * client secret until a settled/processing status or attempts are exhausted.
   * Returns null when status remains unknown.
   */
  private async reconcileWhenConfirmHangs(
    stripe: Stripe,
    clientSecret: string | null,
    ownerKey: string,
    epoch: number,
    paymentIntentId?: string | null,
  ): Promise<PaymentIntentLike | null> {
    await achDelay(ACH_CONFIRM_HANG_MS);
    if (this.confirmEpochByOwner.get(ownerKey) !== epoch || !clientSecret) {
      return null;
    }

    for (let attempt = 0; attempt < ACH_RECONCILE_MAX_ATTEMPTS; attempt++) {
      if (this.confirmEpochByOwner.get(ownerKey) !== epoch) {
        return null;
      }
      try {
        const intent = await this.retrieveIntent(stripe, clientSecret);
        const status = intent?.status;
        logAchLifecycle('reconcile_status', {
          paymentIntentId: intent?.id ?? paymentIntentId ?? null,
          status: status ?? 'unknown',
        });
        if (
          status === 'succeeded' ||
          status === 'processing' ||
          status === 'requires_capture' ||
          status === 'canceled'
        ) {
          return intent ?? null;
        }
        // requires_action / requires_confirmation / requires_payment_method: keep polling briefly
      } catch {
        // Transient retrieve errors — retry within the bound.
      }
      if (attempt < ACH_RECONCILE_MAX_ATTEMPTS - 1) {
        await achDelay(ACH_RECONCILE_DELAY_MS);
      }
    }
    logAchLifecycle('reconcile_exhausted', {
      paymentIntentId: paymentIntentId ?? null,
      status: 'unknown',
    });
    return null;
  }

  private async retrieveIntent(
    stripe: Stripe,
    clientSecret: string,
  ): Promise<PaymentIntentLike | undefined> {
    // Real timer (not achDelay) so hang-reconcile test stubs cannot instant-timeout retrieves.
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    try {
      const { paymentIntent, error } = await Promise.race([
        stripe.retrievePaymentIntent(clientSecret),
        new Promise<never>((_, reject) => {
          timeoutId = setTimeout(() => {
            reject(
              new PaymentError({
                code: 'NETWORK_ERROR',
                message: 'Timed out retrieving the US bank account PaymentIntent.',
                method: 'us-bank-account',
                provider: 'usBankAccount',
              }),
            );
          }, ACH_RETRIEVE_TIMEOUT_MS);
        }),
      ]);
      if (error) {
        throw mapUsBankAccountStripeError(error);
      }
      return paymentIntent ?? undefined;
    } finally {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }
    }
  }

  private statusCheckResult(session: StripeElementSession): PaymentResult {
    return normalizePaymentResult({
      status: 'processing',
      method: 'us-bank-account',
      provider: 'usBankAccount',
      transactionId: session.paymentIntentId,
      sessionId: session.sessionId,
      message:
        'We could not verify the final US bank account payment status in this browser. Do not pay again — confirm the outcome on your backend via Stripe webhooks.',
      metadata: {
        gateway: 'stripe',
        statusCheck: true,
        stripeStatus: 'unknown',
      },
    });
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

  async destroy(ownerId?: string): Promise<void> {
    this.sessions.destroy(ownerId);
  }

  private assertValidResponse(response: CreateUsBankAccountPaymentResponse): void {
    if (!response || typeof response !== 'object') {
      throw new PaymentError({
        code: 'BACKEND_ERROR',
        message: 'Backend returned an invalid US bank account payment response.',
        method: 'us-bank-account',
        provider: 'usBankAccount',
      });
    }

    if (response.provider && response.provider !== 'usBankAccount') {
      throw new PaymentError({
        code: 'BACKEND_ERROR',
        message: 'Backend response provider must be "usBankAccount".',
        method: 'us-bank-account',
        provider: 'usBankAccount',
      });
    }

    if (!response.clientSecret || typeof response.clientSecret !== 'string') {
      throw new PaymentError({
        code: 'BACKEND_ERROR',
        message: 'Backend did not return a US bank account clientSecret.',
        method: 'us-bank-account',
        provider: 'usBankAccount',
      });
    }
  }

  private normalizeIntent(
    paymentIntent: PaymentIntentLike | undefined,
    session: StripeElementSession,
  ): PaymentResult {
    const status = paymentIntent?.status;

    // ACH commonly lands on processing while the bank debit settles.
    // Never treat processing / verification as success.
    if (status === 'processing') {
      return normalizePaymentResult({
        status: 'processing',
        method: 'us-bank-account',
        provider: 'usBankAccount',
        transactionId: paymentIntent?.id ?? session.paymentIntentId,
        sessionId: session.sessionId,
        message:
          'US bank account payment is still processing. Do not retry — confirm the final status on your backend via Stripe webhooks.',
        metadata: { stripeStatus: status, gateway: 'stripe' },
      });
    }

    if (status === 'succeeded') {
      return normalizePaymentResult({
        status: 'success',
        method: 'us-bank-account',
        provider: 'usBankAccount',
        transactionId: paymentIntent?.id ?? session.paymentIntentId,
        sessionId: session.sessionId,
        message: 'US bank account payment completed successfully.',
        metadata: {
          stripeStatus: status,
          gateway: 'stripe',
        },
      });
    }

    if (status === 'requires_capture') {
      return normalizePaymentResult({
        status: 'success',
        method: 'us-bank-account',
        provider: 'usBankAccount',
        transactionId: paymentIntent?.id ?? session.paymentIntentId,
        sessionId: session.sessionId,
        message:
          'US bank account payment is authorized and requires capture. Confirm capture and fulfillment on your backend — this is not proof of captured funds.',
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
        method: 'us-bank-account',
        provider: 'usBankAccount',
        transactionId: paymentIntent?.id ?? session.paymentIntentId,
        sessionId: session.sessionId,
        message: 'US bank account payment was cancelled.',
        metadata: {
          gateway: 'stripe',
        },
      });
    }

    if (status === 'requires_payment_method') {
      throw new PaymentError({
        code: 'PAYMENT_FAILED',
        message: 'US bank account payment was not completed. Please try again.',
        method: 'us-bank-account',
        provider: 'usBankAccount',
        originalError: paymentIntent,
      });
    }

    if (status === 'requires_action' || status === 'requires_confirmation') {
      // Microdeposit / Financial Connections verification still outstanding —
      // not success. Merchants must not fulfill on this browser event.
      throw new PaymentError({
        code: 'AUTHENTICATION_REQUIRED',
        message:
          'US bank account payment still requires verification or additional customer action. Confirm the final status on your backend.',
        method: 'us-bank-account',
        provider: 'usBankAccount',
        originalError: paymentIntent,
      });
    }

    throw new PaymentError({
      code: 'PAYMENT_FAILED',
      message: `Unexpected PaymentIntent status: ${status ?? 'unknown'}.`,
      method: 'us-bank-account',
      provider: 'usBankAccount',
      originalError: paymentIntent,
    });
  }
}

interface PaymentIntentLike {
  id?: string;
  status?: string;
}

@Injectable({ providedIn: 'root' })
export class UsBankAccountMockAdapter extends BaseMockAdapter {
  readonly provider = 'usBankAccount' as const;
  readonly method = 'us-bank-account' as const;
}
