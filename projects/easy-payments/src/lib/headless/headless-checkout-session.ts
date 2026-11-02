import { signal, type Signal } from '@angular/core';
import { Subject } from 'rxjs';
import type { CheckoutOptions } from '../models/checkout-options.model';
import type { PaymentMethod } from '../models/payment-method.model';
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
import type {
  EasyPaymentsLocale,
  EasyPaymentsTranslationOverrides,
} from '../i18n';
import { toHeadlessMethodStatus } from './headless-method-meta';
import { resolveHeadlessTheme } from './resolve-headless-theme';
import type { HeadlessSessionRegistry } from './headless-session-registry';
import type {
  HeadlessCheckoutEvents,
  HeadlessCheckoutSession,
  HeadlessMethodStatus,
  HeadlessSessionState,
} from './headless.types';

export interface HeadlessCheckoutSessionDeps {
  id: string;
  product: PaymentProduct;
  methods: readonly PaymentMethod[];
  checkout?: CheckoutOptions;
  locale?: EasyPaymentsLocale;
  translations?: EasyPaymentsTranslationOverrides;
  theme?: PaymentTheme;
  orchestrator: PaymentOrchestratorService;
  registry: HeadlessSessionRegistry;
  browser: BrowserGuard;
}

/**
 * Independently owned Headless session (H2).
 * Payment mount/confirm/redirect recovery intentionally omitted until H3/H4.
 */
export class HeadlessCheckoutSessionImpl implements HeadlessCheckoutSession {
  readonly id: string;

  private readonly product: PaymentProduct;
  private readonly methods: readonly PaymentMethod[];
  private readonly checkout?: CheckoutOptions;
  /** Retained for H3 — not applied to a UI surface in H2. */
  private readonly locale?: EasyPaymentsLocale;
  /** Retained for H3 — not applied to a UI surface in H2. */
  private readonly translations?: EasyPaymentsTranslationOverrides;
  private readonly theme?: PaymentTheme;

  private readonly orchestrator: PaymentOrchestratorService;
  private readonly sessionRegistry: HeadlessSessionRegistry;
  private readonly browser: BrowserGuard;
  private readonly availability = new CheckoutAvailabilitySession();

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

  constructor(deps: HeadlessCheckoutSessionDeps) {
    this.id = deps.id;
    this.product = deps.product;
    this.methods = deps.methods;
    this.checkout = deps.checkout;
    this.locale = deps.locale;
    this.translations = deps.translations;
    this.theme = deps.theme;
    this.orchestrator = deps.orchestrator;
    this.sessionRegistry = deps.registry;
    this.browser = deps.browser;
    // Silence unused-field until H3 consumes locale/translations.
    void this.locale;
    void this.translations;
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
          // Destroyed mid-flight — do not resurrect or overwrite destroyed state.
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
        this.error$.next(paymentError);
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
    if (this._state() === 'error') {
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

    if (method !== null && !this.methods.includes(method)) {
      throw new PaymentError({
        code: 'CONFIG_INVALID',
        message: `Payment method "${method}" is not configured for this Headless session.`,
        method,
        provider: PAYMENT_METHOD_PROVIDER_MAP[method],
      });
    }

    // Selection is allowed even when the method is temporarily unavailable
    // (e.g. Apple Pay still loading). Selection never starts a payment in H2.
    this.applySelection(method);
  }

  async destroy(): Promise<void> {
    if (this._state() === 'destroyed') {
      return;
    }

    this.refreshGeneration += 1;
    this._state.set('destroyed');
    this._selectedMethod.set(null);
    this._availableMethods.set([]);
    this.availability.clear();
    this.initPromise = null;

    this.completeEvents();
    this.releaseId();
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

    // Keep selection when merely unavailable; clear only if allow-list no longer includes it.
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
