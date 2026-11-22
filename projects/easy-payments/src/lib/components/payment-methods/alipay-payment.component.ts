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
  EasyPaymentsCardButtonAppearance,
  PaymentProduct,
  PaymentResult,
  ResolvedPaymentTheme,
} from '../../models';
import { PaymentError, normalizeError } from '../../errors/payment-error';
import { validatePaymentProduct } from '../../validators/product.validator';
import { AlipayAdapter } from '../../adapters/alipay/alipay.adapter';
import {
  buildAlipaySessionKey,
  AlipayUiState,
} from '../../adapters/alipay/alipay.types';
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
import { resolveCardButtonAppearance } from '../../themes/resolve-card-button-appearance';
import { CheckoutSecurityMessageComponent } from '../checkout/checkout-security-message.component';
import { listenForVisibleResume } from '../../utils/visible-resume';

@Component({
  selector: 'easy-alipay-payment',
  standalone: true,
  imports: [CheckoutSecurityMessageComponent],
  host: {
    '[style.--ep-card-cta-bg]': 'cardButtonCssVars().backgroundColor',
    '[style.--ep-card-cta-text]': 'cardButtonCssVars().textColor',
    '[style.--ep-card-cta-font-family]': 'cardButtonCssVars().fontFamily',
    '[style.--ep-card-cta-font-size]': 'cardButtonCssVars().fontSize',
    '[style.--ep-card-cta-font-weight]': 'cardButtonCssVars().fontWeight',
    '[style.--ep-card-cta-text-align]': 'cardButtonCssVars().textAlign',
    '[style.--ep-card-cta-border-width]': 'cardButtonCssVars().borderWidth',
    '[style.--ep-card-cta-border-style]': 'cardButtonCssVars().borderStyle',
    '[style.--ep-card-cta-border-color]': 'cardButtonCssVars().borderColor',
    '[style.--ep-card-cta-radius]': 'cardButtonCssVars().borderRadius',
    '[style.--ep-card-cta-min-height]': 'cardButtonCssVars().minHeight',
    '[style.--ep-card-cta-width]': 'cardButtonCssVars().width',
    '[style.--ep-card-cta-padding]': 'cardButtonCssVars().padding',
    '[style.--ep-card-cta-hover-bg]': 'cardButtonCssVars().hoverBackgroundColor',
    '[style.--ep-card-cta-hover-text]': 'cardButtonCssVars().hoverTextColor',
    '[style.--ep-card-cta-disabled-bg]': 'cardButtonCssVars().disabledBackgroundColor',
    '[style.--ep-card-cta-disabled-text]': 'cardButtonCssVars().disabledTextColor',
    '[style.--ep-card-cta-loading-bg]': 'cardButtonCssVars().loadingBackgroundColor',
    '[style.--ep-card-cta-loading-text]': 'cardButtonCssVars().loadingTextColor',
    '[style.--ep-card-cta-focus-color]': 'cardButtonCssVars().focusOutlineColor',
    '[style.--ep-card-cta-focus-width]': 'cardButtonCssVars().focusOutlineWidth',
    '[style.--ep-card-cta-focus-offset]': 'cardButtonCssVars().focusOutlineOffset',
  },
  template: `
    <div
      class="ep-alipay"
      [class.ep-alipay--minimal]="chrome() === 'minimal'"
      [attr.data-state]="uiState()"
      [attr.data-chrome]="chrome()"
    >
      @if (chrome() === 'full') {
        <div class="ep-alipay__header">
          <h3 class="ep-alipay__title">{{ msgs().payWithAlipay }}</h3>
          <easy-checkout-security-message [message]="msgs().secureCheckoutAlipay" />
        </div>
      } @else {
        <easy-checkout-security-message [message]="msgs().secureCheckoutAlipay" />
      }

      @if (uiState() === 'initializing' || uiState() === 'loading-session') {
        <p class="ep-alipay__status" role="status">{{ msgs().preparingAlipay }}</p>
      }

      <!--
        Keep the Stripe mount host always in the DOM and visible to layout.
        Toggling display:none on a mounted Stripe iframe causes severe browser jank.
      -->
      <div
        #paymentElementHost
        class="ep-alipay__element"
        [class.ep-alipay__element--pending]="
          uiState() === 'initializing' || uiState() === 'loading-session'
        "
        [attr.aria-hidden]="uiState() === 'error' || uiState() === 'idle'"
        [attr.aria-label]="msgs().alipayFormAria"
      ></div>

      @if (inlineError()) {
        <p class="ep-alipay__error" role="alert">{{ inlineError() }}</p>
      }

      <!--
        Full Checkout may show an in-panel completion banner.
        Buttons Only (chrome=minimal) is event-driven — the host owns outcome UI.
        After settled recovery the lifecycle lock remains; we do not render a success CTA.
      -->
      @if (uiState() === 'success' && chrome() !== 'minimal') {
        <p class="ep-alipay__success" role="status">{{ msgs().paymentCompleted }}</p>
      }

      @if (uiState() === 'awaiting') {
        <p class="ep-alipay__status" role="status">{{ msgs().awaitingProviderPayment }}</p>
      }

      @if (uiState() === 'error') {
        <button type="button" class="ep-alipay__pay" (click)="onRetryMount()">
          {{ msgs().errorTryAgain }}
        </button>
      } @else if (uiState() !== 'success' || chrome() !== 'minimal') {
        <button
          type="button"
          class="ep-alipay__pay"
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

      .ep-alipay {
        display: flex;
        flex-direction: column;
        gap: 14px;
      }

      .ep-alipay__header {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }

      .ep-alipay__title {
        margin: 0;
        font-size: 1rem;
        font-weight: 650;
        color: var(--ep-text, #0f172a);
      }

      .ep-alipay__status {
        margin: 0;
        font-size: 13px;
        color: var(--ep-text-secondary, #64748b);
      }

      .ep-alipay__element {
        min-height: 48px;
        padding: 4px 0;
      }

      .ep-alipay__element--pending {
        opacity: 0.45;
        pointer-events: none;
      }

      .ep-alipay__error {
        margin: 0;
        color: var(--ep-danger, #b91c1c);
        font-size: 13px;
      }

      .ep-alipay__success {
        margin: 0;
        color: var(--ep-success, #15803d);
        font-size: 13px;
        font-weight: 600;
      }

      .ep-alipay__pay {
        box-sizing: border-box;
        min-height: var(--ep-card-cta-min-height, 48px);
        width: var(--ep-card-cta-width, auto);
        max-width: 100%;
        padding: var(--ep-card-cta-padding, 0 16px);
        border-width: var(--ep-card-cta-border-width, 0);
        border-style: var(--ep-card-cta-border-style, none);
        border-color: var(--ep-card-cta-border-color, transparent);
        border-radius: var(--ep-card-cta-radius, var(--ep-radius-md, 10px));
        background: var(--ep-card-cta-bg, var(--ep-cta-bg, #0f172a));
        color: var(--ep-card-cta-text, var(--ep-cta-text, #f8fafc));
        font-family: var(--ep-card-cta-font-family, inherit);
        font-size: var(--ep-card-cta-font-size, 15px);
        font-weight: var(--ep-card-cta-font-weight, 650);
        text-align: var(--ep-card-cta-text-align, center);
        cursor: pointer;
        transition:
          background-color 0.15s ease,
          color 0.15s ease,
          border-color 0.15s ease,
          box-shadow 0.15s ease;
      }

      .ep-alipay__pay:hover:not(:disabled) {
        background: var(--ep-card-cta-hover-bg, var(--ep-cta-bg-hover, #1e293b));
        color: var(
          --ep-card-cta-hover-text,
          var(--ep-card-cta-text, var(--ep-cta-text, #f8fafc))
        );
      }

      .ep-alipay__pay:active:not(:disabled) {
        background: var(--ep-card-cta-hover-bg, var(--ep-cta-bg-hover, #1e293b));
        box-shadow: inset 0 1px 0 color-mix(in srgb, #000 18%, transparent);
      }

      .ep-alipay__pay:focus-visible {
        outline: var(--ep-card-cta-focus-width, 2px) solid
          var(--ep-card-cta-focus-color, var(--ep-focus, #2563eb));
        outline-offset: var(--ep-card-cta-focus-offset, 2px);
        box-shadow: 0 0 0 4px
          color-mix(
            in srgb,
            var(--ep-card-cta-focus-color, var(--ep-focus, #2563eb)) 28%,
            transparent
          );
      }

      .ep-alipay--minimal .ep-alipay__pay {
        min-height: var(--ep-card-cta-min-height, 44px);
        align-self: flex-start;
        min-width: min(100%, 200px);
        padding: var(--ep-card-cta-padding, 0 20px);
        font-size: var(--ep-card-cta-font-size, 14px);
      }

      .ep-alipay__pay:disabled {
        cursor: not-allowed;
        opacity: 1;
        background: var(
          --ep-card-cta-disabled-bg,
          color-mix(
            in srgb,
            var(--ep-card-cta-bg, var(--ep-cta-bg, #0f172a)) 42%,
            var(--ep-surface, #ffffff)
          )
        );
        color: var(
          --ep-card-cta-disabled-text,
          color-mix(
            in srgb,
            var(--ep-card-cta-text, var(--ep-cta-text, #f8fafc)) 72%,
            var(--ep-text-secondary, #64748b)
          )
        );
      }

      .ep-alipay__pay[aria-busy='true']:disabled {
        background: var(
          --ep-card-cta-loading-bg,
          color-mix(
            in srgb,
            var(--ep-card-cta-bg, var(--ep-cta-bg, #0f172a)) 58%,
            var(--ep-surface, #ffffff)
          )
        );
        color: var(
          --ep-card-cta-loading-text,
          var(--ep-card-cta-text, var(--ep-cta-text, #f8fafc))
        );
      }

      @media (prefers-reduced-motion: reduce) {
        .ep-alipay__pay {
          transition: none;
        }
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AlipayPaymentComponent implements AfterViewInit, OnDestroy {
  private readonly alipayAdapter = inject(AlipayAdapter);
  private readonly confirmationGate = inject(StripeConfirmationGate);
  private readonly i18n = inject(EasyPaymentsI18nService, { optional: true });
  private readonly hostContext = inject(CheckoutHostContext, { optional: true });
  /** This panel's Payment Element session on the shared AlipayAdapter. */
  private readonly ownerId = createPaymentOwnerId('alipay');

  readonly msgs = computed(() => this.i18n?.messages() ?? EN_TRANSLATIONS);

  readonly product = input.required<PaymentProduct>();
  readonly checkout = input<CheckoutOptions>();
  readonly resolvedTheme = input.required<ResolvedPaymentTheme>();
  /**
   * `full` — checkout chrome (title + amount CTA).
   * `minimal` — Buttons Only expanded panel (security + Element + confirm).
   */
  readonly chrome = input<'full' | 'minimal'>('full');
  /**
   * Optional Easy Payments–owned Alipay CTA presentation (label + CSS tokens).
   * Invalid / omitted fields keep theme defaults and localized labels.
   * Does not restyle the Stripe Payment Element iframe.
   */
  readonly cardButtonAppearance = input<EasyPaymentsCardButtonAppearance | null>(null);

  readonly success = output<PaymentResult>();
  readonly cancel = output<PaymentResult>();
  readonly error = output<PaymentError>();
  /** Fired once when the customer submits Alipay. Redirect recovery does not fire it again. */
  readonly started = output<void>();
  /** True while confirmPayment / redirect is in progress — parent should lock method switching. */
  readonly busyChange = output<boolean>();
  /**
   * True while recovering a Stripe Alipay redirect return (parent should show
   * Processing payment… and must not flash fresh checkout).
   */
  readonly returning = output<boolean>();

  private readonly host = viewChild.required<ElementRef<HTMLElement>>('paymentElementHost');

  readonly uiState = signal<AlipayUiState>('idle');
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
  private detachResumeListen: (() => void) | null = null;
  private resumeReconcileStarted = false;

  readonly resolvedCardButton = computed(() =>
    resolveCardButtonAppearance(this.cardButtonAppearance()),
  );
  readonly cardButtonCssVars = computed(() => this.resolvedCardButton().cssVars);

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
  readonly payLabel = computed(() => {
    // Card `label` must not relabel Alipay — only explicit `alipayLabel`.
    const custom = this.resolvedCardButton().alipayLabel;
    if (custom) {
      return custom;
    }
    return this.chrome() === 'minimal'
      ? interpolate(this.msgs().continueToMethod, { method: 'Alipay' })
      : interpolate(this.msgs().payAmount, { amount: this.amountLabel() });
  });

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
    void this.alipayAdapter.destroy(this.ownerId);
  }

  canPay(): boolean {
    return this.uiState() === 'ready' && !this.alipayAdapter.isConfirming(this.ownerId);
  }

  /** Remount after SDK_LOAD_FAILED / ready timeout without leaving the selected method. */
  async onRetryMount(): Promise<void> {
    if (this.destroyed || this.uiState() !== 'error') {
      return;
    }
    this.terminalEmitted = false;
    this.sessionKey = null;
    this.lastClientSecret = null;
    this.lastMountedLocale = null;
    this.inlineError.set(null);
    const product = this.product();
    const checkout = this.checkout();
    const locale = this.i18n?.effectiveLocale() ?? 'en';
    await this.ensureSession(product, checkout, locale, this.resolveReturnPhase());
  }

  async onPay(): Promise<void> {
    if (!this.canPay()) {
      return;
    }

    const payGeneration = this.initGeneration;
    // New attempt: a previous cancel/error must not block retry from this panel.
    this.terminalEmitted = false;
    this.resumeReconcileStarted = false;
    this.inlineError.set(null);
    this.uiState.set('processing');
    this.started.emit();
    this.busyChange.emit(true);
    this.attachVisibleResume(payGeneration);

    const attemptId = createStripeReturnAttemptId();
    try {
      if (!this.confirmationGate.isHeld()) {
        markStripePendingReturn(
          'alipay',
          this.product().id,
          undefined,
          this.hostContext?.describeReturnOrigin(attemptId) ?? { attemptId },
        );
      }
      const checkout = this.checkout();
      const returnUrl = buildStripeReturnUrl(
        'alipay',
        checkout?.successUrl,
        undefined,
        attemptId,
        { allowExternalHttps: checkout?.allowExternalHttpsReturnUrl === true },
      );
      const result = await this.alipayAdapter.confirmPayment(returnUrl, this.ownerId);

      if (this.destroyed || payGeneration !== this.initGeneration || this.resumeReconcileStarted) {
        return;
      }

      clearStripePendingReturnFor(attemptId);
      this.emitTerminal(result);
    } catch (err) {
      clearStripePendingReturnFor(attemptId);
      if (this.destroyed || payGeneration !== this.initGeneration || this.resumeReconcileStarted) {
        return;
      }
      const paymentError = normalizeError(err, { method: 'alipay', provider: 'alipay' });
      if (paymentError.code === 'PAYMENT_CANCELLED') {
        this.emitTerminal({
          status: 'cancelled',
          method: 'alipay',
          provider: 'alipay',
          message: paymentError.message,
        });
        return;
      }

      this.uiState.set('ready');
      this.inlineError.set(localizePaymentError(paymentError.code, this.msgs()));
      this.emitErrorOnce(paymentError);
    } finally {
      this.detachVisibleResume();
      if (!this.destroyed && payGeneration === this.initGeneration && !this.resumeReconcileStarted) {
        this.busyChange.emit(false);
      }
    }
  }

  private attachVisibleResume(payGeneration: number): void {
    this.detachVisibleResume();
    this.detachResumeListen = listenForVisibleResume(() => {
      void this.reconcileAfterResume(payGeneration);
    });
  }

  private detachVisibleResume(): void {
    this.detachResumeListen?.();
    this.detachResumeListen = null;
  }

  private async reconcileAfterResume(payGeneration: number): Promise<void> {
    if (
      this.destroyed ||
      payGeneration !== this.initGeneration ||
      this.resumeReconcileStarted ||
      this.terminalEmitted
    ) {
      return;
    }
    if (this.uiState() !== 'processing' && !this.alipayAdapter.isConfirming(this.ownerId)) {
      return;
    }

    this.resumeReconcileStarted = true;
    this.detachVisibleResume();
    // Redirect confirm often never settles on Capacitor — drop a hung gate hold.
    this.confirmationGate.clear();
    this.uiState.set('awaiting');

    const secret = this.lastClientSecret;
    if (secret) {
      try {
        const result = await this.alipayAdapter.retrieveReturningPayment(secret);
        if (this.destroyed || payGeneration !== this.initGeneration || this.terminalEmitted) {
          return;
        }
        this.emitTerminal(result);
        this.busyChange.emit(false);
        return;
      } catch {
        // Fall through to status-check.
      }
    }

    if (this.destroyed || payGeneration !== this.initGeneration || this.terminalEmitted) {
      return;
    }
    this.emitTerminal({
      status: 'processing',
      method: 'alipay',
      provider: 'alipay',
      message: this.msgs().checkingPaymentStatus,
      metadata: { statusCheck: true },
    });
    this.busyChange.emit(false);
  }

  private async applyTheme(theme: ResolvedPaymentTheme): Promise<void> {
    if (this.lastAppliedTheme === theme && this.alipayAdapter.hasMountedElement(this.ownerId)) {
      return;
    }
    this.lastAppliedTheme = theme;
    if (this.alipayAdapter.hasMountedElement(this.ownerId)) {
      await this.alipayAdapter.updateAppearance(theme, this.ownerId);
    }
  }

  /** Host-decided return phase; standalone panels fall back to URL detection. */
  private resolveReturnPhase(): StripeReturnPhase {
    if (this.hostContext) {
      return this.hostContext.returnPhaseFor('alipay');
    }
    return isStripeReturnAttempt('alipay') ? 'owner' : 'none';
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
        method: 'alipay',
        provider: 'alipay',
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
        this.alipayAdapter.hasMountedElement(this.ownerId)
      ) {
        const host = this.host().nativeElement;
        const theme = untracked(() => this.resolvedTheme());
        await this.alipayAdapter.mountPaymentElement(
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
      await this.alipayAdapter.ensureStripeLoaded();
      if (generation !== this.initGeneration) {
        return;
      }

      this.uiState.set('loading-session');
      const session = await this.alipayAdapter.createPaymentSession(
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
      await this.alipayAdapter.mountPaymentElement(
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
      const paymentError = normalizeError(err, { method: 'alipay', provider: 'alipay' });
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
      method: 'alipay',
      provider: 'alipay',
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
    return `${buildAlipaySessionKey(product, checkout)}|${toStripeElementsLocale(locale)}`;
  }
}
