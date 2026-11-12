import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import {
  CheckoutOptions,
  PaymentProduct,
  PaymentResult,
  ResolvedPaymentTheme,
} from '../../models';
import { PaymentError, normalizeError } from '../../errors/payment-error';
import { validatePaymentProduct } from '../../validators/product.validator';
import { CashAppPayAdapter } from '../../adapters/cash-app-pay/cash-app-pay.adapter';
import {
  buildCashAppPaySessionKey,
  CashAppPayUiState,
} from '../../adapters/cash-app-pay/cash-app-pay.types';
import { createPaymentOwnerId } from '../../utils/payment-owner-id';
import {
  buildStripeReturnUrl,
  clearStripePendingReturnFor,
  createStripeReturnAttemptId,
  isStripeReturnAttempt,
  markStripePendingReturn,
} from '../../adapters/stripe/stripe-redirect-return';
import { StripeConfirmationGate } from '../../adapters/stripe/stripe-confirmation-gate';
import { CheckoutHostContext, type StripeReturnPhase } from '../../services/checkout-host-context';
import { formatMoney } from '../../utils/format-money';
import {
  EasyPaymentsI18nService,
  EN_TRANSLATIONS,
  interpolate,
  localizePaymentError,
  toStripeElementsLocale,
  type EasyPaymentsResolvedLocale,
} from '../../i18n';
import { CheckoutSecurityMessageComponent } from '../checkout/checkout-security-message.component';

@Component({
  selector: 'easy-cash-app-pay-payment',
  standalone: true,
  imports: [CheckoutSecurityMessageComponent],
  template: `
    <div
      class="ep-cash-app-pay"
      [class.ep-cash-app-pay--minimal]="chrome() === 'minimal'"
      [attr.data-state]="uiState()"
      [attr.data-chrome]="chrome()"
    >
      @if (chrome() === 'full') {
        <div class="ep-cash-app-pay__header">
          <h3 class="ep-cash-app-pay__title">{{ msgs().payWithCashAppPay }}</h3>
          <easy-checkout-security-message [message]="msgs().secureCheckoutCashAppPay" />
        </div>
      } @else {
        <easy-checkout-security-message [message]="msgs().secureCheckoutCashAppPay" />
      }

      @if (uiState() === 'initializing' || uiState() === 'loading-session') {
        <p class="ep-cash-app-pay__status" role="status">{{ msgs().preparingCashAppPay }}</p>
      }

      <!--
        Keep the Stripe mount host always in the DOM and visible to layout.
        Toggling display:none on a mounted Stripe iframe causes severe browser jank.
      -->
      <div
        #paymentElementHost
        class="ep-cash-app-pay__element"
        [class.ep-cash-app-pay__element--pending]="
          uiState() === 'initializing' || uiState() === 'loading-session'
        "
        [attr.aria-hidden]="uiState() === 'error' || uiState() === 'idle'"
        [attr.aria-label]="msgs().cashAppPayFormAria"
      ></div>

      @if (inlineError()) {
        <p class="ep-cash-app-pay__error" role="alert">{{ inlineError() }}</p>
      }

      <!--
        Full Checkout may show an in-panel completion banner.
        Buttons Only (chrome=minimal) is event-driven — the host owns outcome UI.
        After settled recovery the lifecycle lock remains; we do not render a success CTA.
      -->
      @if (uiState() === 'success' && chrome() !== 'minimal') {
        <p class="ep-cash-app-pay__success" role="status">{{ msgs().paymentCompleted }}</p>
      }

      @if (uiState() === 'awaiting') {
        <p class="ep-cash-app-pay__status" role="status">{{ msgs().awaitingProviderPayment }}</p>
      }

      @if (uiState() !== 'success' || chrome() !== 'minimal') {
        <button
          type="button"
          class="ep-cash-app-pay__pay"
          [disabled]="!canPay()"
          [attr.aria-busy]="uiState() === 'processing'"
          (click)="onPay()"
        >
          @if (uiState() === 'processing') {
            {{ msgs().processingPayment }}
          } @else if (uiState() === 'awaiting') {
            {{ msgs().awaitingProviderPayment }}
          } @else if (uiState() === 'success') {
            {{ msgs().paymentCompleted }}
          } @else {
            {{ payLabel() }}
          }
        </button>
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        width: 100%;
        font-family: var(--ep-font-family, inherit);
      }

      .ep-cash-app-pay {
        display: flex;
        flex-direction: column;
        gap: 14px;
      }

      .ep-cash-app-pay__header {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }

      .ep-cash-app-pay__title {
        margin: 0;
        font-size: 1rem;
        font-weight: 650;
        color: var(--ep-text, #0f172a);
      }

      .ep-cash-app-pay__status {
        margin: 0;
        font-size: 13px;
        color: var(--ep-text-secondary, #64748b);
      }

      .ep-cash-app-pay__element {
        min-height: 48px;
        padding: 4px 0;
      }

      .ep-cash-app-pay__element--pending {
        opacity: 0.45;
        pointer-events: none;
      }

      .ep-cash-app-pay__error {
        margin: 0;
        color: var(--ep-danger, #b91c1c);
        font-size: 13px;
      }

      .ep-cash-app-pay__success {
        margin: 0;
        color: var(--ep-success, #15803d);
        font-size: 13px;
        font-weight: 600;
      }

      .ep-cash-app-pay__pay {
        min-height: 48px;
        border: 0;
        border-radius: var(--ep-radius-md, 10px);
        background: var(--ep-cta-bg, #0f172a);
        color: var(--ep-cta-text, #f8fafc);
        font: inherit;
        font-size: 15px;
        font-weight: 650;
        cursor: pointer;
      }

      .ep-cash-app-pay__pay:hover:not(:disabled) {
        background: var(--ep-cta-bg-hover, #1e293b);
      }

      .ep-cash-app-pay__pay:focus-visible {
        outline: 2px solid var(--ep-focus, #2563eb);
        outline-offset: 2px;
        box-shadow: 0 0 0 4px color-mix(in srgb, var(--ep-focus, #2563eb) 28%, transparent);
      }

      .ep-cash-app-pay--minimal .ep-cash-app-pay__pay {
        min-height: 44px;
        align-self: flex-start;
        min-width: min(100%, 200px);
        padding: 0 20px;
        font-size: 14px;
      }

      .ep-cash-app-pay__pay:disabled {
        opacity: 0.55;
        cursor: not-allowed;
      }

      @media (prefers-reduced-motion: reduce) {
        .ep-cash-app-pay__pay {
          transition: none;
        }
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CashAppPayPaymentComponent implements AfterViewInit, OnDestroy {
  private readonly cashAppPayAdapter = inject(CashAppPayAdapter);
  private readonly confirmationGate = inject(StripeConfirmationGate);
  private readonly i18n = inject(EasyPaymentsI18nService, { optional: true });
  private readonly hostContext = inject(CheckoutHostContext, { optional: true });
  /** This panel's Payment Element session on the shared CashAppPayAdapter. */
  private readonly ownerId = createPaymentOwnerId('cash-app-pay');

  readonly msgs = computed(() => this.i18n?.messages() ?? EN_TRANSLATIONS);

  readonly product = input.required<PaymentProduct>();
  readonly checkout = input<CheckoutOptions>();
  readonly resolvedTheme = input.required<ResolvedPaymentTheme>();
  /**
   * `full` — checkout chrome (title + amount CTA).
   * `minimal` — Buttons Only expanded panel (security + Element + confirm).
   */
  readonly chrome = input<'full' | 'minimal'>('full');

  readonly success = output<PaymentResult>();
  readonly cancel = output<PaymentResult>();
  readonly error = output<PaymentError>();
  /** Fired once when the customer submits Cash App Pay. Redirect recovery does not fire it again. */
  readonly started = output<void>();
  /** True while confirmPayment / redirect is in progress — parent should lock method switching. */
  readonly busyChange = output<boolean>();
  /**
   * True while recovering a Stripe Cash App Pay redirect return (parent should show
   * Processing payment… and must not flash fresh checkout).
   */
  readonly returning = output<boolean>();

  private readonly host = viewChild.required<ElementRef<HTMLElement>>('paymentElementHost');

  readonly uiState = signal<CashAppPayUiState>('idle');
  readonly inlineError = signal<string | null>(null);

  /** Host element is ready for Stripe mount (must be a signal so the session effect can react). */
  private readonly viewReady = signal(false);

  private sessionKey: string | null = null;
  private lastClientSecret: string | null = null;
  private lastMountedLocale: string | null = null;
  private initGeneration = 0;
  private lastAppliedTheme: ResolvedPaymentTheme | null = null;
  /** Ensures success/cancel/error emit at most once per payment attempt (incl. redirect return). */
  private terminalEmitted = false;
  private destroyed = false;

  readonly amountLabel = computed(() =>
    this.i18n
      ? this.i18n.formatMoney(
          this.product().amount,
          this.product().currency,
          this.product().quantity ?? 1,
        )
      : formatMoney(
          this.product().amount,
          this.product().currency,
          this.product().quantity ?? 1,
          'en',
        ),
  );
  readonly payLabel = computed(() =>
    this.chrome() === 'minimal'
      ? interpolate(this.msgs().continueToMethod, { method: 'Cash App Pay' })
      : interpolate(this.msgs().payAmount, { amount: this.amountLabel() }),
  );

  constructor() {
    // Product/checkout changes may require a new PaymentIntent.
    // Theme must NOT recreate PaymentIntents — only update appearance.
    effect(() => {
      const product = this.product();
      const checkout = this.checkout();
      const ready = this.viewReady();
      const locale = this.i18n?.effectiveLocale() ?? 'en';
      const returnPhase = this.resolveReturnPhase();
      if (!ready) {
        return;
      }
      untracked(() => {
        void this.ensureSession(product, checkout, locale, returnPhase);
      });
    });

    effect(() => {
      const theme = this.resolvedTheme();
      const ready = this.viewReady();
      if (!ready) {
        return;
      }
      untracked(() => {
        void this.applyTheme(theme);
      });
    });
  }

  ngAfterViewInit(): void {
    this.viewReady.set(true);
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.initGeneration += 1;
    this.sessionKey = null;
    this.lastClientSecret = null;
    this.lastMountedLocale = null;
    void this.cashAppPayAdapter.destroy(this.ownerId);
  }

  canPay(): boolean {
    return this.uiState() === 'ready' && !this.cashAppPayAdapter.isConfirming(this.ownerId);
  }

  async onPay(): Promise<void> {
    if (!this.canPay()) {
      return;
    }

    // New attempt: a previous cancel/error must not block retry from this panel.
    this.terminalEmitted = false;
    this.inlineError.set(null);
    this.uiState.set('processing');
    this.started.emit();
    this.busyChange.emit(true);

    const attemptId = createStripeReturnAttemptId();
    try {
      // While another host is confirming, its pending marker must stay intact;
      // confirmPayment below rejects this attempt before anything reaches Stripe.
      if (!this.confirmationGate.isHeld()) {
        markStripePendingReturn(
          'cash-app-pay',
          this.product().id,
          undefined,
          this.hostContext?.describeReturnOrigin(attemptId) ?? { attemptId },
        );
      }
      const returnUrl = buildStripeReturnUrl(
        'cash-app-pay',
        this.checkout()?.successUrl,
        undefined,
        attemptId,
      );
      const result = await this.cashAppPayAdapter.confirmPayment(returnUrl, this.ownerId);

      // If Cash App Pay redirected, this page unloads and confirmPayment never settles here.
      clearStripePendingReturnFor(attemptId);
      this.emitTerminal(result);
    } catch (err) {
      clearStripePendingReturnFor(attemptId);
      const paymentError = normalizeError(err, { method: 'cash-app-pay', provider: 'cashAppPay' });
      if (paymentError.code === 'PAYMENT_CANCELLED') {
        this.emitTerminal({
          status: 'cancelled',
          method: 'cash-app-pay',
          provider: 'cashAppPay',
          message: paymentError.message,
        });
        return;
      }

      this.uiState.set('ready');
      this.inlineError.set(localizePaymentError(paymentError.code, this.msgs()));
      this.emitErrorOnce(paymentError);
    } finally {
      if (!this.destroyed) {
        this.busyChange.emit(false);
      }
    }
  }

  private async applyTheme(theme: ResolvedPaymentTheme): Promise<void> {
    if (this.lastAppliedTheme === theme && this.cashAppPayAdapter.hasMountedElement(this.ownerId)) {
      return;
    }
    this.lastAppliedTheme = theme;
    if (this.cashAppPayAdapter.hasMountedElement(this.ownerId)) {
      await this.cashAppPayAdapter.updateAppearance(theme, this.ownerId);
    }
  }

  /** Host-decided return phase; standalone panels fall back to URL detection. */
  private resolveReturnPhase(): StripeReturnPhase {
    if (this.hostContext) {
      return this.hostContext.returnPhaseFor('cash-app-pay');
    }
    return isStripeReturnAttempt('cash-app-pay') ? 'owner' : 'none';
  }

  private async ensureSession(
    product: PaymentProduct,
    checkout: CheckoutOptions | undefined,
    locale: EasyPaymentsResolvedLocale,
    returnPhase: StripeReturnPhase,
  ): Promise<void> {
    const validation = validatePaymentProduct(product);
    if (!validation.valid) {
      const paymentError = new PaymentError({
        code: 'PRODUCT_INVALID',
        message: validation.errors.join(' '),
        method: 'cash-app-pay',
        provider: 'cashAppPay',
      });
      this.uiState.set('error');
      this.inlineError.set(localizePaymentError(paymentError.code, this.msgs()));
      this.emitErrorOnce(paymentError);
      return;
    }

    // Redirect return is recovered by the owning host. While ownership is unresolved or
    // recovery is in flight, never create a new PaymentIntent. After recovery settles,
    // keep blocking Intent creation (settled/awaiting) while presentation stays chrome-aware:
    // Full Checkout may show completion; Buttons Only (minimal) stays event-driven.
    if (returnPhase === 'pending' || returnPhase === 'owner') {
      this.initGeneration += 1;
      this.sessionKey = null;
      this.uiState.set('processing');
      return;
    }
    if (returnPhase === 'settled') {
      this.initGeneration += 1;
      this.sessionKey = null;
      this.uiState.set('success');
      return;
    }
    if (returnPhase === 'awaiting') {
      this.initGeneration += 1;
      this.sessionKey = null;
      this.uiState.set('awaiting');
      return;
    }

    const nextKey = this.buildSessionKey(product, checkout, locale);
    const elementsLocale = toStripeElementsLocale(locale);

    // Same checkout identity (including in-flight): never create another PaymentIntent.
    if (nextKey === this.sessionKey) {
      if (
        this.lastMountedLocale !== elementsLocale &&
        this.lastClientSecret &&
        this.cashAppPayAdapter.hasMountedElement(this.ownerId)
      ) {
        const host = this.host().nativeElement;
        const theme = untracked(() => this.resolvedTheme());
        await this.cashAppPayAdapter.mountPaymentElement(
          host,
          this.lastClientSecret,
          theme,
          elementsLocale,
          this.ownerId,
        );
        this.lastMountedLocale = elementsLocale;
        this.lastAppliedTheme = theme;
      }
      return;
    }

    const generation = ++this.initGeneration;
    this.sessionKey = nextKey;
    this.uiState.set('initializing');
    this.inlineError.set(null);

    try {
      await this.cashAppPayAdapter.ensureStripeLoaded();
      if (generation !== this.initGeneration) {
        return;
      }

      this.uiState.set('loading-session');
      const session = await this.cashAppPayAdapter.createPaymentSession(
        product,
        checkout,
        this.ownerId,
      );
      if (generation !== this.initGeneration) {
        return;
      }

      const host = this.host().nativeElement;
      const theme = untracked(() => this.resolvedTheme());
      this.lastClientSecret = session.clientSecret;
      await this.cashAppPayAdapter.mountPaymentElement(
        host,
        session.clientSecret,
        theme,
        elementsLocale,
        this.ownerId,
      );
      if (generation !== this.initGeneration) {
        return;
      }

      this.lastMountedLocale = elementsLocale;
      this.lastAppliedTheme = theme;
      this.uiState.set('ready');
    } catch (err) {
      if (generation !== this.initGeneration) {
        return;
      }
      this.sessionKey = null;
      this.lastClientSecret = null;
      this.lastMountedLocale = null;
      const paymentError = normalizeError(err, { method: 'cash-app-pay', provider: 'cashAppPay' });
      this.uiState.set('error');
      this.inlineError.set(localizePaymentError(paymentError.code, this.msgs()));
      this.emitErrorOnce(paymentError);
    }
  }

  private emitTerminal(result: PaymentResult): void {
    if (this.terminalEmitted || this.destroyed) {
      return;
    }
    this.terminalEmitted = true;

    if (result.status === 'success') {
      this.uiState.set('success');
      this.success.emit(result);
      return;
    }

    if (result.status === 'processing') {
      // Host maps this to the optional `pending` output; panel stays locked without active-submit copy.
      this.uiState.set('awaiting');
      this.success.emit(result);
      return;
    }

    if (result.status === 'cancelled') {
      this.uiState.set('ready');
      this.cancel.emit(result);
      return;
    }

    this.uiState.set('ready');
    const paymentError = new PaymentError({
      code: 'PAYMENT_FAILED',
      message: result.message ?? 'Payment failed.',
      method: 'cash-app-pay',
      provider: 'cashAppPay',
    });
    this.inlineError.set(localizePaymentError(paymentError.code, this.msgs()));
    this.error.emit(paymentError);
  }

  private emitErrorOnce(paymentError: PaymentError): void {
    if (this.terminalEmitted || this.destroyed) {
      return;
    }
    this.terminalEmitted = true;
    this.error.emit(paymentError);
  }

  private buildSessionKey(
    product: PaymentProduct,
    checkout: CheckoutOptions | undefined,
    locale: EasyPaymentsResolvedLocale,
  ): string {
    return `${buildCashAppPaySessionKey(product, checkout)}|${toStripeElementsLocale(locale)}`;
  }
}
