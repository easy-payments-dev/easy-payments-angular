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
import type { StripeCardAdapter } from '../adapters/stripe/stripe-card.adapter';
import {
  resolveEffectiveLocale,
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
  stripeCard: StripeCardAdapter;
}

/**
 * Independently owned Headless session.
 * H3.1: Stripe Card mount + confirm via existing StripeCardAdapter.
 */
export class HeadlessCheckoutSessionImpl implements HeadlessCheckoutSession {
  readonly id: string;

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
  private readonly stripeCard: StripeCardAdapter;
  private readonly availability = new CheckoutAvailabilitySession();

  /** Stripe Element session owner — equals Headless session id for isolation. */
  private readonly stripeOwnerId: string;

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
  private cardMounted = false;
  private confirmGeneration = 0;
  private terminalEmittedForConfirm = 0;

  constructor(deps: HeadlessCheckoutSessionDeps) {
    this.id = deps.id;
    this.stripeOwnerId = deps.id;
    this.product = deps.product;
    this.methods = deps.methods;
    this.checkout = deps.checkout;
    this.locale = deps.locale ?? 'auto';
    this.translations = deps.translations;
    this.theme = deps.theme;
    this.orchestrator = deps.orchestrator;
    this.sessionRegistry = deps.registry;
    this.browser = deps.browser;
    this.stripeCard = deps.stripeCard;
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
    if (this._state() === 'error' && !this.cardMounted) {
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
    if (this._state() === 'processing') {
      throw new PaymentError({
        code: 'PAYMENT_FAILED',
        message: 'Cannot change payment method while a confirmation is in progress.',
      });
    }

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

    if (this._state() === 'processing') {
      throw new PaymentError({
        code: 'PAYMENT_FAILED',
        message: 'Cannot mount while a payment confirmation is in progress.',
        method: 'card',
        provider: 'stripe',
      });
    }

    if (method !== 'card') {
      throw new PaymentError({
        code: 'PROVIDER_NOT_IMPLEMENTED',
        message:
          'Headless mount currently supports only "card". PayPal, wallets, and BNPL arrive in later milestones.',
        method,
        provider: PAYMENT_METHOD_PROVIDER_MAP[method],
      });
    }

    if (!this.methods.includes('card')) {
      throw new PaymentError({
        code: 'CONFIG_INVALID',
        message: 'Payment method "card" is not configured for this Headless session.',
        method: 'card',
        provider: 'stripe',
      });
    }

    if (!container || typeof container !== 'object' || container.nodeType !== 1) {
      throw new PaymentError({
        code: 'CONFIG_INVALID',
        message: 'mount() requires a valid HTMLElement container.',
        method: 'card',
        provider: 'stripe',
      });
    }

    const cardStatus = this._availableMethods().find((entry) => entry.method === 'card');
    if (!cardStatus?.available) {
      throw new PaymentError({
        code: 'PROVIDER_UNAVAILABLE',
        message: 'Card is not available for this Headless session configuration.',
        method: 'card',
        provider: 'stripe',
      });
    }

    this.applySelection('card');

    const mountGen = ++this.mountGeneration;
    this.cardMounted = false;
    this.stripeCard.unmountPaymentElement(this.stripeOwnerId);

    try {
      const prefersDark =
        this.browser.matchMedia('(prefers-color-scheme: dark)')?.matches ?? false;
      const resolvedTheme = resolveHeadlessTheme(this.theme, prefersDark);
      const elementsLocale = toStripeElementsLocale(resolveEffectiveLocale(this.locale));

      const paymentSession = await this.stripeCard.createPaymentSession(
        this.product,
        this.checkout,
        this.stripeOwnerId,
      );

      this.throwIfDestroyedOrMountStale(mountGen, 'mount');

      await this.stripeCard.mountPaymentElement(
        container,
        paymentSession.clientSecret,
        resolvedTheme,
        elementsLocale,
        this.stripeOwnerId,
      );

      this.throwIfDestroyedOrMountStale(mountGen, 'mount');

      if (!this.stripeCard.hasMountedElement(this.stripeOwnerId)) {
        throw new PaymentError({
          code: 'SDK_LOAD_FAILED',
          message: 'Stripe Payment Element failed to mount.',
          method: 'card',
          provider: 'stripe',
        });
      }

      this.cardMounted = true;
      this._lastError.set(null);
      if (this._state() === 'error' || this._state() === 'cancelled' || this._state() === 'success') {
        this._state.set('ready');
      }

      return this.createCardMountHandle(mountGen);
    } catch (error) {
      if (this._state() !== 'destroyed' && mountGen === this.mountGeneration) {
        this.cardMounted = false;
        this.stripeCard.unmountPaymentElement(this.stripeOwnerId);
      }
      if (this._state() === 'destroyed') {
        throw new PaymentError({
          code: 'PROVIDER_UNAVAILABLE',
          message: 'Headless checkout session was destroyed during mount().',
          method: 'card',
          provider: 'stripe',
        });
      }
      const paymentError = normalizeError(error, { method: 'card', provider: 'stripe' });
      this._lastError.set(paymentError);
      this.emitError(paymentError);
      throw paymentError;
    }
  }

  async confirm(): Promise<void> {
    this.assertNotDestroyed('confirm');

    if (this._state() === 'processing') {
      throw new PaymentError({
        code: 'PAYMENT_FAILED',
        message: 'A payment confirmation is already in progress.',
        method: 'card',
        provider: 'stripe',
      });
    }

    if (this._state() === 'pending') {
      throw new PaymentError({
        code: 'PAYMENT_FAILED',
        message:
          'A payment is already pending. Do not retry — confirm the final status on your backend.',
        method: 'card',
        provider: 'stripe',
      });
    }

    if (this._state() === 'idle' || this._state() === 'initializing') {
      throw new PaymentError({
        code: 'PROVIDER_UNAVAILABLE',
        message: 'Call initialize() and mount("card", container) before confirm().',
        method: 'card',
        provider: 'stripe',
      });
    }

    const selected = this._selectedMethod();
    if (selected !== 'card') {
      throw new PaymentError({
        code: 'CONFIG_INVALID',
        message: 'confirm() requires selectedMethod() to be "card" in H3.1.',
        method: selected ?? undefined,
        provider: selected ? PAYMENT_METHOD_PROVIDER_MAP[selected] : undefined,
      });
    }

    if (!this.cardMounted || !this.stripeCard.hasMountedElement(this.stripeOwnerId)) {
      throw new PaymentError({
        code: 'PROVIDER_UNAVAILABLE',
        message: 'Mount the Stripe Payment Element with mount("card", container) before confirm().',
        method: 'card',
        provider: 'stripe',
      });
    }

    const mountGen = this.mountGeneration;
    const confirmGen = ++this.confirmGeneration;
    this.terminalEmittedForConfirm = 0;

    this._lastError.set(null);
    this._state.set('processing');
    this.emitStarted();

    try {
      const result = await this.stripeCard.confirmPayment(
        this.checkout?.successUrl,
        this.stripeOwnerId,
      );

      if (this.isConfirmStale(mountGen, confirmGen)) {
        return;
      }

      this.applyPaymentResult(result, confirmGen);
    } catch (error) {
      if (this.isConfirmStale(mountGen, confirmGen)) {
        return;
      }

      const paymentError = normalizeError(error, { method: 'card', provider: 'stripe' });
      if (paymentError.code === 'PAYMENT_CANCELLED') {
        const cancelled = {
          status: 'cancelled' as const,
          method: 'card' as const,
          provider: 'stripe' as const,
          message: paymentError.message,
        };
        this.applyPaymentResult(cancelled, confirmGen);
        return;
      }

      this._lastError.set(paymentError);
      this._state.set('error');
      this.emitTerminalError(paymentError, confirmGen);
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
    this.cardMounted = false;
    this._state.set('destroyed');
    this._selectedMethod.set(null);
    this._availableMethods.set([]);
    this.availability.clear();
    this.initPromise = null;

    try {
      await this.stripeCard.destroy(this.stripeOwnerId);
    } catch {
      // Ignore teardown failures.
    }

    this.completeEvents();
    this.releaseId();
  }

  private createCardMountHandle(mountGen: number): HeadlessMountHandle {
    let unmounted = false;
    return {
      method: 'card',
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
        this.cardMounted = false;
        this.stripeCard.unmountPaymentElement(this.stripeOwnerId);
      },
    };
  }

  private applyPaymentResult(result: PaymentResult, confirmGen: number): void {
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
      method: 'card',
      provider: 'stripe',
    });
    this._lastError.set(paymentError);
    this._state.set('error');
    this.emitTerminalError(paymentError, confirmGen);
  }

  private emitStarted(): void {
    if (this.started$.closed) {
      return;
    }
    this.started$.next({
      method: 'card',
      provider: 'stripe',
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

  private throwIfDestroyedOrMountStale(mountGen: number, operation: string): void {
    if (this._state() === 'destroyed') {
      throw new PaymentError({
        code: 'PROVIDER_UNAVAILABLE',
        message: `Headless checkout session was destroyed during ${operation}().`,
        method: 'card',
        provider: 'stripe',
      });
    }
    if (mountGen !== this.mountGeneration) {
      throw new PaymentError({
        code: 'PROVIDER_UNAVAILABLE',
        message: `Headless checkout ${operation}() was superseded by a newer mount/unmount.`,
        method: 'card',
        provider: 'stripe',
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
