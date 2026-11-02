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
import { KlarnaAdapter } from '../../adapters/klarna/klarna.adapter';
import { buildKlarnaSessionKey, KlarnaUiState } from '../../adapters/klarna/klarna.types';
import { isKlarnaReturnAttempt } from '../../adapters/klarna/klarna-return';
import { createPaymentOwnerId } from '../../utils/payment-owner-id';
import {
  buildStripeReturnUrl,
  clearStripePendingReturnFor,
  createStripeReturnAttemptId,
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
  toKlarnaPreferredLocale,
  toStripeElementsLocale,
  type EasyPaymentsResolvedLocale,
} from '../../i18n';
import { EasyPaymentsConfigService } from '../../config/easy-payments-config.service';
import { CheckoutSecurityMessageComponent } from '../checkout/checkout-security-message.component';

@Component({
  selector: 'easy-klarna-payment',
  standalone: true,
  imports: [CheckoutSecurityMessageComponent],
  template: `
    <div
      class="ep-klarna"
      [class.ep-klarna--minimal]="chrome() === 'minimal'"
      [attr.data-state]="uiState()"
      [attr.data-chrome]="chrome()"
    >
      @if (chrome() === 'full') {
        <div class="ep-klarna__header">
          <h3 class="ep-klarna__title">{{ msgs().payWithKlarna }}</h3>
          <easy-checkout-security-message [message]="msgs().secureCheckoutKlarna" />
        </div>
      } @else {
        <easy-checkout-security-message [message]="msgs().secureCheckoutKlarna" />
      }

      @if (uiState() === 'initializing' || uiState() === 'loading-session') {
        <p class="ep-klarna__status" role="status">{{ msgs().preparingKlarna }}</p>
      }

      <!--
        Keep the Stripe mount host always in the DOM and visible to layout.
        Toggling display:none on a mounted Stripe iframe causes severe browser jank.
      -->
      <div
        #paymentElementHost
        class="ep-klarna__element"
        [class.ep-klarna__element--pending]="
          uiState() === 'initializing' || uiState() === 'loading-session'
        "
        [attr.aria-hidden]="uiState() === 'error' || uiState() === 'idle'"
        [attr.aria-label]="msgs().klarnaFormAria"
      ></div>

      @if (inlineError()) {
        <p class="ep-klarna__error" role="alert">{{ inlineError() }}</p>
      }

      <!--
        Full Checkout may show an in-panel completion banner.
        Buttons Only (chrome=minimal) is event-driven — the host owns outcome UI.
      -->
      @if (uiState() === 'success' && chrome() !== 'minimal') {
        <p class="ep-klarna__success" role="status">{{ msgs().paymentCompleted }}</p>
      }

      <button
        type="button"
        class="ep-klarna__pay"
        [disabled]="!canPay()"
        [attr.aria-busy]="uiState() === 'processing'"
        (click)="onPay()"
      >
        @if (uiState() === 'processing') {
          {{ msgs().processingPayment }}
        } @else {
          {{ payLabel() }}
        }
      </button>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        width: 100%;
        font-family: var(--ep-font-family, inherit);
      }

      .ep-klarna {
        display: flex;
        flex-direction: column;
        gap: 14px;
      }

      .ep-klarna__header {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }

      .ep-klarna__title {
        margin: 0;
        font-size: 1rem;
        font-weight: 650;
        color: var(--ep-text, #0f172a);
      }

      .ep-klarna__status {
        margin: 0;
        font-size: 13px;
        color: var(--ep-text-secondary, #64748b);
      }

      .ep-klarna__element {
        min-height: 48px;
        padding: 4px 0;
      }

      .ep-klarna__element--pending {
        opacity: 0.45;
        pointer-events: none;
      }

      .ep-klarna__error {
        margin: 0;
        color: var(--ep-danger, #b91c1c);
        font-size: 13px;
      }

      .ep-klarna__success {
        margin: 0;
        color: var(--ep-success, #15803d);
        font-size: 13px;
        font-weight: 600;
      }

      .ep-klarna__pay {
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

      .ep-klarna__pay:hover:not(:disabled) {
        background: var(--ep-cta-bg-hover, #1e293b);
      }

      .ep-klarna__pay:focus-visible {
        outline: 2px solid var(--ep-focus, #2563eb);
        outline-offset: 2px;
        box-shadow: 0 0 0 4px color-mix(in srgb, var(--ep-focus, #2563eb) 28%, transparent);
      }

      .ep-klarna--minimal .ep-klarna__pay {
        min-height: 44px;
        align-self: flex-start;
        min-width: min(100%, 200px);
        padding: 0 20px;
        font-size: 14px;
      }

      .ep-klarna__pay:disabled {
        opacity: 0.55;
        cursor: not-allowed;
      }

      @media (prefers-reduced-motion: reduce) {
        .ep-klarna__pay {
          transition: none;
        }
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class KlarnaPaymentComponent implements AfterViewInit, OnDestroy {
  private readonly klarnaAdapter = inject(KlarnaAdapter);
  private readonly confirmationGate = inject(StripeConfirmationGate);
  private readonly configService = inject(EasyPaymentsConfigService);
  private readonly i18n = inject(EasyPaymentsI18nService, { optional: true });
  private readonly hostContext = inject(CheckoutHostContext, { optional: true });
  /** This panel's Payment Element session on the shared KlarnaAdapter. */
  private readonly ownerId = createPaymentOwnerId('klarna');

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
  /** Fired once when the customer submits Klarna. Redirect recovery does not fire it again. */
  readonly started = output<void>();
  /** True while confirmPayment / redirect is in progress — parent should lock method switching. */
  readonly busyChange = output<boolean>();
  /**
   * True while recovering a Stripe Klarna redirect return (parent should show
   * Processing payment… and must not flash fresh checkout).
   */
  readonly returning = output<boolean>();

  private readonly host = viewChild.required<ElementRef<HTMLElement>>('paymentElementHost');

  readonly uiState = signal<KlarnaUiState>('idle');
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
      ? interpolate(this.msgs().continueToMethod, { method: 'Klarna' })
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
    void this.klarnaAdapter.destroy(this.ownerId);
  }

  canPay(): boolean {
    return this.uiState() === 'ready' && !this.klarnaAdapter.isConfirming(this.ownerId);
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
          'klarna',
          this.product().id,
          undefined,
          this.hostContext?.describeReturnOrigin(attemptId) ?? { attemptId },
        );
      }
      const returnUrl = buildStripeReturnUrl(
        'klarna',
        this.checkout()?.successUrl,
        undefined,
        attemptId,
      );
      const result = await this.klarnaAdapter.confirmPayment(returnUrl, this.ownerId);

      // If Klarna redirected, this page unloads and confirmPayment never settles here.
      clearStripePendingReturnFor(attemptId);
      this.emitTerminal(result);
    } catch (err) {
      clearStripePendingReturnFor(attemptId);
      const paymentError = normalizeError(err, { method: 'klarna', provider: 'klarna' });
      if (paymentError.code === 'PAYMENT_CANCELLED') {
        this.emitTerminal({
          status: 'cancelled',
          method: 'klarna',
          provider: 'klarna',
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
    if (this.lastAppliedTheme === theme && this.klarnaAdapter.hasMountedElement(this.ownerId)) {
      return;
    }
    this.lastAppliedTheme = theme;
    if (this.klarnaAdapter.hasMountedElement(this.ownerId)) {
      await this.klarnaAdapter.updateAppearance(theme, this.ownerId);
    }
  }

  /** Host-decided return phase; standalone panels fall back to URL detection. */
  private resolveReturnPhase(): StripeReturnPhase {
    if (this.hostContext) {
      return this.hostContext.returnPhaseFor('klarna');
    }
    return isKlarnaReturnAttempt() ? 'owner' : 'none';
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
        method: 'klarna',
        provider: 'klarna',
      });
      this.uiState.set('error');
      this.inlineError.set(localizePaymentError(paymentError.code, this.msgs()));
      this.emitErrorOnce(paymentError);
      return;
    }

    // Redirect return is recovered by the owning host. While it is pending or owned,
    // never create a new PaymentIntent; resume normally once the host releases it.
    if (returnPhase !== 'none') {
      this.initGeneration += 1;
      this.sessionKey = null;
      this.uiState.set('processing');
      return;
    }

    const preferredLocale = this.resolvePreferredLocale(locale);
    const nextKey = this.buildSessionKey(product, checkout, locale);
    const elementsLocale = toStripeElementsLocale(locale);

    // Same checkout identity (including in-flight): never create another PaymentIntent.
    if (nextKey === this.sessionKey) {
      if (
        this.lastMountedLocale !== elementsLocale &&
        this.lastClientSecret &&
        this.klarnaAdapter.hasMountedElement(this.ownerId)
      ) {
        const host = this.host().nativeElement;
        const theme = untracked(() => this.resolvedTheme());
        await this.klarnaAdapter.mountPaymentElement(
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
      await this.klarnaAdapter.ensureStripeLoaded();
      if (generation !== this.initGeneration) {
        return;
      }

      this.uiState.set('loading-session');
      const session = await this.klarnaAdapter.createPaymentSession(
        product,
        checkout,
        preferredLocale,
        this.ownerId,
      );
      if (generation !== this.initGeneration) {
        return;
      }

      const host = this.host().nativeElement;
      const theme = untracked(() => this.resolvedTheme());
      this.lastClientSecret = session.clientSecret;
      await this.klarnaAdapter.mountPaymentElement(
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
      const paymentError = normalizeError(err, { method: 'klarna', provider: 'klarna' });
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
      // Host maps this to the optional `pending` output; panel stays locked.
      this.uiState.set('processing');
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
      method: 'klarna',
      provider: 'klarna',
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

  private resolvePreferredLocale(locale: EasyPaymentsResolvedLocale): string {
    const klarna = this.configService.getSnapshot().providers?.klarna;
    const configured = klarna?.locale?.trim();
    if (configured) {
      return configured;
    }
    return toKlarnaPreferredLocale(locale, klarna?.purchaseCountry ?? 'US');
  }

  private buildSessionKey(
    product: PaymentProduct,
    checkout: CheckoutOptions | undefined,
    locale: EasyPaymentsResolvedLocale,
  ): string {
    return `${buildKlarnaSessionKey(product, checkout)}|${this.resolvePreferredLocale(locale)}`;
  }
}
