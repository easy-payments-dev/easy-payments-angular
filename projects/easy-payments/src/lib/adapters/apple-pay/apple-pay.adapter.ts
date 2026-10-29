import { inject, Injectable, signal } from '@angular/core';
import type {
  Stripe,
  StripeElements,
  StripeExpressCheckoutElement,
  StripeElementLocale,
} from '@stripe/stripe-js';
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
import { mapApplePayError } from './apple-pay-error.mapper';
import {
  ApplePayAvailabilityState,
  buildApplePayRenderKey,
  toStripeAmountCents,
} from './apple-pay.types';

/**
 * Stripe Express Checkout Element availability helpers.
 * Prefer boolean `ready.availablePaymentMethods.applePay`.
 * Also support change-event shape `{ applePay: { available: boolean } }`.
 *
 * Change-event shape: `{ applePay: { available: boolean }, ... } | undefined`
 * Ready-event shape: `{ applePay: boolean, ... } | undefined`
 */
export function isApplePayAvailableFromPaymentMethods(paymentMethods: unknown): boolean {
  if (!paymentMethods || typeof paymentMethods !== 'object') {
    return false;
  }
  const apple = (paymentMethods as Record<string, unknown>)['applePay'];
  if (apple === true) {
    return true;
  }
  if (apple && typeof apple === 'object') {
    return (apple as { available?: boolean }).available === true;
  }
  return false;
}

/** Per-host Stripe Express Checkout Element mount owned by one payment component. */
interface ApplePayEceMount {
  readonly id: string;
  host: HTMLElement;
  elements: StripeElements | null;
  expressCheckout: StripeExpressCheckoutElement | null;
  successHandler: ((result: PaymentResult) => void) | null;
  cancelHandler: (() => void) | null;
  errorHandler: ((error: PaymentError) => void) | null;
  /** Race guard for async Stripe load vs remount of this id. */
  token: number;
}

@Injectable({ providedIn: 'root' })
export class ApplePayAdapter extends BaseProviderAdapter {
  readonly provider = 'applePay' as const;

  private readonly configService = inject(EasyPaymentsConfigService);
  private readonly backend = inject(BackendService);
  private readonly browser = inject(BrowserGuard);
  private readonly stripeSdk = inject(StripeSdkLoader);

  private stripe: Stripe | null = null;
  private configReady = false;
  private readonly configReadySignal = signal(false);
  /** Shared confirm guard — concurrent live Apple Pay confirms are not isolated. */
  private processing = false;

  /**
   * Ownership-scoped ECE mounts.
   * Omit `mountId` on mount/unmount to use {@link LEGACY_SINGLETON_MOUNT_ID}
   * (Ready-to-Use Checkout single-host remount path).
   */
  private readonly mounts = new Map<string, ApplePayEceMount>();
  private nextMountSeq = 0;
  static readonly LEGACY_SINGLETON_MOUNT_ID = 'apple-pay-ece-legacy';

  private availabilityState: ApplePayAvailabilityState = 'idle';
  private availabilitySessionKey: string | null = null;
  private readyFired = false;
  private lastAvailablePaymentMethods: unknown = null;
  private availabilityListener: ((state: ApplePayAvailabilityState) => void) | null = null;

  private abortedMounts = 0;

  isConfigured(): boolean {
    return this.configReadySignal();
  }

  /** Reactive config readiness for Apple Pay bootstrap mounting. */
  readonly configured = this.configReadySignal.asReadonly();

  getAvailabilityStatus(): ApplePayAvailabilityState {
    return this.availabilityState;
  }

  /**
   * Optional UI hook — fired when production availability state changes
   * (e.g. after ECE `ready`). Use to call orchestrator.refreshAvailability.
   */
  setAvailabilityListener(listener: ((state: ApplePayAvailabilityState) => void) | null): void {
    this.availabilityListener = listener;
  }

  /**
   * Validates Apple Pay + Stripe gateway prerequisites.
   * Does not load Stripe.js until availability or mount.
   */
  async initialize(): Promise<void> {
    const snapshot = this.configService.getSnapshot();
    const applePay = snapshot.providers?.applePay;
    const stripeKey = snapshot.providers?.stripe?.publishableKey?.trim() ?? '';

    if (!applePay) {
      this.configReady = false;
      this.configReadySignal.set(false);
      this.initialized = false;
      return;
    }

    if (!stripeKey || /^sk_/i.test(stripeKey) || !/^pk_(test|live)_/i.test(stripeKey)) {
      this.configReady = false;
      this.configReadySignal.set(false);
      this.initialized = false;
      return;
    }

    if (!backendEndpointUrl(snapshot.backend, snapshot.backend?.createPaymentUrl)) {
      this.configReady = false;
      this.configReadySignal.set(false);
      this.initialized = false;
      return;
    }

    this.configReady = true;
    this.configReadySignal.set(true);
    this.initialized = true;
  }

  /**
   * Production availability from the mounted ECE `ready` event only.
   *
   * Rules:
   * - UNKNOWN (`idle` / `checking`) is never treated as available.
   * - Returns true only when Stripe reported `availablePaymentMethods.applePay`
   *   for the **current** product session key.
   * - Never uses UA sniffing, OS checks, ApplePaySession, or hidden probes.
   * - Windows / Chrome / third-party browsers are allowed when Stripe says so
   *   (including Apple Pay on the Web cross-device flows).
   */
  async isAvailable(context: PaymentContext): Promise<boolean> {
    if (!this.configReady || !this.browser.isBrowser) {
      // idle — not a definitive "unsupported" decision (bootstrap may still mount).
      this.setAvailabilityState('idle', null);
      return false;
    }

    const amount = toStripeAmountCents(context.product);
    const currency = context.product.currency.trim().toLowerCase();
    if (!Number.isFinite(amount) || amount < 1 || !currency) {
      this.setAvailabilityState('unavailable', null);
      return false;
    }

    const sessionKey = buildApplePayRenderKey(context.product);

    // Stale-session guard: a preserved `available` from a previous product/ECE
    // must not leak into a different checkout session.
    if (
      this.availabilityState === 'available' &&
      this.availabilitySessionKey !== null &&
      this.availabilitySessionKey !== sessionKey
    ) {
      this.setAvailabilityState('checking', sessionKey);
      this.readyFired = false;
      this.lastAvailablePaymentMethods = null;
      return false;
    }

    if (
      this.availabilityState === 'available' &&
      this.availabilitySessionKey === sessionKey
    ) {
      return true;
    }

    const decidedForSession =
      this.availabilitySessionKey === sessionKey &&
      (this.availabilityState === 'available' ||
        this.availabilityState === 'unavailable' ||
        this.availabilityState === 'error');

    if (!decidedForSession) {
      // Keep checking while waiting for the real ECE ready event (or remount).
      this.setAvailabilityState('checking', sessionKey);
    }

    return (
      this.availabilityState === 'available' && this.availabilitySessionKey === sessionKey
    );
  }

  async createPayment(_request: PaymentRequest): Promise<PaymentResult> {
    throw new PaymentError({
      code: 'PROVIDER_UNAVAILABLE',
      message:
        'Apple Pay requires the official Apple Pay button UI. Use the apple-pay method inside <easy-payments>.',
      method: 'apple-pay',
      provider: 'applePay',
    });
  }

  async ensureStripeLoaded(): Promise<Stripe> {
    if (this.stripe) {
      return this.stripe;
    }

    const key = this.configService.getSnapshot().providers?.stripe?.publishableKey?.trim() ?? '';
    if (!key) {
      throw new PaymentError({
        code: 'CONFIG_MISSING',
        message: 'Stripe publishableKey is required for Apple Pay.',
        method: 'apple-pay',
        provider: 'applePay',
      });
    }

    const stripe = await this.stripeSdk.load(key);
    if (!stripe) {
      throw new PaymentError({
        code: 'SDK_LOAD_FAILED',
        message: 'Stripe.js failed to load for Apple Pay.',
        method: 'apple-pay',
        provider: 'applePay',
      });
    }

    this.stripe = stripe;
    return stripe;
  }

  /** Allocates a unique ECE mount id for Payment Buttons / multi-host ownership. */
  createMountId(): string {
    this.nextMountSeq += 1;
    return `apple-pay-ece-${this.nextMountSeq}`;
  }

  /** Active ownership-scoped ECE mounts (test / diagnostics). */
  getActiveEceMountCount(): number {
    return this.mounts.size;
  }

  /**
   * Mounts Stripe Express Checkout Element with Apple Pay only.
   * Availability is decided by the `ready` event.
   * PaymentIntent is created only on confirm (not on mount).
   *
   * @param mountId Ownership token. Omit to use the legacy singleton id
   *   (Ready-to-Use Checkout). Pass an explicit id for multi-host isolation.
   * @returns The mount id to pass to {@link unmountExpressCheckout}.
   */
  async mountExpressCheckout(
    host: HTMLElement,
    options: {
      product: PaymentProduct;
      checkout?: CheckoutOptions;
      theme: ResolvedPaymentTheme;
      /** Stripe Elements locale (Easy Payments chrome is localized separately). */
      locale?: string;
      onSuccess: (result: PaymentResult) => void;
      onCancel: () => void;
      onError: (error: PaymentError) => void;
      /** Wallet confirm began. Not fired for ready, unavailable, or a duplicate confirm. */
      onAttempt?: () => void;
      onReady?: () => void;
      onUnavailable?: () => void;
      onAvailabilityChange?: (state: ApplePayAvailabilityState) => void;
    },
    mountId: string = ApplePayAdapter.LEGACY_SINGLETON_MOUNT_ID,
  ): Promise<string> {
    this.teardownMount(mountId, 'remount');

    const sessionKey = buildApplePayRenderKey(options.product);
    const keepAvailable =
      this.availabilityState === 'available' && this.availabilitySessionKey === sessionKey;
    if (!keepAvailable) {
      this.setAvailabilityState('checking', sessionKey);
      this.readyFired = false;
      this.lastAvailablePaymentMethods = null;
    }

    const mount: ApplePayEceMount = {
      id: mountId,
      host,
      elements: null,
      expressCheckout: null,
      successHandler: options.onSuccess,
      cancelHandler: options.onCancel,
      errorHandler: options.onError,
      token: 1,
    };
    this.mounts.set(mountId, mount);
    host.replaceChildren();

    const stripe = await this.ensureStripeLoaded();
    const current = this.mounts.get(mountId);
    if (!current || current !== mount) {
      // A newer remount of this id already replaced us.
      this.abortedMounts += 1;
      return mountId;
    }

    const amount = toStripeAmountCents(options.product);
    if (!Number.isFinite(amount) || amount < 1) {
      this.teardownMount(mountId, 'destroy');
      throw new PaymentError({
        code: 'PRODUCT_INVALID',
        message: 'Invalid amount for Apple Pay.',
        method: 'apple-pay',
        provider: 'applePay',
      });
    }

    const currency = options.product.currency.trim().toLowerCase();

    // Byte-for-byte parity with the known-good Minimal ECE Control on iPhone Safari.
    // Same paymentMethods contract that unlocked ready+applePay on iPhone Safari.
    // Explicitly never expose Google Pay / Link / etc. in the Apple Pay slot.
    const elements = stripe.elements({
      mode: 'payment',
      amount,
      currency,
      paymentMethodTypes: ['card'],
      ...(options.locale ? { locale: options.locale as StripeElementLocale } : {}),
    });

    const expressCheckout = elements.create('expressCheckout', {
      paymentMethods: {
        applePay: 'always',
        googlePay: 'never',
        link: 'never',
        paypal: 'never',
        amazonPay: 'never',
        klarna: 'never',
      },
      buttonHeight: 44,
    });

    mount.elements = elements;
    mount.expressCheckout = expressCheckout;

    // Listeners MUST be attached before mount (Stripe ECE docs pattern).
    expressCheckout.on('ready', (event) => {
      if (!this.mounts.has(mountId)) {
        return;
      }
      this.readyFired = true;
      this.lastAvailablePaymentMethods = event.availablePaymentMethods ?? null;
      const available = isApplePayAvailableFromPaymentMethods(event.availablePaymentMethods);
      const next: ApplePayAvailabilityState = available ? 'available' : 'unavailable';
      this.setAvailabilityState(next, sessionKey);
      options.onAvailabilityChange?.(next);
      if (available) {
        options.onReady?.();
      } else {
        options.onUnavailable?.();
      }
    });

    expressCheckout.on('cancel', () => {
      if (!this.mounts.has(mountId)) {
        return;
      }
      this.processing = false;
      mount.cancelHandler?.();
    });

    expressCheckout.on('loaderror', (event) => {
      if (!this.mounts.has(mountId)) {
        return;
      }
      this.processing = false;
      this.setAvailabilityState('error', sessionKey);
      options.onAvailabilityChange?.('error');
      const mapped = mapApplePayError(event?.error, 'SDK_LOAD_FAILED', 'Failed to load Apple Pay.');
      mount.errorHandler?.(mapped);
    });

    expressCheckout.on('confirm', async () => {
      if (!this.mounts.has(mountId) || this.processing) {
        return;
      }
      this.processing = true;
      options.onAttempt?.();
      try {
        const result = await this.confirmExpressCheckout(
          mount,
          options.product,
          options.checkout,
        );
        if (!this.mounts.has(mountId)) {
          return;
        }
        mount.successHandler?.(result);
      } catch (error) {
        if (!this.mounts.has(mountId)) {
          return;
        }
        const paymentError = mapApplePayError(error);
        if (paymentError.code === 'PAYMENT_CANCELLED') {
          mount.cancelHandler?.();
        } else {
          mount.errorHandler?.(paymentError);
        }
      } finally {
        this.processing = false;
      }
    });

    expressCheckout.mount(host);
    return mountId;
  }

  /**
   * Unmounts one ECE mount (default: legacy singleton) or clears handlers for that host.
   * Does not tear down sibling mounts when `mountId` is provided.
   */
  unmountExpressCheckout(options?: {
    preserveAvailability?: boolean;
    mountId?: string;
  }): void {
    const id = options?.mountId ?? ApplePayAdapter.LEGACY_SINGLETON_MOUNT_ID;
    this.teardownMount(id, 'destroy', options?.preserveAvailability === true);
  }

  /**
   * Clears ECE-driven availability (e.g. merchant removed `apple-pay` from methods,
   * or a brand-new checkout session must not inherit a previous ready result).
   */
  clearAvailability(): void {
    this.readyFired = false;
    this.lastAvailablePaymentMethods = null;
    this.setAvailabilityState('idle', null);
  }

  isProcessing(): boolean {
    return this.processing;
  }

  private teardownMount(
    mountId: string,
    mode: 'remount' | 'destroy',
    preserveAvailability = false,
  ): void {
    const mount = this.mounts.get(mountId);
    if (mount) {
      try {
        mount.expressCheckout?.unmount();
        mount.expressCheckout?.destroy();
      } catch {
        // Element may already be gone.
      }
      mount.expressCheckout = null;
      mount.elements = null;
      mount.successHandler = null;
      mount.cancelHandler = null;
      mount.errorHandler = null;
      try {
        mount.host.replaceChildren();
      } catch {
        // Host may already be detached.
      }
      this.mounts.delete(mountId);
    }

    if (preserveAvailability) {
      // Keep readyFired / availablePaymentMethods / availabilityState for the
      // **current session key only**. isAvailable() still requires session match.
      return;
    }

    // Only reset global availability when no other ECE mounts remain,
    // or when remounting the last/only mount into checking.
    if (this.mounts.size > 0) {
      return;
    }

    if (mode === 'remount') {
      if (this.availabilityState !== 'available') {
        this.readyFired = false;
        this.lastAvailablePaymentMethods = null;
        this.availabilityState = 'checking';
      }
    } else {
      this.readyFired = false;
      this.lastAvailablePaymentMethods = null;
      this.setAvailabilityState('idle', null);
    }
  }

  private setAvailabilityState(
    state: ApplePayAvailabilityState,
    sessionKey: string | null,
  ): void {
    const changed =
      this.availabilityState !== state || this.availabilitySessionKey !== sessionKey;
    this.availabilityState = state;
    this.availabilitySessionKey = sessionKey;
    if (changed) {
      this.availabilityListener?.(state);
    }
  }

  private async confirmExpressCheckout(
    mount: ApplePayEceMount,
    product: PaymentProduct,
    checkout?: CheckoutOptions,
  ): Promise<PaymentResult> {
    const stripe = await this.ensureStripeLoaded();
    const elements = mount.elements;
    if (!elements || !this.mounts.has(mount.id)) {
      throw new PaymentError({
        code: 'PROVIDER_UNAVAILABLE',
        message: 'Apple Pay is not ready.',
        method: 'apple-pay',
        provider: 'applePay',
      });
    }

    const { error: submitError } = await elements.submit();
    if (submitError) {
      throw mapApplePayError(submitError);
    }

    const session = await this.createPaymentSession(product, checkout);
    const returnUrl =
      this.browser.getWindow()?.location?.href?.split('#')[0] ||
      'http://localhost/';

    const { error, paymentIntent } = await stripe.confirmPayment({
      elements,
      clientSecret: session.clientSecret,
      confirmParams: {
        return_url: returnUrl,
      },
      redirect: 'if_required',
    });

    if (error) {
      throw mapApplePayError(error);
    }

    const status = paymentIntent?.status;
    if (status === 'succeeded' || status === 'processing' || status === 'requires_capture') {
      return normalizePaymentResult({
        status: 'success',
        method: 'apple-pay',
        provider: 'applePay',
        transactionId: paymentIntent?.id ?? session.paymentIntentId,
        sessionId: paymentIntent?.id ?? session.paymentIntentId,
        message: 'Apple Pay payment completed.',
        metadata: {
          processor: 'stripe',
          stripeStatus: status,
        },
      });
    }

    if (status === 'canceled') {
      return normalizePaymentResult({
        status: 'cancelled',
        method: 'apple-pay',
        provider: 'applePay',
        message: 'Apple Pay payment was cancelled.',
        sessionId: paymentIntent?.id ?? session.paymentIntentId,
      });
    }

    throw new PaymentError({
      code: 'PAYMENT_FAILED',
      message: `Apple Pay payment ended with status: ${status ?? 'unknown'}.`,
      method: 'apple-pay',
      provider: 'applePay',
    });
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
      amount: product.amount,
      metadata: buildStripeRequestMetadata(
        product.metadata,
        {
          productName: product.name,
          checkoutMethod: 'apple-pay',
          customerEmail: checkout?.customer?.email,
        },
        'apple-pay',
        'applePay',
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
          message: 'Invalid Stripe create-payment response for Apple Pay.',
          method: 'apple-pay',
          provider: 'applePay',
        });
      }
      return {
        clientSecret: response.clientSecret,
        paymentIntentId: response.paymentIntentId,
      };
    } catch (error) {
      throw mapApplePayError(error, 'BACKEND_ERROR', 'Failed to create payment session for Apple Pay.');
    }
  }

  async destroy(): Promise<void> {
    for (const id of Array.from(this.mounts.keys())) {
      this.teardownMount(id, 'destroy', false);
    }
    this.processing = false;
    this.stripe = null;
    this.availabilityListener = null;
    this.clearAvailability();
  }
}

@Injectable({ providedIn: 'root' })
export class ApplePayMockAdapter extends BaseMockAdapter {
  readonly provider = 'applePay' as const;
  readonly method = 'apple-pay' as const;
}
