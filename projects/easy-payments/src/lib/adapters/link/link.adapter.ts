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
import { buildStripeRequestMetadata } from '../../metadata/merchant-metadata';
import { PaymentError } from '../../errors/payment-error';
import { BackendService } from '../../services/backend.service';
import { BrowserGuard } from '../../utils/browser-guard';
import { BaseMockAdapter, BaseProviderAdapter } from '../base.adapter';
import { StripeConfirmationGate } from '../stripe/stripe-confirmation-gate';
import { StripeSdkLoader } from '../stripe/stripe-sdk.loader';
import { mapLinkError } from './link-error.mapper';
import {
  LinkAvailabilityState,
  buildLinkRenderKey,
} from './link.types';
import { toStripeAmountCents } from '../apple-pay/apple-pay.types';

/**
 * Stripe Express Checkout Element availability helpers for Link.
 * Prefer boolean `ready.availablePaymentMethods.link`.
 * Also support change-event shape `{ link: { available: boolean } }`.
 *
 * Change-event shape: `{ link: { available: boolean }, ... } | undefined`
 * Ready-event shape: `{ link: boolean, ... } | undefined`
 */
export function isLinkAvailableFromPaymentMethods(paymentMethods: unknown): boolean {
  if (!paymentMethods || typeof paymentMethods !== 'object') {
    return false;
  }
  const link = (paymentMethods as Record<string, unknown>)['link'];
  if (link === true) {
    return true;
  }
  if (link && typeof link === 'object') {
    return (link as { available?: boolean }).available === true;
  }
  return false;
}

/** Per-host Stripe Express Checkout Element mount owned by one payment component. */
interface LinkEceMount {
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
export class LinkAdapter extends BaseProviderAdapter {
  readonly provider = 'link' as const;

  private readonly configService = inject(EasyPaymentsConfigService);
  private readonly backend = inject(BackendService);
  private readonly browser = inject(BrowserGuard);
  private readonly stripeSdk = inject(StripeSdkLoader);

  private readonly gate = inject(StripeConfirmationGate);

  private stripe: Stripe | null = null;
  private configReady = false;
  private readonly configReadySignal = signal(false);
  /** Mounts with a wallet confirm in flight. Page-level exclusivity comes from the gate. */
  private readonly processingMounts = new Set<string>();

  /**
   * Ownership-scoped ECE mounts.
   * Omit `mountId` on mount/unmount to use {@link LEGACY_SINGLETON_MOUNT_ID}
   * (Ready-to-Use Checkout single-host remount path).
   */
  private readonly mounts = new Map<string, LinkEceMount>();
  private nextMountSeq = 0;
  static readonly LEGACY_SINGLETON_MOUNT_ID = 'link-ece-legacy';

  /** Most recent state change (any session) — legacy no-arg `getAvailabilityStatus()`. */
  private availabilityState: LinkAvailabilityState = 'idle';
  private availabilitySessionKey: string | null = null;
  /** ECE-decided availability per checkout session (product render key). */
  private readonly availabilityBySession = new Map<string, LinkAvailabilityState>();
  private readyFired = false;
  private lastAvailablePaymentMethods: unknown = null;
  private availabilityListener: ((state: LinkAvailabilityState) => void) | null = null;
  private readonly availabilityListeners = new Set<(state: LinkAvailabilityState) => void>();

  private abortedMounts = 0;

  isConfigured(): boolean {
    return this.configReadySignal();
  }

  /** Reactive config readiness for Link bootstrap mounting. */
  readonly configured = this.configReadySignal.asReadonly();

  /**
   * Availability for `product`'s checkout session, or the most recent state
   * change when omitted (legacy single-host behaviour).
   */
  getAvailabilityStatus(product?: PaymentProduct): LinkAvailabilityState {
    if (!product) {
      return this.availabilityState;
    }
    const scoped = this.availabilityBySession.get(buildLinkRenderKey(product));
    if (scoped) {
      return scoped;
    }
    return this.availabilitySessionKey === null ? this.availabilityState : 'idle';
  }

  /**
   * Optional UI hook — fired when production availability state changes
   * (e.g. after ECE `ready`). Use to call orchestrator.refreshAvailability.
   * Single legacy slot; prefer {@link addAvailabilityListener} for multi-host pages.
   */
  setAvailabilityListener(listener: ((state: LinkAvailabilityState) => void) | null): void {
    this.availabilityListener = listener;
  }

  /** Per-host availability listener. Returns a function that removes only this listener. */
  addAvailabilityListener(listener: (state: LinkAvailabilityState) => void): () => void {
    this.availabilityListeners.add(listener);
    return () => {
      this.availabilityListeners.delete(listener);
    };
  }

  /**
   * Validates Link + Stripe gateway prerequisites.
   * Does not load Stripe.js until availability or mount.
   */
  async initialize(): Promise<void> {
    const snapshot = this.configService.getSnapshot();
    const linkConfig = snapshot.providers?.link;
    const stripeKey = snapshot.providers?.stripe?.publishableKey?.trim() ?? '';

    if (!linkConfig) {
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

    if (!backendEndpointUrl(snapshot.backend, snapshot.backend?.linkCreatePaymentUrl)) {
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
   * Selector / catalog availability from configuration (Cash App Pay pattern).
   *
   * Real Link still mounts Stripe’s Express Checkout Element in the payment panel;
   * ECE `ready` / `availablePaymentMethods.link` gates the official button chrome,
   * not whether the Link tile appears in Full Checkout or Buttons Only.
   *
   * Rules:
   * - Requires `providers.link`, a publishable Stripe key, and `linkCreatePaymentUrl`.
   * - Requires a positive catalog amount and currency (same cents helper as ECE mount).
   * - Never uses UA sniffing or hidden probes for the selector.
   */
  async isAvailable(context: PaymentContext): Promise<boolean> {
    const snapshot = this.configService.getSnapshot();
    const key = snapshot.providers?.stripe?.publishableKey?.trim() ?? '';
    if (!snapshot.providers?.link || !this.configReady || !this.browser.isBrowser) {
      return false;
    }
    if (!key || /^sk_/i.test(key) || !/^pk_(test|live)_/i.test(key)) {
      return false;
    }
    if (!backendEndpointUrl(snapshot.backend, snapshot.backend?.linkCreatePaymentUrl)) {
      return false;
    }

    const amount = toStripeAmountCents(context.product);
    const currency = context.product.currency.trim().toLowerCase();
    if (!Number.isFinite(amount) || amount < 1 || !currency) {
      return false;
    }

    return true;
  }

  async createPayment(_request: PaymentRequest): Promise<PaymentResult> {
    throw new PaymentError({
      code: 'PROVIDER_UNAVAILABLE',
      message:
        'Link requires the official Link button UI. Use the link method inside <easy-payments>.',
      method: 'link',
      provider: 'link',
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
        message: 'Stripe publishableKey is required for Link.',
        method: 'link',
        provider: 'link',
      });
    }

    const stripe = await this.stripeSdk.load(key);
    if (!stripe) {
      throw new PaymentError({
        code: 'SDK_LOAD_FAILED',
        message: 'Stripe.js failed to load for Link.',
        method: 'link',
        provider: 'link',
      });
    }

    this.stripe = stripe;
    return stripe;
  }

  /** Allocates a unique ECE mount id for Payment Buttons / multi-host ownership. */
  createMountId(): string {
    this.nextMountSeq += 1;
    return `link-ece-${this.nextMountSeq}`;
  }

  /** Active ownership-scoped ECE mounts (test / diagnostics). */
  getActiveEceMountCount(): number {
    return this.mounts.size;
  }

  /**
   * Mounts Stripe Express Checkout Element with Link only.
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
      /**
       * Shared Buttons Only grid radius (px). Applied via Elements Appearance
       * `variables.borderRadius` — Link ECE has no separate buttonRadius API.
       */
      buttonBorderRadiusPx?: number;
      onSuccess: (result: PaymentResult) => void;
      onCancel: () => void;
      onError: (error: PaymentError) => void;
      /** Wallet confirm began. Not fired for ready, unavailable, or a duplicate confirm. */
      onAttempt?: () => void;
      onReady?: () => void;
      onUnavailable?: () => void;
      onAvailabilityChange?: (state: LinkAvailabilityState) => void;
    },
    mountId: string = LinkAdapter.LEGACY_SINGLETON_MOUNT_ID,
  ): Promise<string> {
    this.teardownMount(mountId, 'remount');

    const sessionKey = buildLinkRenderKey(options.product);
    const keepAvailable = this.availabilityBySession.get(sessionKey) === 'available';
    if (!keepAvailable) {
      this.setAvailabilityState('checking', sessionKey);
      this.readyFired = false;
      this.lastAvailablePaymentMethods = null;
    }

    const mount: LinkEceMount = {
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
        message: 'Invalid amount for Link.',
        method: 'link',
        provider: 'link',
      });
    }

    const currency = options.product.currency.trim().toLowerCase();

    // Stripe requires card alongside link for Link PaymentIntents. The Link ECE slot never
    // exposes Apple Pay / Google Pay / etc. (those have their own methods).
    const elements = stripe.elements({
      mode: 'payment',
      amount,
      currency,
      paymentMethodTypes: ['link', 'card'],
      ...(options.locale ? { locale: options.locale as StripeElementLocale } : {}),
      ...(typeof options.buttonBorderRadiusPx === 'number'
        ? {
            appearance: {
              variables: {
                borderRadius: `${options.buttonBorderRadiusPx}px`,
              },
            },
          }
        : {}),
    });

    // Stripe.js typings drop the expressCheckout create overload when Elements are
    // created with paymentMethodTypes including `link`. Runtime create is supported.
    // Link ECE accepts only `auto` | `never` for paymentMethods.link (not `always`).
    type ExpressCheckoutFactory = {
      create(
        elementType: 'expressCheckout',
        options: {
          paymentMethods: {
            link: 'auto';
            applePay: 'never';
            googlePay: 'never';
            paypal: 'never';
            amazonPay: 'never';
            klarna: 'never';
          };
          buttonHeight: number;
          emailRequired: boolean;
        },
      ): StripeExpressCheckoutElement;
    };
    let expressCheckout: StripeExpressCheckoutElement;
    try {
      expressCheckout = (elements as unknown as ExpressCheckoutFactory).create(
        'expressCheckout',
        {
          paymentMethods: {
            link: 'auto',
            applePay: 'never',
            googlePay: 'never',
            paypal: 'never',
            amazonPay: 'never',
            klarna: 'never',
          },
          buttonHeight: 44,
          emailRequired: true,
        },
      );
    } catch (error) {
      this.teardownMount(mountId, 'destroy');
      this.setAvailabilityState('error', sessionKey);
      throw mapLinkError(error, 'SDK_LOAD_FAILED', 'Failed to load Link.');
    }

    mount.elements = elements;
    mount.expressCheckout = expressCheckout;

    // Listeners MUST be attached before mount (Stripe ECE docs pattern).
    expressCheckout.on('ready', (event) => {
      if (!this.mounts.has(mountId)) {
        return;
      }
      const availableMethods =
        (event as { availablePaymentMethods?: unknown }).availablePaymentMethods ?? null;
      this.readyFired = true;
      this.lastAvailablePaymentMethods = availableMethods;
      const available = isLinkAvailableFromPaymentMethods(availableMethods);
      const next: LinkAvailabilityState = available ? 'available' : 'unavailable';
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
      this.processingMounts.delete(mountId);
      mount.cancelHandler?.();
    });

    expressCheckout.on('loaderror', (event) => {
      if (!this.mounts.has(mountId)) {
        return;
      }
      this.processingMounts.delete(mountId);
      this.setAvailabilityState('error', sessionKey);
      options.onAvailabilityChange?.('error');
      const mapped = mapLinkError(
        (event as { error?: unknown })?.error,
        'SDK_LOAD_FAILED',
        'Failed to load Link.',
      );
      mount.errorHandler?.(mapped);
    });

    expressCheckout.on('confirm', async (event) => {
      if (!this.mounts.has(mountId) || this.processingMounts.has(mountId)) {
        return;
      }
      let release: () => void;
      try {
        release = this.gate.acquire(`link:${mountId}`, 'link', 'link');
      } catch (gateError) {
        // Another host is confirming a Stripe payment: close this sheet and tell this host.
        (event as { paymentFailed?: (options?: { reason?: 'fail' }) => void } | undefined)
          ?.paymentFailed?.({ reason: 'fail' });
        mount.errorHandler?.(gateError as PaymentError);
        return;
      }
      this.processingMounts.add(mountId);
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
        const paymentError = mapLinkError(error);
        if (paymentError.code === 'PAYMENT_CANCELLED') {
          mount.cancelHandler?.();
        } else {
          mount.errorHandler?.(paymentError);
        }
      } finally {
        this.processingMounts.delete(mountId);
        release();
      }
    });

    try {
      expressCheckout.mount(host);
    } catch (error) {
      this.teardownMount(mountId, 'destroy');
      this.setAvailabilityState('error', sessionKey);
      throw mapLinkError(error, 'SDK_LOAD_FAILED', 'Failed to load Link.');
    }
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
    const id = options?.mountId ?? LinkAdapter.LEGACY_SINGLETON_MOUNT_ID;
    this.teardownMount(id, 'destroy', options?.preserveAvailability === true);
  }

  /**
   * Clears ECE-driven availability (e.g. merchant removed `link` from methods,
   * or a brand-new checkout session must not inherit a previous ready result).
   */
  clearAvailability(product?: PaymentProduct): void {
    if (product) {
      const sessionKey = buildLinkRenderKey(product);
      this.availabilityBySession.delete(sessionKey);
      if (this.availabilitySessionKey === sessionKey) {
        this.availabilityState = 'idle';
        this.availabilitySessionKey = null;
      }
      return;
    }
    this.readyFired = false;
    this.lastAvailablePaymentMethods = null;
    this.availabilityBySession.clear();
    this.setAvailabilityState('idle', null);
  }

  /** True while `mountId` (or, when omitted, any mount) has a wallet confirm in flight. */
  isProcessing(mountId?: string): boolean {
    return mountId === undefined
      ? this.processingMounts.size > 0
      : this.processingMounts.has(mountId);
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
      this.clearAvailability();
    }
  }

  private setAvailabilityState(
    state: LinkAvailabilityState,
    sessionKey: string | null,
  ): void {
    // Per-session change detection: a sibling host re-checking its own product
    // must not wake every listener (would ping-pong refreshes between hosts).
    const changed =
      sessionKey === null
        ? this.availabilityState !== state || this.availabilitySessionKey !== null
        : this.availabilityBySession.get(sessionKey) !== state;
    if (sessionKey !== null) {
      this.availabilityBySession.set(sessionKey, state);
    }
    this.availabilityState = state;
    this.availabilitySessionKey = sessionKey;
    if (changed) {
      this.availabilityListener?.(state);
      for (const listener of Array.from(this.availabilityListeners)) {
        listener(state);
      }
    }
  }

  private async confirmExpressCheckout(
    mount: LinkEceMount,
    product: PaymentProduct,
    checkout?: CheckoutOptions,
  ): Promise<PaymentResult> {
    const stripe = await this.ensureStripeLoaded();
    const elements = mount.elements;
    if (!elements || !this.mounts.has(mount.id)) {
      throw new PaymentError({
        code: 'PROVIDER_UNAVAILABLE',
        message: 'Link is not ready.',
        method: 'link',
        provider: 'link',
      });
    }

    const { error: submitError } = await elements.submit();
    if (submitError) {
      throw mapLinkError(submitError);
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
      throw mapLinkError(error);
    }

    const status = paymentIntent?.status;
    if (status === 'processing') {
      return normalizePaymentResult({
        status: 'processing',
        method: 'link',
        provider: 'link',
        transactionId: paymentIntent?.id ?? session.paymentIntentId,
        sessionId: paymentIntent?.id ?? session.paymentIntentId,
        message:
          'Link payment is still processing. Do not retry — confirm the final status on your backend.',
        metadata: { processor: 'stripe', stripeStatus: status },
      });
    }
    if (status === 'succeeded') {
      return normalizePaymentResult({
        status: 'success',
        method: 'link',
        provider: 'link',
        transactionId: paymentIntent?.id ?? session.paymentIntentId,
        sessionId: paymentIntent?.id ?? session.paymentIntentId,
        message: 'Link payment completed.',
        metadata: {
          processor: 'stripe',
          stripeStatus: status,
        },
      });
    }

    if (status === 'requires_capture') {
      // Public status stays "success" for compatibility; metadata marks authorization-only.
      return normalizePaymentResult({
        status: 'success',
        method: 'link',
        provider: 'link',
        transactionId: paymentIntent?.id ?? session.paymentIntentId,
        sessionId: paymentIntent?.id ?? session.paymentIntentId,
        message:
          'Link payment is authorized and requires capture. Confirm capture and fulfillment on your backend — this is not proof of captured funds.',
        metadata: {
          processor: 'stripe',
          stripeStatus: status,
          authorizationOnly: true,
        },
      });
    }

    if (status === 'canceled') {
      return normalizePaymentResult({
        status: 'cancelled',
        method: 'link',
        provider: 'link',
        message: 'Link payment was cancelled.',
        sessionId: paymentIntent?.id ?? session.paymentIntentId,
      });
    }

    throw new PaymentError({
      code: 'PAYMENT_FAILED',
      message: `Link payment ended with status: ${status ?? 'unknown'}.`,
      method: 'link',
      provider: 'link',
    });
  }

  private async createPaymentSession(
    product: PaymentProduct,
    checkout?: CheckoutOptions,
  ): Promise<{ clientSecret: string; paymentIntentId?: string }> {
    // Catalog amount is authoritative on the server: only product identity + metadata are sent.
    const metadata = buildStripeRequestMetadata(
      product.metadata,
      {
        productName: product.name,
        checkoutMethod: 'link',
        customerEmail: checkout?.customer?.email,
      },
      'link',
      'link',
    );

    try {
      const response = await this.backend.createLinkPayment({
        productId: product.id,
        quantity: product.quantity ?? 1,
        currency: product.currency,
        ...(metadata ? { metadata } : {}),
      });
      if (
        response.provider !== 'link' ||
        typeof response.clientSecret !== 'string' ||
        !response.clientSecret.trim()
      ) {
        throw new PaymentError({
          code: 'BACKEND_ERROR',
          message: 'Invalid Link create-payment response.',
          method: 'link',
          provider: 'link',
        });
      }
      return {
        clientSecret: response.clientSecret,
        paymentIntentId: response.paymentIntentId,
      };
    } catch (error) {
      throw mapLinkError(error, 'BACKEND_ERROR', 'Failed to create payment session for Link.');
    }
  }
  async destroy(): Promise<void> {
    for (const id of Array.from(this.mounts.keys())) {
      this.teardownMount(id, 'destroy', false);
    }
    this.processingMounts.clear();
    this.stripe = null;
    // Per-host listeners (addAvailabilityListener) are owned by their hosts and survive re-init.
    this.availabilityListener = null;
    this.clearAvailability();
  }
}

@Injectable({ providedIn: 'root' })
export class LinkMockAdapter extends BaseMockAdapter {
  readonly provider = 'link' as const;
  readonly method = 'link' as const;
}
