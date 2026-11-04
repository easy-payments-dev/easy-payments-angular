import { signal, type Signal } from '@angular/core';
import { Subject } from 'rxjs';
import type { CheckoutOptions } from '../models/checkout-options.model';
import type { PaymentMethod, PaymentProviderName } from '../models/payment-method.model';
import { PAYMENT_METHOD_PROVIDER_MAP } from '../models/payment-method.model';
import type {
  PaymentMethodChangeEvent,
  PaymentResult,
  PaymentStartedEvent,
} from '../models/payment-result.model';
import type { PaymentProduct } from '../models/payment-product.model';
import type { PaymentTheme } from '../models/payment-theme.model';
import { PaymentError, normalizeError } from '../errors/payment-error';
import { validatePaymentProduct } from '../validators/product.validator';
import { CheckoutAvailabilitySession } from '../services/checkout-availability-session';
import type { PaymentOrchestratorService } from '../services/payment-orchestrator.service';
import type { BrowserGuard } from '../utils/browser-guard';
import type { EasyPaymentsConfigService } from '../config/easy-payments-config.service';
import type { StripeCardAdapter } from '../adapters/stripe/stripe-card.adapter';
import type { KlarnaAdapter } from '../adapters/klarna/klarna.adapter';
import type { AffirmAdapter } from '../adapters/affirm/affirm.adapter';
import type { PayPalAdapter } from '../adapters/paypal/paypal.adapter';
import { mapPayPalError } from '../adapters/paypal/paypal-error.mapper';
import type { GooglePayAdapter } from '../adapters/google-pay/google-pay.adapter';
import { mapGooglePayError } from '../adapters/google-pay/google-pay-error.mapper';
import type { ApplePayAdapter } from '../adapters/apple-pay/apple-pay.adapter';
import { mapApplePayError } from '../adapters/apple-pay/apple-pay-error.mapper';
import {
  isTransientStripeVerificationError,
  StripeRedirectRecoveryService,
  type StripeReturnHost,
} from '../adapters/stripe/stripe-redirect-recovery.service';
import {
  buildStripeReturnUrl,
  clearStripePendingReturnFor,
  createStripeReturnAttemptId,
  detectStripeReturnMethod,
  isStripeReturnAttempt,
  markHeadlessPendingReturn,
  type StripeRedirectMethod,
} from '../adapters/stripe/stripe-redirect-return';
import {
  resolveEffectiveLocale,
  toAffirmPreferredLocale,
  toGooglePayButtonLocale,
  toKlarnaPreferredLocale,
  toStripeElementsLocale,
  type EasyPaymentsLocale,
  type EasyPaymentsTranslationOverrides,
} from '../i18n';
import { toHeadlessMethodStatus } from './headless-method-meta';
import { resolveHeadlessTheme } from './resolve-headless-theme';
import type { HeadlessSessionRegistry } from './headless-session-registry';
import type {
  HeadlessCheckoutEvents,
  HeadlessCheckoutSession,
  HeadlessMethodStatus,
  HeadlessMountHandle,
  HeadlessSessionState,
} from './headless.types';

/** Methods that mount a Stripe Payment Element through existing adapters (H3.1–H3.2). */
type HeadlessStripeElementMethod = 'card' | 'klarna' | 'affirm';

/** All Headless-mountable methods through H3.5. */
type HeadlessMountableMethod =
  | HeadlessStripeElementMethod
  | 'paypal'
  | 'google-pay'
  | 'apple-pay';

function isStripeElementMethod(method: PaymentMethod): method is HeadlessStripeElementMethod {
  return method === 'card' || method === 'klarna' || method === 'affirm';
}

function isMountableMethod(method: PaymentMethod): method is HeadlessMountableMethod {
  return (
    isStripeElementMethod(method) ||
    method === 'paypal' ||
    method === 'google-pay' ||
    method === 'apple-pay'
  );
}

interface StripeElementAdapterApi {
  createPaymentSession(
    product: PaymentProduct,
    checkout?: CheckoutOptions,
    localeOrOwner?: string,
    ownerId?: string,
  ): Promise<{ clientSecret: string }>;
  mountPaymentElement(
    container: HTMLElement,
    clientSecret: string,
    theme: ReturnType<typeof resolveHeadlessTheme>,
    locale?: string,
    ownerId?: string,
  ): Promise<void>;
  confirmPayment(returnUrl?: string, ownerId?: string): Promise<PaymentResult>;
  unmountPaymentElement(ownerId?: string): void;
  hasMountedElement(ownerId?: string): boolean;
  destroy(ownerId?: string): Promise<void>;
}

export interface HeadlessCheckoutSessionDeps {
  id: string;
  /**
   * Merchant-supplied stable id for BNPL redirect ownership (H4.2).
   * Null when the session id was auto-generated — Klarna/Affirm confirm must fail closed.
   */
  stableCheckoutIdentity: string | null;
  product: PaymentProduct;
  methods: readonly PaymentMethod[];
  checkout?: CheckoutOptions;
  locale?: EasyPaymentsLocale;
  translations?: EasyPaymentsTranslationOverrides;
  theme?: PaymentTheme;
  orchestrator: PaymentOrchestratorService;
  registry: HeadlessSessionRegistry;
  browser: BrowserGuard;
  config: EasyPaymentsConfigService;
  stripeCard: StripeCardAdapter;
  klarna: KlarnaAdapter;
  affirm: AffirmAdapter;
  paypal: PayPalAdapter;
  googlePay: GooglePayAdapter;
  applePay: ApplePayAdapter;
  stripeRedirectRecovery: StripeRedirectRecoveryService;
}

/**
 * Independently owned Headless session.
 * H3.1: Stripe Card. H3.2: Klarna + Affirm. H3.3: PayPal Buttons.
 * H3.4: Google Pay button. H3.5: Apple Pay Express Checkout Element.
 * H4.3: Klarna/Affirm redirect recovery via {@link StripeRedirectRecoveryService}.
 */
export class HeadlessCheckoutSessionImpl implements HeadlessCheckoutSession, StripeReturnHost {
  readonly id: string;
  /** Stripe redirect ownership host kind — Headless only (never checkout/buttons). */
  readonly kind = 'headless' as const;

  private readonly product: PaymentProduct;
  private readonly methods: readonly PaymentMethod[];
  private readonly checkout?: CheckoutOptions;
  private readonly locale: EasyPaymentsLocale;
  /** Retained for future localized Headless chrome / H3.x providers. */
  private readonly translations?: EasyPaymentsTranslationOverrides;
  private readonly theme?: PaymentTheme;

  private readonly orchestrator: PaymentOrchestratorService;
  private readonly sessionRegistry: HeadlessSessionRegistry;
  private readonly browser: BrowserGuard;
  private readonly config: EasyPaymentsConfigService;
  private readonly stripeCard: StripeCardAdapter;
  private readonly klarna: KlarnaAdapter;
  private readonly affirm: AffirmAdapter;
  private readonly paypal: PayPalAdapter;
  private readonly googlePay: GooglePayAdapter;
  private readonly applePay: ApplePayAdapter;
  private readonly stripeRedirectRecovery: StripeRedirectRecoveryService;
  private readonly availability = new CheckoutAvailabilitySession();

  /** Stripe Element / PayPal / Google Pay owner — equals Headless session id for isolation. */
  private readonly stripeOwnerId: string;
  /**
   * Merchant-stable id for Klarna/Affirm pending markers; null when auto-generated.
   * Distinct from runtime session id — never invent a recovery identity after redirect.
   */
  private readonly stableCheckoutIdentity: string | null;
  /** Same as session id — scopes PayPal createOrder concurrency to this session. */
  private readonly paypalOrderOwnerId: string;
  /** Same as session id — scopes Google Pay payWithGooglePay concurrency to this session. */
  private readonly googlePayOwnerId: string;

  private readonly _state = signal<HeadlessSessionState>('idle');
  private readonly _selectedMethod = signal<PaymentMethod | null>(null);
  private readonly _availableMethods = signal<readonly HeadlessMethodStatus[]>([]);
  private readonly _lastError = signal<PaymentError | null>(null);
  private readonly _lastResult = signal<PaymentResult | null>(null);

  readonly state: Signal<HeadlessSessionState> = this._state.asReadonly();
  readonly selectedMethod: Signal<PaymentMethod | null> = this._selectedMethod.asReadonly();
  readonly availableMethods: Signal<readonly HeadlessMethodStatus[]> =
    this._availableMethods.asReadonly();
  readonly lastError: Signal<PaymentError | null> = this._lastError.asReadonly();
  readonly lastResult: Signal<PaymentResult | null> = this._lastResult.asReadonly();

  private readonly started$ = new Subject<PaymentStartedEvent>();
  private readonly methodChange$ = new Subject<PaymentMethodChangeEvent>();
  private readonly pending$ = new Subject<PaymentResult>();
  private readonly success$ = new Subject<PaymentResult>();
  private readonly cancel$ = new Subject<PaymentResult>();
  private readonly error$ = new Subject<PaymentError>();

  readonly events: HeadlessCheckoutEvents = {
    started: this.started$.asObservable(),
    methodChange: this.methodChange$.asObservable(),
    pending: this.pending$.asObservable(),
    success: this.success$.asObservable(),
    cancel: this.cancel$.asObservable(),
    error: this.error$.asObservable(),
  };

  private initPromise: Promise<void> | null = null;
  private refreshGeneration = 0;
  private released = false;

  private mountGeneration = 0;
  private mountedMethod: HeadlessMountableMethod | null = null;
  private confirmGeneration = 0;
  private terminalEmittedForConfirm = 0;

  /** Ownership-scoped PayPal Buttons mount id from {@link PayPalAdapter.renderButtons}. */
  private paypalButtonsMountId: string | null = null;
  /** This session's most recent PayPal order id (never a sibling's). */
  private paypalCurrentOrderId: string | null = null;
  private paypalCaptureEmitted = false;
  private paypalAttemptAnnounced = false;

  /** Ownership-scoped Google Pay button mount id from {@link GooglePayAdapter.renderOfficialButton}. */
  private googlePayButtonMountId: string | null = null;
  private googlePayAttemptAnnounced = false;
  /** Guards duplicate in-flight click handling for this mount generation. */
  private googlePayClickInFlight = false;

  /** Ownership-scoped Apple Pay ECE mount id from {@link ApplePayAdapter.mountExpressCheckout}. */
  private applePayEceMountId: string | null = null;
  private applePayAttemptAnnounced = false;

  /** In-flight recoverReturn() promise (idempotent concurrent callers). */
  private recoverPromise: Promise<PaymentResult | null> | null = null;
  /** True after this session owned and applied (or failed) a consume for the current page load. */
  private recoverSettled = false;
  /** True while registered with {@link StripeRedirectRecoveryService}. */
  private returnHostRegistered = false;

  constructor(deps: HeadlessCheckoutSessionDeps) {
    this.id = deps.id;
    this.stripeOwnerId = deps.id;
    this.stableCheckoutIdentity = deps.stableCheckoutIdentity;
    this.paypalOrderOwnerId = deps.id;
    this.googlePayOwnerId = deps.id;
    this.product = deps.product;
    this.methods = deps.methods;
    this.checkout = deps.checkout;
    this.locale = deps.locale ?? 'auto';
    this.translations = deps.translations;
    this.theme = deps.theme;
    this.orchestrator = deps.orchestrator;
    this.sessionRegistry = deps.registry;
    this.browser = deps.browser;
    this.config = deps.config;
    this.stripeCard = deps.stripeCard;
    this.klarna = deps.klarna;
    this.affirm = deps.affirm;
    this.paypal = deps.paypal;
    this.googlePay = deps.googlePay;
    this.applePay = deps.applePay;
    this.stripeRedirectRecovery = deps.stripeRedirectRecovery;
    void this.translations;

    this.stripeRedirectRecovery.registerHost(this);
    this.returnHostRegistered = true;
  }

  /** {@link StripeReturnHost} — product correlated with the pending Headless marker. */
  productId(): string | null {
    return this.product.id;
  }

  /**
   * {@link StripeReturnHost} — merchant-stable id when present; otherwise the runtime session id
   * (which cannot match a Headless BNPL marker by design).
   */
  instanceId(): string {
    return this.stableCheckoutIdentity ?? this.id;
  }

  async initialize(): Promise<void> {
    this.assertNotDestroyed('initialize');

    if (this._state() === 'ready') {
      return;
    }

    if (this.initPromise) {
      return this.initPromise;
    }

    this._state.set('initializing');
    this._lastError.set(null);

    const generation = this.refreshGeneration;

    this.initPromise = (async () => {
      try {
        this.assertProduct();
        await this.orchestrator.initialize();
        this.throwIfDestroyedOrStale(generation, 'initialize');
        await this.publishAvailability(generation);
        this.throwIfDestroyedOrStale(generation, 'initialize');
        this._state.set('ready');
      } catch (error) {
        if (this._state() === 'destroyed' || generation !== this.refreshGeneration) {
          if (this._state() === 'destroyed') {
            throw new PaymentError({
              code: 'PROVIDER_UNAVAILABLE',
              message: 'Headless checkout session was destroyed during initialize().',
            });
          }
          throw normalizeError(error);
        }
        const paymentError = normalizeError(error);
        this._lastError.set(paymentError);
        this._state.set('error');
        this.emitError(paymentError);
        throw paymentError;
      } finally {
        this.initPromise = null;
      }
    })();

    return this.initPromise;
  }

  async refreshAvailability(): Promise<readonly HeadlessMethodStatus[]> {
    this.assertNotDestroyed('refreshAvailability');

    if (this.initPromise) {
      await this.initPromise;
      this.assertNotDestroyed('refreshAvailability');
    }

    if (this._state() === 'idle') {
      throw new PaymentError({
        code: 'PROVIDER_UNAVAILABLE',
        message: 'Call initialize() before refreshAvailability().',
      });
    }
    if (this._state() === 'error' && !this.mountedMethod) {
      throw new PaymentError({
        code: 'PROVIDER_UNAVAILABLE',
        message: 'Session is in error state. Call initialize() to retry.',
      });
    }

    const generation = ++this.refreshGeneration;
    return this.publishAvailability(generation);
  }

  selectMethod(method: PaymentMethod | null): void {
    this.assertNotDestroyed('selectMethod');
    this.assertNotPaymentLocked('selectMethod');

    if (method !== null && !this.methods.includes(method)) {
      throw new PaymentError({
        code: 'CONFIG_INVALID',
        message: `Payment method "${method}" is not configured for this Headless session.`,
        method,
        provider: PAYMENT_METHOD_PROVIDER_MAP[method],
      });
    }

    this.applySelection(method);
  }

  async mount(method: PaymentMethod, container: HTMLElement): Promise<HeadlessMountHandle> {
    this.assertNotDestroyed('mount');

    if (this.initPromise) {
      await this.initPromise;
      this.assertNotDestroyed('mount');
    }

    if (this._state() === 'idle' || this._state() === 'initializing') {
      throw new PaymentError({
        code: 'PROVIDER_UNAVAILABLE',
        message: 'Call initialize() before mount().',
      });
    }

    this.assertNotPaymentLocked('mount', method);

    if (!isMountableMethod(method)) {
      throw new PaymentError({
        code: 'PROVIDER_NOT_IMPLEMENTED',
        message:
          'Headless mount currently supports "card", "klarna", "affirm", "paypal", "google-pay", and "apple-pay".',
        method,
        provider: PAYMENT_METHOD_PROVIDER_MAP[method],
      });
    }

    if (!this.methods.includes(method)) {
      throw new PaymentError({
        code: 'CONFIG_INVALID',
        message: `Payment method "${method}" is not configured for this Headless session.`,
        method,
        provider: this.providerOf(method),
      });
    }

    if (!container || typeof container !== 'object' || container.nodeType !== 1) {
      throw new PaymentError({
        code: 'CONFIG_INVALID',
        message: 'mount() requires a valid HTMLElement container.',
        method,
        provider: this.providerOf(method),
      });
    }

    const methodStatus = this._availableMethods().find((entry) => entry.method === method);
    if (method === 'apple-pay') {
      this.assertApplePayMountable(methodStatus);
    } else if (!methodStatus?.available) {
      throw new PaymentError({
        code: 'PROVIDER_UNAVAILABLE',
        message: `${methodLabel(method)} is not available for this Headless session configuration.`,
        method,
        provider: this.providerOf(method),
      });
    }

    this.applySelection(method);

    const mountGen = ++this.mountGeneration;
    this.mountedMethod = null;
    this.paypalCaptureEmitted = false;
    this.paypalAttemptAnnounced = false;
    this.paypalCurrentOrderId = null;
    this.googlePayAttemptAnnounced = false;
    this.googlePayClickInFlight = false;
    this.applePayAttemptAnnounced = false;
    await this.teardownActiveMounts();

    if (method === 'paypal') {
      return this.mountPayPal(container, mountGen);
    }
    if (method === 'google-pay') {
      return this.mountGooglePay(container, mountGen);
    }
    if (method === 'apple-pay') {
      return this.mountApplePay(container, mountGen);
    }

    return this.mountStripeElement(method, container, mountGen);
  }

  private async mountStripeElement(
    method: HeadlessStripeElementMethod,
    container: HTMLElement,
    mountGen: number,
  ): Promise<HeadlessMountHandle> {
    const adapter = this.adapterFor(method);

    try {
      const prefersDark =
        this.browser.matchMedia('(prefers-color-scheme: dark)')?.matches ?? false;
      const resolvedTheme = resolveHeadlessTheme(this.theme, prefersDark);
      const effectiveLocale = resolveEffectiveLocale(this.locale);
      const elementsLocale = toStripeElementsLocale(effectiveLocale);

      const paymentSession = await this.createStripeElementSession(method, effectiveLocale);

      this.throwIfDestroyedOrMountStale(mountGen, 'mount', method);

      await adapter.mountPaymentElement(
        container,
        paymentSession.clientSecret,
        resolvedTheme,
        elementsLocale,
        this.stripeOwnerId,
      );

      this.throwIfDestroyedOrMountStale(mountGen, 'mount', method);

      if (!adapter.hasMountedElement(this.stripeOwnerId)) {
        throw new PaymentError({
          code: 'SDK_LOAD_FAILED',
          message: `${methodLabel(method)} Payment Element failed to mount.`,
          method,
          provider: this.providerOf(method),
        });
      }

      this.mountedMethod = method;
      this._lastError.set(null);
      if (this._state() === 'error' || this._state() === 'cancelled' || this._state() === 'success') {
        this._state.set('ready');
      }

      return this.createStripeMountHandle(method, mountGen);
    } catch (error) {
      if (this._state() !== 'destroyed' && mountGen === this.mountGeneration) {
        this.mountedMethod = null;
        adapter.unmountPaymentElement(this.stripeOwnerId);
      }
      if (this._state() === 'destroyed') {
        throw new PaymentError({
          code: 'PROVIDER_UNAVAILABLE',
          message: 'Headless checkout session was destroyed during mount().',
          method,
          provider: this.providerOf(method),
        });
      }
      const paymentError = normalizeError(error, {
        method,
        provider: this.providerOf(method),
      });
      this._lastError.set(paymentError);
      this.emitError(paymentError);
      throw paymentError;
    }
  }

  private async mountPayPal(
    container: HTMLElement,
    mountGen: number,
  ): Promise<HeadlessMountHandle> {
    try {
      const effectiveLocale = resolveEffectiveLocale(this.locale);
      await this.paypal.ensureSdkLoaded(effectiveLocale);
      this.throwIfDestroyedOrMountStale(mountGen, 'mount', 'paypal');

      const mountId = await this.paypal.renderButtons(
        container,
        {
          createOrder: () => this.onPayPalCreateOrder(mountGen),
          onApprove: (data) => this.onPayPalApprove(data.orderID, mountGen),
          onCancel: () => this.onPayPalCancel(mountGen),
          onError: (err) => this.onPayPalSdkError(err, mountGen),
          onClick: async (_data, actions) => {
            if (
              this._state() === 'destroyed' ||
              mountGen !== this.mountGeneration ||
              this.paypal.isBusy(this.paypalOrderOwnerId, this.paypalCurrentOrderId) ||
              this._state() === 'success' ||
              this._state() === 'pending'
            ) {
              await actions.reject();
              return;
            }
            await actions.resolve();
          },
        },
        effectiveLocale,
        this.paypalButtonsMountId ?? undefined,
      );

      if (this._state() === 'destroyed' || mountGen !== this.mountGeneration) {
        await this.paypal.destroyButtons(mountId);
        throw new PaymentError({
          code: 'PROVIDER_UNAVAILABLE',
          message: 'Headless checkout session was destroyed during mount().',
          method: 'paypal',
          provider: 'paypal',
        });
      }

      this.paypalButtonsMountId = mountId;
      this.mountedMethod = 'paypal';
      this._lastError.set(null);
      if (this._state() === 'error' || this._state() === 'cancelled' || this._state() === 'success') {
        this._state.set('ready');
      }

      return this.createPayPalMountHandle(mountGen, mountId);
    } catch (error) {
      if (this._state() !== 'destroyed' && mountGen === this.mountGeneration) {
        this.mountedMethod = null;
        const id = this.paypalButtonsMountId;
        this.paypalButtonsMountId = null;
        if (id) {
          await this.paypal.destroyButtons(id);
        }
      }
      if (this._state() === 'destroyed') {
        throw new PaymentError({
          code: 'PROVIDER_UNAVAILABLE',
          message: 'Headless checkout session was destroyed during mount().',
          method: 'paypal',
          provider: 'paypal',
        });
      }
      const paymentError =
        error instanceof PaymentError
          ? error
          : mapPayPalError(error, 'PROVIDER_UNAVAILABLE', 'PayPal Buttons failed to initialize.');
      this._lastError.set(paymentError);
      this.emitError(paymentError);
      throw paymentError;
    }
  }

  private async mountGooglePay(
    container: HTMLElement,
    mountGen: number,
  ): Promise<HeadlessMountHandle> {
    try {
      const prefersDark =
        this.browser.matchMedia('(prefers-color-scheme: dark)')?.matches ?? false;
      const resolvedTheme = resolveHeadlessTheme(this.theme, prefersDark);
      const effectiveLocale = resolveEffectiveLocale(this.locale);
      const buttonLocale = toGooglePayButtonLocale(effectiveLocale);

      this.throwIfDestroyedOrMountStale(mountGen, 'mount', 'google-pay');

      const mountId = await this.googlePay.renderOfficialButton(
        container,
        {
          theme: resolvedTheme,
          buttonLocale,
          onClick: () => this.onGooglePayClick(mountGen),
        },
        this.googlePayButtonMountId ?? undefined,
      );

      if (this._state() === 'destroyed' || mountGen !== this.mountGeneration) {
        this.googlePay.destroyButtonMount(mountId);
        throw new PaymentError({
          code: 'PROVIDER_UNAVAILABLE',
          message: 'Headless checkout session was destroyed during mount().',
          method: 'google-pay',
          provider: 'googlePay',
        });
      }

      this.googlePayButtonMountId = mountId;
      this.mountedMethod = 'google-pay';
      this._lastError.set(null);
      if (this._state() === 'error' || this._state() === 'cancelled' || this._state() === 'success') {
        this._state.set('ready');
      }

      return this.createGooglePayMountHandle(mountGen, mountId);
    } catch (error) {
      if (this._state() !== 'destroyed' && mountGen === this.mountGeneration) {
        this.mountedMethod = null;
        const id = this.googlePayButtonMountId;
        this.googlePayButtonMountId = null;
        if (id) {
          this.googlePay.destroyButtonMount(id);
        }
      }
      if (this._state() === 'destroyed') {
        throw new PaymentError({
          code: 'PROVIDER_UNAVAILABLE',
          message: 'Headless checkout session was destroyed during mount().',
          method: 'google-pay',
          provider: 'googlePay',
        });
      }
      const paymentError =
        error instanceof PaymentError
          ? error
          : mapGooglePayError(error, 'SDK_LOAD_FAILED', 'Failed to initialize Google Pay.');
      this._lastError.set(paymentError);
      this.emitError(paymentError);
      throw paymentError;
    }
  }

  /**
   * Apple Pay eligibility is decided by the Express Checkout Element `ready` event.
   * Allow mount while still `loading`/`checking` so Headless can discover availability
   * the same way Full Checkout bootstrap does — never mount a fake button after a
   * definitive unavailable/misconfigured result.
   */
  private assertApplePayMountable(methodStatus: HeadlessMethodStatus | undefined): void {
    if (!this.applePay.isConfigured()) {
      throw new PaymentError({
        code: 'PROVIDER_UNAVAILABLE',
        message: 'Apple Pay is not available for this Headless session configuration.',
        method: 'apple-pay',
        provider: 'applePay',
      });
    }

    const readiness = methodStatus?.readiness;
    if (readiness === 'unavailable' || readiness === 'misconfigured') {
      throw new PaymentError({
        code: 'PROVIDER_UNAVAILABLE',
        message: 'Apple Pay is not available for this Headless session configuration.',
        method: 'apple-pay',
        provider: 'applePay',
      });
    }
  }

  private async mountApplePay(
    container: HTMLElement,
    mountGen: number,
  ): Promise<HeadlessMountHandle> {
    const mountId = this.applePayEceMountId ?? this.applePay.createMountId();

    try {
      const prefersDark =
        this.browser.matchMedia('(prefers-color-scheme: dark)')?.matches ?? false;
      const resolvedTheme = resolveHeadlessTheme(this.theme, prefersDark);
      const effectiveLocale = resolveEffectiveLocale(this.locale);
      const elementsLocale = toStripeElementsLocale(effectiveLocale);

      this.throwIfDestroyedOrMountStale(mountGen, 'mount', 'apple-pay');

      await new Promise<void>((resolve, reject) => {
        let settled = false;
        const settleOk = (): void => {
          if (!settled) {
            settled = true;
            resolve();
          }
        };
        const settleErr = (error: unknown): void => {
          if (!settled) {
            settled = true;
            reject(error);
          }
        };

        void this.applePay
          .mountExpressCheckout(
            container,
            {
              product: this.product,
              checkout: this.checkout,
              theme: resolvedTheme,
              locale: elementsLocale,
              onReady: () => settleOk(),
              onUnavailable: () =>
                settleErr(
                  new PaymentError({
                    code: 'PROVIDER_UNAVAILABLE',
                    message:
                      'Apple Pay is not available in this browser, device, or wallet configuration.',
                    method: 'apple-pay',
                    provider: 'applePay',
                  }),
                ),
              onSuccess: (result) => this.onApplePaySuccess(result, mountGen),
              onCancel: () => this.onApplePayCancel(mountGen),
              onError: (error) => {
                if (!settled) {
                  settleErr(error);
                  return;
                }
                this.onApplePayError(error, mountGen);
              },
              onAttempt: () => this.onApplePayAttempt(mountGen),
            },
            mountId,
          )
          .then((id) => {
            if (this._state() === 'destroyed' || mountGen !== this.mountGeneration) {
              this.applePay.unmountExpressCheckout({ mountId: id });
              settleErr(
                new PaymentError({
                  code: 'PROVIDER_UNAVAILABLE',
                  message: 'Headless checkout session was destroyed during mount().',
                  method: 'apple-pay',
                  provider: 'applePay',
                }),
              );
              return;
            }
            this.applePayEceMountId = id;
            // ready may already have settled synchronously inside mount().
            if (this.applePay.getAvailabilityStatus(this.product) === 'available') {
              settleOk();
            } else if (this.applePay.getAvailabilityStatus(this.product) === 'unavailable') {
              settleErr(
                new PaymentError({
                  code: 'PROVIDER_UNAVAILABLE',
                  message:
                    'Apple Pay is not available in this browser, device, or wallet configuration.',
                  method: 'apple-pay',
                  provider: 'applePay',
                }),
              );
            } else if (this.applePay.getAvailabilityStatus(this.product) === 'error') {
              settleErr(
                new PaymentError({
                  code: 'SDK_LOAD_FAILED',
                  message: 'Failed to initialize Apple Pay.',
                  method: 'apple-pay',
                  provider: 'applePay',
                }),
              );
            }
          })
          .catch(settleErr);
      });

      this.throwIfDestroyedOrMountStale(mountGen, 'mount', 'apple-pay');

      this.applePayEceMountId = mountId;
      this.mountedMethod = 'apple-pay';
      this._lastError.set(null);
      if (this._state() === 'error' || this._state() === 'cancelled' || this._state() === 'success') {
        this._state.set('ready');
      }

      // ECE ready may have flipped availability — refresh Headless projection.
      void this.refreshAvailability().catch(() => undefined);

      return this.createApplePayMountHandle(mountGen, mountId);
    } catch (error) {
      if (this._state() !== 'destroyed' && mountGen === this.mountGeneration) {
        this.mountedMethod = null;
        const id = this.applePayEceMountId ?? mountId;
        this.applePayEceMountId = null;
        // Keep ECE-decided unavailable/error so remount fails closed without a fake button.
        this.applePay.unmountExpressCheckout({
          mountId: id,
          preserveAvailability: true,
        });
      }
      if (this._state() === 'destroyed') {
        throw new PaymentError({
          code: 'PROVIDER_UNAVAILABLE',
          message: 'Headless checkout session was destroyed during mount().',
          method: 'apple-pay',
          provider: 'applePay',
        });
      }
      const paymentError =
        error instanceof PaymentError
          ? error
          : mapApplePayError(error, 'SDK_LOAD_FAILED', 'Failed to initialize Apple Pay.');
      this._lastError.set(paymentError);
      this.emitError(paymentError);
      throw paymentError;
    }
  }

  async confirm(): Promise<void> {
    this.assertNotDestroyed('confirm');

    const selected = this._selectedMethod();
    const selectedMeta = {
      method: selected ?? undefined,
      provider: selected ? PAYMENT_METHOD_PROVIDER_MAP[selected] : undefined,
    };

    this.assertNotPaymentLocked('confirm', selected ?? undefined);

    if (this._state() === 'idle' || this._state() === 'initializing') {
      throw new PaymentError({
        code: 'PROVIDER_UNAVAILABLE',
        message: 'Call initialize() and mount() before confirm().',
        ...selectedMeta,
      });
    }

    if (selected === 'paypal') {
      throw new PaymentError({
        code: 'CONFIG_INVALID',
        message:
          'PayPal is confirmed through the official PayPal Buttons, not session.confirm(). Mount PayPal and let the buyer click the PayPal button.',
        method: 'paypal',
        provider: 'paypal',
      });
    }

    if (selected === 'google-pay') {
      throw new PaymentError({
        code: 'CONFIG_INVALID',
        message:
          'Google Pay is confirmed through the official Google Pay button, not session.confirm(). Mount Google Pay and let the buyer click the Google Pay button.',
        method: 'google-pay',
        provider: 'googlePay',
      });
    }

    if (selected === 'apple-pay') {
      throw new PaymentError({
        code: 'CONFIG_INVALID',
        message:
          'Apple Pay is confirmed through the official Apple Pay control, not session.confirm(). Mount Apple Pay and let the buyer authorize payment.',
        method: 'apple-pay',
        provider: 'applePay',
      });
    }

    if (!selected || !isStripeElementMethod(selected)) {
      throw new PaymentError({
        code: 'CONFIG_INVALID',
        message:
          'confirm() requires selectedMethod() to be "card", "klarna", or "affirm" with an active Stripe Payment Element mount.',
        ...selectedMeta,
      });
    }

    if (this.mountedMethod !== selected) {
      throw new PaymentError({
        code: 'PROVIDER_UNAVAILABLE',
        message: `Mount the Payment Element with mount("${selected}", container) before confirm().`,
        method: selected,
        provider: this.providerOf(selected),
      });
    }

    const adapter = this.adapterFor(selected);
    if (!adapter.hasMountedElement(this.stripeOwnerId)) {
      throw new PaymentError({
        code: 'PROVIDER_UNAVAILABLE',
        message: `Mount the Payment Element with mount("${selected}", container) before confirm().`,
        method: selected,
        provider: this.providerOf(selected),
      });
    }

    const mountGen = this.mountGeneration;
    const confirmGen = ++this.confirmGeneration;
    this.terminalEmittedForConfirm = 0;

    this._lastError.set(null);
    this._state.set('processing');
    this.emitStarted(selected);

    let pendingAttemptId: string | null = null;

    try {
      const prepared = this.prepareStripeConfirm(selected);
      pendingAttemptId = prepared.attemptId;
      const result = await adapter.confirmPayment(prepared.returnUrl, this.stripeOwnerId);

      if (this.isConfirmStale(mountGen, confirmGen)) {
        // Leave unresolved redirect ownership intact — a newer attempt may own storage.
        return;
      }

      // Same-page settle (no leave-page redirect): clear only this attempt's marker.
      if (pendingAttemptId) {
        clearStripePendingReturnFor(pendingAttemptId);
        pendingAttemptId = null;
      }

      this.applyPaymentResult(result, confirmGen, selected);
    } catch (error) {
      if (this.isConfirmStale(mountGen, confirmGen)) {
        return;
      }

      const paymentError = normalizeError(error, {
        method: selected,
        provider: this.providerOf(selected),
      });

      // Same-page cancel / error / AUTHENTICATION_REQUIRED settle — clear matching attempt only.
      if (pendingAttemptId) {
        clearStripePendingReturnFor(pendingAttemptId);
        pendingAttemptId = null;
      }

      if (paymentError.code === 'PAYMENT_CANCELLED') {
        this.applyPaymentResult(
          {
            status: 'cancelled',
            method: selected,
            provider: this.providerOf(selected),
            message: paymentError.message,
          },
          confirmGen,
          selected,
        );
        return;
      }

      // BNPL may still require a redirect / customer action. Do not treat as success.
      // After a leave-page redirect, recreate the session and call recoverReturn().
      if (paymentError.code === 'AUTHENTICATION_REQUIRED') {
        this.applyPaymentResult(
          {
            status: 'processing',
            method: selected,
            provider: this.providerOf(selected),
            message:
              paymentError.message +
              ' If the buyer left the page, recreate this session with the same checkoutInstanceId and call recoverReturn(). Confirm final fulfillment on your backend.',
          },
          confirmGen,
          selected,
        );
        return;
      }

      this._lastError.set(paymentError);
      this._state.set('error');
      this.emitTerminalError(paymentError, confirmGen);
      throw paymentError;
    }
  }

  /**
   * Recover Klarna/Affirm Stripe redirect returns for this stable checkout identity.
   * No Payment Element mount or confirmPayment — uses {@link StripeRedirectRecoveryService}.
   */
  async recoverReturn(): Promise<PaymentResult | null> {
    this.assertNotDestroyed('recoverReturn');

    if (this._state() === 'idle' || this._state() === 'initializing') {
      throw new PaymentError({
        code: 'CONFIG_INVALID',
        message: 'Call initialize() before recoverReturn().',
      });
    }

    if (!this.stableCheckoutIdentity) {
      throw new PaymentError({
        code: 'CONFIG_INVALID',
        message:
          'Klarna/Affirm Headless return recovery requires a stable merchant checkoutInstanceId that matches the identity used before the redirect.',
      });
    }

    if (this.recoverPromise) {
      return this.recoverPromise;
    }

    if (this.recoverSettled) {
      const priorError = this._lastError();
      if (priorError && this._state() === 'error') {
        throw priorError;
      }
      return this._lastResult();
    }

    // Do not start recovery while another payment operation is active.
    // Transient verification errors leave state `error` with recoverSettled=false (retry allowed).
    if (this._state() === 'processing' || this._state() === 'pending') {
      throw new PaymentError({
        code: 'PAYMENT_FAILED',
        message:
          this._state() === 'processing'
            ? 'A payment operation is already in progress.'
            : 'A payment is already pending. Do not start another recovery or confirmation — confirm the final status on your backend.',
      });
    }

    this.recoverPromise = this.doRecoverReturn().finally(() => {
      this.recoverPromise = null;
    });
    return this.recoverPromise;
  }

  private async doRecoverReturn(): Promise<PaymentResult | null> {
    if (!this.browser.isBrowser || !isStripeReturnAttempt()) {
      return null;
    }

    const claim = await this.stripeRedirectRecovery.claimReturn(this, this.methods);
    if (this._state() === 'destroyed') {
      return null;
    }

    if (claim !== 'owner') {
      // Unrelated / wait / not ours — do not mutate session state or clear another host's return.
      return null;
    }

    const method =
      detectStripeReturnMethod() ??
      (this.methods.includes('affirm') && !this.methods.includes('klarna') ? 'affirm' : 'klarna');
    const recoverGen = ++this.confirmGeneration;
    this.terminalEmittedForConfirm = 0;

    this._lastError.set(null);
    this.applySelection(method);
    this._state.set('processing');
    this.emitStarted(method);

    try {
      const result = await this.stripeRedirectRecovery.consumeReturn();

      if (this._state() === 'destroyed' || recoverGen !== this.confirmGeneration) {
        return null;
      }

      if (!result) {
        const paymentError = new PaymentError({
          code: 'PAYMENT_FAILED',
          message: `${method === 'affirm' ? 'Affirm' : 'Klarna'} return could not be verified.`,
          method,
          provider: method,
        });
        this.recoverSettled = true;
        this._lastError.set(paymentError);
        this._state.set('error');
        this.emitTerminalError(paymentError, recoverGen);
        throw paymentError;
      }

      this.recoverSettled = true;
      this.applyPaymentResult(result, recoverGen, method);
      return result;
    } catch (error) {
      if (this._state() === 'destroyed' || recoverGen !== this.confirmGeneration) {
        return null;
      }

      const paymentError = normalizeError(error, { method, provider: method });

      if (paymentError.code === 'PAYMENT_CANCELLED') {
        this.recoverSettled = true;
        const cancelled: PaymentResult = {
          status: 'cancelled',
          method,
          provider: method,
          message: paymentError.message,
        };
        this.applyPaymentResult(cancelled, recoverGen, method);
        return cancelled;
      }

      // Requires action / confirmation — not success and not ordinary async processing.
      if (paymentError.code === 'AUTHENTICATION_REQUIRED') {
        this.recoverSettled = true;
        this._lastError.set(paymentError);
        this._state.set('error');
        this.emitTerminalError(paymentError, recoverGen);
        throw paymentError;
      }

      // Transient verification failure: leave correlation data, allow recoverReturn() retry.
      if (isTransientStripeVerificationError(paymentError)) {
        this.recoverSettled = false;
        this._lastError.set(paymentError);
        this._state.set('error');
        this.emitTerminalError(paymentError, recoverGen);
        throw paymentError;
      }

      this.recoverSettled = true;
      this._lastError.set(paymentError);
      this._state.set('error');
      this.emitTerminalError(paymentError, recoverGen);
      throw paymentError;
    }
  }

  async destroy(): Promise<void> {
    if (this._state() === 'destroyed') {
      return;
    }

    this.refreshGeneration += 1;
    this.mountGeneration += 1;
    this.confirmGeneration += 1;
    this.mountedMethod = null;
    this.paypalCaptureEmitted = false;
    this.paypalAttemptAnnounced = false;
    this.paypalCurrentOrderId = null;
    this.googlePayAttemptAnnounced = false;
    this.googlePayClickInFlight = false;
    this.applePayAttemptAnnounced = false;
    this._state.set('destroyed');
    this._selectedMethod.set(null);
    this._availableMethods.set([]);
    this.availability.clear();
    this.initPromise = null;

    if (this.returnHostRegistered) {
      this.stripeRedirectRecovery.unregisterHost(this);
      this.returnHostRegistered = false;
    }

    try {
      await Promise.all([
        this.stripeCard.destroy(this.stripeOwnerId),
        this.klarna.destroy(this.stripeOwnerId),
        this.affirm.destroy(this.stripeOwnerId),
        this.destroyPayPalButtonsOnly(),
        Promise.resolve(this.destroyGooglePayButtonOnly()),
        Promise.resolve(this.destroyApplePayEceOnly()),
      ]);
    } catch {
      // Ignore teardown failures.
    }

    this.completeEvents();
    this.releaseId();
  }

  private createStripeMountHandle(
    method: HeadlessStripeElementMethod,
    mountGen: number,
  ): HeadlessMountHandle {
    let unmounted = false;
    return {
      method,
      unmount: () => {
        if (unmounted) {
          return;
        }
        unmounted = true;
        if (this._state() === 'destroyed') {
          return;
        }
        if (mountGen !== this.mountGeneration) {
          return;
        }
        this.mountGeneration += 1;
        this.mountedMethod = null;
        this.adapterFor(method).unmountPaymentElement(this.stripeOwnerId);
      },
    };
  }

  private createPayPalMountHandle(mountGen: number, mountId: string): HeadlessMountHandle {
    let unmounted = false;
    return {
      method: 'paypal',
      unmount: () => {
        if (unmounted) {
          return;
        }
        unmounted = true;
        if (this._state() === 'destroyed') {
          return;
        }
        if (mountGen !== this.mountGeneration) {
          return;
        }
        this.mountGeneration += 1;
        this.mountedMethod = null;
        this.paypalCurrentOrderId = null;
        this.paypalCaptureEmitted = false;
        this.paypalAttemptAnnounced = false;
        if (this.paypalButtonsMountId === mountId) {
          this.paypalButtonsMountId = null;
        }
        void this.paypal.destroyButtons(mountId);
      },
    };
  }

  private async onPayPalCreateOrder(mountGen: number): Promise<string> {
    if (this._state() === 'destroyed' || mountGen !== this.mountGeneration) {
      throw new PaymentError({
        code: 'PAYMENT_FAILED',
        message: 'PayPal checkout was superseded.',
        method: 'paypal',
        provider: 'paypal',
      });
    }

    this._lastError.set(null);
    this.paypalCaptureEmitted = false;
    const confirmGen = ++this.confirmGeneration;
    this.terminalEmittedForConfirm = 0;
    this._state.set('processing');

    if (!this.paypalAttemptAnnounced) {
      this.paypalAttemptAnnounced = true;
      this.emitStarted('paypal');
    }

    try {
      const orderId = await this.paypal.createOrder(
        this.product,
        this.checkout,
        this.paypalOrderOwnerId,
      );
      if (this._state() === 'destroyed' || mountGen !== this.mountGeneration) {
        throw new PaymentError({
          code: 'PAYMENT_FAILED',
          message: 'PayPal checkout was superseded.',
          method: 'paypal',
          provider: 'paypal',
        });
      }
      this.paypalCurrentOrderId = orderId;
      return orderId;
    } catch (error) {
      if (this._state() === 'destroyed' || mountGen !== this.mountGeneration) {
        throw mapPayPalError(error, 'BACKEND_ERROR', 'Failed to create PayPal order.');
      }
      const paymentError = mapPayPalError(error, 'BACKEND_ERROR', 'Failed to create PayPal order.');
      this.paypalAttemptAnnounced = false;
      this._lastError.set(paymentError);
      this._state.set('error');
      this.emitTerminalError(paymentError, confirmGen);
      // Buttons remain mounted — allow another buyer attempt.
      this._state.set('ready');
      throw paymentError;
    }
  }

  private async onPayPalApprove(orderId: string, mountGen: number): Promise<void> {
    if (
      this._state() === 'destroyed' ||
      mountGen !== this.mountGeneration ||
      this.paypalCaptureEmitted
    ) {
      return;
    }
    this.paypalCaptureEmitted = true;

    const confirmGen = this.confirmGeneration;
    this._state.set('processing');
    this._lastError.set(null);

    try {
      const result = await this.paypal.captureOrder(orderId);
      if (this._state() === 'destroyed' || mountGen !== this.mountGeneration) {
        return;
      }

      if (result.status === 'success') {
        this.paypalAttemptAnnounced = false;
        this.applyPaymentResult(result, confirmGen, 'paypal');
        return;
      }

      if (result.status === 'processing') {
        this.paypalAttemptAnnounced = false;
        this.applyPaymentResult(result, confirmGen, 'paypal');
        return;
      }

      if (result.status === 'cancelled') {
        this.paypalAttemptAnnounced = false;
        this.applyPaymentResult(result, confirmGen, 'paypal');
        this.restorePayPalReadyAfterTerminal(mountGen);
        return;
      }

      const paymentError = new PaymentError({
        code: 'PAYMENT_FAILED',
        message: result.message ?? 'PayPal payment failed.',
        method: 'paypal',
        provider: 'paypal',
      });
      this.paypalAttemptAnnounced = false;
      this.paypalCaptureEmitted = false;
      this._lastError.set(paymentError);
      this._state.set('error');
      this.emitTerminalError(paymentError, confirmGen);
      this.restorePayPalReadyAfterTerminal(mountGen);
    } catch (error) {
      if (this._state() === 'destroyed' || mountGen !== this.mountGeneration) {
        return;
      }
      const paymentError = normalizeError(error, { method: 'paypal', provider: 'paypal' });
      if (paymentError.code === 'PAYMENT_CANCELLED') {
        this.paypalAttemptAnnounced = false;
        this.paypalCaptureEmitted = false;
        this.applyPaymentResult(
          {
            status: 'cancelled',
            method: 'paypal',
            provider: 'paypal',
            message: paymentError.message,
            sessionId: orderId,
          },
          confirmGen,
          'paypal',
        );
        this.restorePayPalReadyAfterTerminal(mountGen);
        return;
      }

      this.paypalAttemptAnnounced = false;
      this.paypalCaptureEmitted = false;
      this._lastError.set(paymentError);
      this._state.set('error');
      this.emitTerminalError(paymentError, confirmGen);
      this.restorePayPalReadyAfterTerminal(mountGen);
    }
  }

  private onPayPalCancel(mountGen: number): void {
    if (this._state() === 'destroyed' || mountGen !== this.mountGeneration) {
      return;
    }

    const confirmGen = this.confirmGeneration || ++this.confirmGeneration;
    this.paypalAttemptAnnounced = false;
    this.paypalCaptureEmitted = false;
    this.applyPaymentResult(
      {
        status: 'cancelled',
        method: 'paypal',
        provider: 'paypal',
        message: 'PayPal checkout was cancelled.',
        sessionId: this.paypalCurrentOrderId ?? undefined,
      },
      confirmGen,
      'paypal',
    );
    this.restorePayPalReadyAfterTerminal(mountGen);
  }

  private onPayPalSdkError(err: unknown, mountGen: number): void {
    if (this._state() === 'destroyed' || mountGen !== this.mountGeneration) {
      return;
    }

    const paymentError = mapPayPalError(err);
    if (paymentError.code === 'PAYMENT_CANCELLED') {
      this.onPayPalCancel(mountGen);
      return;
    }

    const confirmGen = this.confirmGeneration || ++this.confirmGeneration;
    this.paypalAttemptAnnounced = false;
    this.paypalCaptureEmitted = false;
    this._lastError.set(paymentError);
    this._state.set('error');
    this.emitTerminalError(paymentError, confirmGen);
    this.restorePayPalReadyAfterTerminal(mountGen);
  }

  /** Official Buttons stay mounted after cancel/error so the buyer can retry. */
  private restorePayPalReadyAfterTerminal(mountGen: number): void {
    queueMicrotask(() => {
      if (
        this._state() === 'destroyed' ||
        mountGen !== this.mountGeneration ||
        this.mountedMethod !== 'paypal'
      ) {
        return;
      }
      if (
        this._state() === 'cancelled' ||
        this._state() === 'error' ||
        this._state() === 'processing'
      ) {
        this._state.set('ready');
      }
    });
  }

  private createGooglePayMountHandle(mountGen: number, mountId: string): HeadlessMountHandle {
    let unmounted = false;
    return {
      method: 'google-pay',
      unmount: () => {
        if (unmounted) {
          return;
        }
        unmounted = true;
        if (this._state() === 'destroyed') {
          return;
        }
        if (mountGen !== this.mountGeneration) {
          return;
        }
        this.mountGeneration += 1;
        this.mountedMethod = null;
        this.googlePayAttemptAnnounced = false;
        this.googlePayClickInFlight = false;
        if (this.googlePayButtonMountId === mountId) {
          this.googlePayButtonMountId = null;
        }
        this.googlePay.destroyButtonMount(mountId);
      },
    };
  }

  private async onGooglePayClick(mountGen: number): Promise<void> {
    if (
      this._state() === 'destroyed' ||
      mountGen !== this.mountGeneration ||
      this.googlePayClickInFlight ||
      this.googlePay.isProcessing(this.googlePayOwnerId) ||
      this._state() === 'success' ||
      this._state() === 'pending'
    ) {
      return;
    }

    this.googlePayClickInFlight = true;
    this._lastError.set(null);
    const confirmGen = ++this.confirmGeneration;
    this.terminalEmittedForConfirm = 0;
    this._state.set('processing');

    if (!this.googlePayAttemptAnnounced) {
      this.googlePayAttemptAnnounced = true;
      this.emitStarted('google-pay');
    }

    try {
      const result = await this.googlePay.payWithGooglePay(
        this.product,
        this.checkout,
        this.googlePayOwnerId,
      );

      if (this._state() === 'destroyed' || mountGen !== this.mountGeneration) {
        return;
      }

      if (result.status === 'success') {
        this.googlePayAttemptAnnounced = false;
        this.applyPaymentResult(result, confirmGen, 'google-pay');
        return;
      }

      if (result.status === 'processing') {
        this.googlePayAttemptAnnounced = false;
        this.applyPaymentResult(result, confirmGen, 'google-pay');
        return;
      }

      if (result.status === 'cancelled') {
        this.googlePayAttemptAnnounced = false;
        this.applyPaymentResult(result, confirmGen, 'google-pay');
        this.restoreGooglePayReadyAfterTerminal(mountGen);
        return;
      }

      const paymentError = new PaymentError({
        code: 'PAYMENT_FAILED',
        message: result.message ?? 'Google Pay payment failed.',
        method: 'google-pay',
        provider: 'googlePay',
      });
      this.googlePayAttemptAnnounced = false;
      this._lastError.set(paymentError);
      this._state.set('error');
      this.emitTerminalError(paymentError, confirmGen);
      this.restoreGooglePayReadyAfterTerminal(mountGen);
    } catch (error) {
      if (this._state() === 'destroyed' || mountGen !== this.mountGeneration) {
        return;
      }

      const paymentError = normalizeError(error, {
        method: 'google-pay',
        provider: 'googlePay',
      });

      if (paymentError.code === 'PAYMENT_CANCELLED') {
        this.googlePayAttemptAnnounced = false;
        this.applyPaymentResult(
          {
            status: 'cancelled',
            method: 'google-pay',
            provider: 'googlePay',
            message: paymentError.message,
          },
          confirmGen,
          'google-pay',
        );
        this.restoreGooglePayReadyAfterTerminal(mountGen);
        return;
      }

      this.googlePayAttemptAnnounced = false;
      this._lastError.set(paymentError);
      this._state.set('error');
      this.emitTerminalError(paymentError, confirmGen);
      this.restoreGooglePayReadyAfterTerminal(mountGen);
    } finally {
      if (mountGen === this.mountGeneration) {
        this.googlePayClickInFlight = false;
      }
    }
  }

  /** Official Google Pay button stays mounted after cancel/error for another attempt. */
  private restoreGooglePayReadyAfterTerminal(mountGen: number): void {
    queueMicrotask(() => {
      if (
        this._state() === 'destroyed' ||
        mountGen !== this.mountGeneration ||
        this.mountedMethod !== 'google-pay'
      ) {
        return;
      }
      if (
        this._state() === 'cancelled' ||
        this._state() === 'error' ||
        this._state() === 'processing'
      ) {
        this._state.set('ready');
      }
    });
  }

  private async teardownActiveMounts(): Promise<void> {
    this.unmountAllStripeElements();
    await this.destroyPayPalButtonsOnly();
    this.destroyGooglePayButtonOnly();
    this.destroyApplePayEceOnly();
  }

  private async destroyPayPalButtonsOnly(): Promise<void> {
    const id = this.paypalButtonsMountId;
    this.paypalButtonsMountId = null;
    if (id) {
      await this.paypal.destroyButtons(id);
    }
  }

  private destroyGooglePayButtonOnly(): void {
    const id = this.googlePayButtonMountId;
    this.googlePayButtonMountId = null;
    if (id) {
      this.googlePay.destroyButtonMount(id);
    }
  }

  private destroyApplePayEceOnly(): void {
    const id = this.applePayEceMountId;
    this.applePayEceMountId = null;
    if (id) {
      this.applePay.unmountExpressCheckout({
        mountId: id,
        preserveAvailability: true,
      });
    }
  }

  private createApplePayMountHandle(mountGen: number, mountId: string): HeadlessMountHandle {
    let unmounted = false;
    return {
      method: 'apple-pay',
      unmount: () => {
        if (unmounted) {
          return;
        }
        unmounted = true;
        if (this._state() === 'destroyed') {
          return;
        }
        if (mountGen !== this.mountGeneration) {
          return;
        }
        this.mountGeneration += 1;
        this.mountedMethod = null;
        this.applePayAttemptAnnounced = false;
        if (this.applePayEceMountId === mountId) {
          this.applePayEceMountId = null;
        }
        this.applePay.unmountExpressCheckout({
          mountId,
          preserveAvailability: true,
        });
      },
    };
  }

  private onApplePayAttempt(mountGen: number): void {
    if (
      this._state() === 'destroyed' ||
      mountGen !== this.mountGeneration ||
      this._state() === 'success' ||
      this._state() === 'pending'
    ) {
      return;
    }

    this._lastError.set(null);
    this.confirmGeneration += 1;
    this.terminalEmittedForConfirm = 0;
    this._state.set('processing');

    if (!this.applePayAttemptAnnounced) {
      this.applePayAttemptAnnounced = true;
      this.emitStarted('apple-pay');
    }
  }

  private onApplePaySuccess(result: PaymentResult, mountGen: number): void {
    if (this._state() === 'destroyed' || mountGen !== this.mountGeneration) {
      return;
    }

    const confirmGen = this.confirmGeneration;
    this.applePayAttemptAnnounced = false;

    if (result.status === 'cancelled') {
      this.applyPaymentResult(result, confirmGen, 'apple-pay');
      this.restoreApplePayReadyAfterTerminal(mountGen);
      return;
    }

    if (result.status === 'success' || result.status === 'processing') {
      this.applyPaymentResult(result, confirmGen, 'apple-pay');
      return;
    }

    const paymentError = new PaymentError({
      code: 'PAYMENT_FAILED',
      message: result.message ?? 'Apple Pay payment failed.',
      method: 'apple-pay',
      provider: 'applePay',
    });
    this._lastError.set(paymentError);
    this._state.set('error');
    this.emitTerminalError(paymentError, confirmGen);
    this.restoreApplePayReadyAfterTerminal(mountGen);
  }

  private onApplePayCancel(mountGen: number): void {
    if (this._state() === 'destroyed' || mountGen !== this.mountGeneration) {
      return;
    }

    const confirmGen = this.confirmGeneration || ++this.confirmGeneration;
    this.applePayAttemptAnnounced = false;
    this.applyPaymentResult(
      {
        status: 'cancelled',
        method: 'apple-pay',
        provider: 'applePay',
        message: 'Apple Pay was cancelled.',
      },
      confirmGen,
      'apple-pay',
    );
    this.restoreApplePayReadyAfterTerminal(mountGen);
  }

  private onApplePayError(error: PaymentError, mountGen: number): void {
    if (this._state() === 'destroyed' || mountGen !== this.mountGeneration) {
      return;
    }

    const paymentError = normalizeError(error, {
      method: 'apple-pay',
      provider: 'applePay',
    });

    if (paymentError.code === 'PAYMENT_CANCELLED') {
      this.onApplePayCancel(mountGen);
      return;
    }

    const confirmGen = this.confirmGeneration || ++this.confirmGeneration;
    this.applePayAttemptAnnounced = false;
    this._lastError.set(paymentError);
    this._state.set('error');
    this.emitTerminalError(paymentError, confirmGen);
    this.restoreApplePayReadyAfterTerminal(mountGen);
  }

  /** Official Apple Pay control stays mounted after cancel/error for another attempt. */
  private restoreApplePayReadyAfterTerminal(mountGen: number): void {
    queueMicrotask(() => {
      if (
        this._state() === 'destroyed' ||
        mountGen !== this.mountGeneration ||
        this.mountedMethod !== 'apple-pay'
      ) {
        return;
      }
      if (
        this._state() === 'cancelled' ||
        this._state() === 'error' ||
        this._state() === 'processing'
      ) {
        this._state.set('ready');
      }
    });
  }

  private async createStripeElementSession(
    method: HeadlessStripeElementMethod,
    effectiveLocale: ReturnType<typeof resolveEffectiveLocale>,
  ): Promise<{ clientSecret: string }> {
    if (method === 'card') {
      return this.stripeCard.createPaymentSession(
        this.product,
        this.checkout,
        this.stripeOwnerId,
      );
    }

    const snapshot = this.config.getSnapshot();
    if (method === 'klarna') {
      const configured = snapshot.providers?.klarna?.locale?.trim();
      const preferred =
        configured ||
        toKlarnaPreferredLocale(
          effectiveLocale,
          snapshot.providers?.klarna?.purchaseCountry ?? 'US',
        );
      return this.klarna.createPaymentSession(
        this.product,
        this.checkout,
        preferred,
        this.stripeOwnerId,
      );
    }

    const configured = snapshot.providers?.affirm?.locale?.trim();
    const preferred =
      configured ||
      toAffirmPreferredLocale(
        effectiveLocale,
        snapshot.providers?.affirm?.purchaseCountry ?? 'US',
      );
    return this.affirm.createPaymentSession(
      this.product,
      this.checkout,
      preferred,
      this.stripeOwnerId,
    );
  }

  /**
   * Card: optional successUrl only.
   * Klarna/Affirm: require merchant-stable identity, write `hostKind: 'headless'`
   * pending marker, stamp `ep_method` + `ep_attempt` on return_url before confirm.
   */
  private prepareStripeConfirm(method: HeadlessStripeElementMethod): {
    returnUrl: string | undefined;
    attemptId: string | null;
  } {
    const base = this.checkout?.successUrl;
    if (method === 'card') {
      return { returnUrl: base, attemptId: null };
    }

    if (!this.stableCheckoutIdentity) {
      throw new PaymentError({
        code: 'CONFIG_INVALID',
        message:
          'Klarna/Affirm Headless redirect confirmation requires a stable merchant checkoutInstanceId that can be reused after page reload. Auto-generated session ids cannot own redirect returns.',
        method,
        provider: this.providerOf(method),
      });
    }

    if (!this.browser.isBrowser) {
      throw new PaymentError({
        code: 'PROVIDER_UNAVAILABLE',
        message: 'Klarna/Affirm Headless confirmation requires a browser context.',
        method,
        provider: this.providerOf(method),
      });
    }

    const attemptId = createStripeReturnAttemptId();
    const redirectMethod = method as StripeRedirectMethod;
    markHeadlessPendingReturn(redirectMethod, this.product.id, {
      attemptId,
      checkoutInstanceId: this.stableCheckoutIdentity,
    });
    const returnUrl = buildStripeReturnUrl(redirectMethod, base, undefined, attemptId);
    return { returnUrl, attemptId };
  }

  private adapterFor(method: HeadlessStripeElementMethod): StripeElementAdapterApi {
    switch (method) {
      case 'card':
        return this.stripeCard;
      case 'klarna':
        return this.klarna;
      case 'affirm':
        return this.affirm;
    }
  }

  private unmountAllStripeElements(): void {
    this.stripeCard.unmountPaymentElement(this.stripeOwnerId);
    this.klarna.unmountPaymentElement(this.stripeOwnerId);
    this.affirm.unmountPaymentElement(this.stripeOwnerId);
  }

  private providerOf(method: HeadlessMountableMethod): PaymentProviderName {
    return PAYMENT_METHOD_PROVIDER_MAP[method];
  }

  private applyPaymentResult(
    result: PaymentResult,
    confirmGen: number,
    method: HeadlessMountableMethod,
  ): void {
    if (confirmGen !== this.confirmGeneration || this._state() === 'destroyed') {
      return;
    }

    this._lastResult.set(result);

    if (result.status === 'success') {
      this._state.set('success');
      this.emitTerminalSuccess(result, confirmGen);
      return;
    }

    if (result.status === 'processing') {
      this._state.set('pending');
      this.emitTerminalPending(result, confirmGen);
      return;
    }

    if (result.status === 'cancelled') {
      this._state.set('cancelled');
      this.emitTerminalCancel(result, confirmGen);
      return;
    }

    const paymentError = new PaymentError({
      code: 'PAYMENT_FAILED',
      message: result.message ?? 'Payment failed.',
      method,
      provider: this.providerOf(method),
    });
    this._lastError.set(paymentError);
    this._state.set('error');
    this.emitTerminalError(paymentError, confirmGen);
  }

  private emitStarted(method: HeadlessMountableMethod): void {
    if (this.started$.closed) {
      return;
    }
    this.started$.next({
      method,
      provider: this.providerOf(method),
      amount: this.product.amount,
      currency: this.product.currency,
    });
  }

  private emitTerminalSuccess(result: PaymentResult, confirmGen: number): void {
    if (this.terminalEmittedForConfirm === confirmGen || this.success$.closed) {
      return;
    }
    this.terminalEmittedForConfirm = confirmGen;
    this.success$.next(result);
  }

  private emitTerminalPending(result: PaymentResult, confirmGen: number): void {
    if (this.terminalEmittedForConfirm === confirmGen || this.pending$.closed) {
      return;
    }
    this.terminalEmittedForConfirm = confirmGen;
    this.pending$.next(result);
  }

  private emitTerminalCancel(result: PaymentResult, confirmGen: number): void {
    if (this.terminalEmittedForConfirm === confirmGen || this.cancel$.closed) {
      return;
    }
    this.terminalEmittedForConfirm = confirmGen;
    this.cancel$.next(result);
  }

  private emitTerminalError(error: PaymentError, confirmGen: number): void {
    if (this.terminalEmittedForConfirm === confirmGen || this.error$.closed) {
      return;
    }
    this.terminalEmittedForConfirm = confirmGen;
    this.error$.next(error);
  }

  private emitError(error: PaymentError): void {
    if (!this.error$.closed) {
      this.error$.next(error);
    }
  }

  private async publishAvailability(
    generation: number,
  ): Promise<readonly HeadlessMethodStatus[]> {
    const prefersDark =
      this.browser.matchMedia('(prefers-color-scheme: dark)')?.matches ?? false;
    const resolvedTheme = resolveHeadlessTheme(this.theme, prefersDark);

    const results = await this.orchestrator.refreshAvailability(
      [...this.methods],
      this.product,
      this.checkout,
      resolvedTheme,
    );

    if (this.isStale(generation)) {
      return this._availableMethods();
    }

    this.availability.apply(results);
    const projected = results.map(toHeadlessMethodStatus);
    this._availableMethods.set(projected);

    const selected = this._selectedMethod();
    if (selected && !this.methods.includes(selected)) {
      this.applySelection(null);
    }

    return projected;
  }

  private assertProduct(): void {
    const result = validatePaymentProduct(this.product);
    if (!result.valid) {
      throw new PaymentError({
        code: 'PRODUCT_INVALID',
        message: result.errors.join(' '),
      });
    }
  }

  private applySelection(method: PaymentMethod | null): void {
    const previous = this._selectedMethod();
    if (previous === method) {
      return;
    }
    this._selectedMethod.set(method);
    if (!this.methodChange$.closed) {
      this.methodChange$.next({
        method,
        previousMethod: previous,
        provider: method ? PAYMENT_METHOD_PROVIDER_MAP[method] : null,
      });
    }
  }

  private assertNotDestroyed(operation: string): void {
    if (this._state() === 'destroyed') {
      throw new PaymentError({
        code: 'PROVIDER_UNAVAILABLE',
        message: `Cannot ${operation}() on a destroyed Headless checkout session.`,
      });
    }
  }

  /**
   * Blocks mount / select / confirm while a payment is in-flight or unresolved pending.
   * Includes in-flight recoverReturn before state flips to `processing` (after claim).
   * Does not block destroy, recoverReturn retry after transient error, or availability refresh.
   */
  private assertNotPaymentLocked(operation: string, method?: PaymentMethod): void {
    const state = this._state();
    const meta = method
      ? { method, provider: PAYMENT_METHOD_PROVIDER_MAP[method] }
      : {};
    if (this.recoverPromise || state === 'processing') {
      throw new PaymentError({
        code: 'PAYMENT_FAILED',
        message: `Cannot ${operation}() while a payment operation is already in progress.`,
        ...meta,
      });
    }
    if (state === 'pending') {
      throw new PaymentError({
        code: 'PAYMENT_FAILED',
        message: `Cannot ${operation}() while a payment is pending. Do not start another payment — confirm the final status on your backend.`,
        ...meta,
      });
    }
  }

  private throwIfDestroyedOrStale(generation: number, operation: string): void {
    if (this._state() === 'destroyed') {
      throw new PaymentError({
        code: 'PROVIDER_UNAVAILABLE',
        message: `Headless checkout session was destroyed during ${operation}().`,
      });
    }
    if (generation !== this.refreshGeneration) {
      throw new PaymentError({
        code: 'PROVIDER_UNAVAILABLE',
        message: `Headless checkout ${operation}() was superseded by a newer operation.`,
      });
    }
  }

  private throwIfDestroyedOrMountStale(
    mountGen: number,
    operation: string,
    method: HeadlessMountableMethod,
  ): void {
    if (this._state() === 'destroyed') {
      throw new PaymentError({
        code: 'PROVIDER_UNAVAILABLE',
        message: `Headless checkout session was destroyed during ${operation}().`,
        method,
        provider: this.providerOf(method),
      });
    }
    if (mountGen !== this.mountGeneration) {
      throw new PaymentError({
        code: 'PROVIDER_UNAVAILABLE',
        message: `Headless checkout ${operation}() was superseded by a newer mount/unmount.`,
        method,
        provider: this.providerOf(method),
      });
    }
  }

  private isConfirmStale(mountGen: number, confirmGen: number): boolean {
    return (
      this._state() === 'destroyed' ||
      confirmGen !== this.confirmGeneration ||
      mountGen !== this.mountGeneration
    );
  }

  private isStale(generation: number): boolean {
    return this._state() === 'destroyed' || generation !== this.refreshGeneration;
  }

  private completeEvents(): void {
    this.started$.complete();
    this.methodChange$.complete();
    this.pending$.complete();
    this.success$.complete();
    this.cancel$.complete();
    this.error$.complete();
  }

  private releaseId(): void {
    if (this.released) {
      return;
    }
    this.released = true;
    this.sessionRegistry.release(this.id);
  }
}

function methodLabel(method: HeadlessMountableMethod): string {
  switch (method) {
    case 'card':
      return 'Card';
    case 'klarna':
      return 'Klarna';
    case 'affirm':
      return 'Affirm';
    case 'paypal':
      return 'PayPal';
    case 'google-pay':
      return 'Google Pay';
    case 'apple-pay':
      return 'Apple Pay';
  }
}
