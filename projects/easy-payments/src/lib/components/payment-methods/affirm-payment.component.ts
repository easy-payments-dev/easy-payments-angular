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
import { AffirmAdapter } from '../../adapters/affirm/affirm.adapter';
import { buildAffirmSessionKey, AffirmUiState } from '../../adapters/affirm/affirm.types';
import {
  buildStripeReturnUrl,
  clearStripePendingReturnFor,
  createStripeReturnAttemptId,
  isStripeReturnAttempt,
  markStripePendingReturn,
} from '../../adapters/stripe/stripe-redirect-return';
import { StripeConfirmationGate } from '../../adapters/stripe/stripe-confirmation-gate';
import { createPaymentOwnerId } from '../../utils/payment-owner-id';
import { CheckoutHostContext, type StripeReturnPhase } from '../../services/checkout-host-context';
import { formatMoney } from '../../utils/format-money';
import {
  EasyPaymentsI18nService,
  EN_TRANSLATIONS,
  interpolate,
  localizePaymentError,
  toAffirmPreferredLocale,
  toStripeElementsLocale,
  type EasyPaymentsResolvedLocale,
} from '../../i18n';
import { EasyPaymentsConfigService } from '../../config/easy-payments-config.service';
import { CheckoutSecurityMessageComponent } from '../checkout/checkout-security-message.component';

@Component({
  selector: 'easy-affirm-payment',
  standalone: true,
  imports: [CheckoutSecurityMessageComponent],
  template: `
    <div class="ep-affirm" [attr.data-state]="uiState()">
      <div class="ep-affirm__header">
        <h3 class="ep-affirm__title">{{ msgs().payWithAffirm }}</h3>
        <easy-checkout-security-message [message]="msgs().secureCheckoutAffirm" />
      </div>

      @if (uiState() === 'initializing' || uiState() === 'loading-session') {
        <p class="ep-affirm__status" role="status">{{ msgs().preparingAffirm }}</p>
      }

      <!--
        Keep the Stripe mount host always in the DOM and visible to layout.
        Toggling display:none on a mounted Stripe iframe causes severe browser jank.
      -->
      <div
        #paymentElementHost
        class="ep-affirm__element"
        [class.ep-affirm__element--pending]="
          uiState() === 'initializing' || uiState() === 'loading-session'
        "
        [attr.aria-hidden]="uiState() === 'error' || uiState() === 'idle'"
        [attr.aria-label]="msgs().affirmFormAria"
      ></div>

      @if (inlineError()) {
        <p class="ep-affirm__error" role="alert">{{ inlineError() }}</p>
      }

      @if (uiState() === 'success') {
        <p class="ep-affirm__success" role="status">{{ msgs().paymentCompleted }}</p>
      }

      <button
        type="button"
        class="ep-affirm__pay"
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

      .ep-affirm {
        display: flex;
        flex-direction: column;
        gap: 14px;
      }

      .ep-affirm__header {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }

      .ep-affirm__title {
        margin: 0;
        font-size: 1rem;
        font-weight: 650;
        color: var(--ep-text, #0f172a);
      }

      .ep-affirm__status {
        margin: 0;
        font-size: 13px;
        color: var(--ep-text-secondary, #64748b);
      }

      .ep-affirm__element {
        min-height: 48px;
        padding: 4px 0;
      }

      .ep-affirm__element--pending {
        opacity: 0.45;
        pointer-events: none;
      }

      .ep-affirm__error {
        margin: 0;
        color: var(--ep-danger, #b91c1c);
        font-size: 13px;
      }

      .ep-affirm__success {
        margin: 0;
        color: var(--ep-success, #15803d);
        font-size: 13px;
        font-weight: 600;
      }

      .ep-affirm__pay {
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

      .ep-affirm__pay:hover:not(:disabled) {
        background: var(--ep-cta-bg-hover, #1e293b);
      }

      .ep-affirm__pay:focus-visible {
        outline: 2px solid var(--ep-focus, #2563eb);
        outline-offset: 2px;
      }

      .ep-affirm__pay:disabled {
        opacity: 0.55;
        cursor: not-allowed;
      }

      @media (prefers-reduced-motion: reduce) {
        .ep-affirm__pay {
          transition: none;
        }
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AffirmPaymentComponent implements AfterViewInit, OnDestroy {
  private readonly affirmAdapter = inject(AffirmAdapter);
  private readonly confirmationGate = inject(StripeConfirmationGate);
  private readonly configService = inject(EasyPaymentsConfigService);
  private readonly i18n = inject(EasyPaymentsI18nService, { optional: true });
  private readonly hostContext = inject(CheckoutHostContext, { optional: true });
  /** This panel's Payment Element session on the shared AffirmAdapter. */
  private readonly ownerId = createPaymentOwnerId('affirm');

  readonly msgs = computed(() => this.i18n?.messages() ?? EN_TRANSLATIONS);

  readonly product = input.required<PaymentProduct>();
  readonly checkout = input<CheckoutOptions>();
  readonly resolvedTheme = input.required<ResolvedPaymentTheme>();

  readonly success = output<PaymentResult>();
  readonly cancel = output<PaymentResult>();
  readonly error = output<PaymentError>();
  /** Fired once when the customer submits Affirm. Redirect recovery does not fire it again. */
  readonly started = output<void>();
  /** True while confirmPayment / redirect is in progress — parent should lock method switching. */
  readonly busyChange = output<boolean>();
  /**
   * True while recovering a Stripe Affirm redirect return (parent should show
   * Processing payment… and must not flash fresh checkout).
   */
  readonly returning = output<boolean>();

  private readonly host = viewChild.required<ElementRef<HTMLElement>>('paymentElementHost');

  readonly uiState = signal<AffirmUiState>('idle');
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
    interpolate(this.msgs().payAmount, { amount: this.amountLabel() }),
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
    void this.affirmAdapter.destroy(this.ownerId);
  }

  canPay(): boolean {
    return this.uiState() === 'ready' && !this.affirmAdapter.isConfirming(this.ownerId);
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
          'affirm',
          this.product().id,
          undefined,
          this.hostContext?.describeReturnOrigin(attemptId) ?? { attemptId },
        );
      }
      const returnUrl = buildStripeReturnUrl(
        'affirm',
        this.checkout()?.successUrl,
        undefined,
        attemptId,
      );
      const result = await this.affirmAdapter.confirmPayment(returnUrl, this.ownerId);

      // If Affirm redirected, this page unloads and confirmPayment never settles here.
      clearStripePendingReturnFor(attemptId);
      this.emitTerminal(result);
    } catch (err) {
      clearStripePendingReturnFor(attemptId);
      const paymentError = normalizeError(err, { method: 'affirm', provider: 'affirm' });
      if (paymentError.code === 'PAYMENT_CANCELLED') {
        this.emitTerminal({
          status: 'cancelled',
          method: 'affirm',
          provider: 'affirm',
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
    if (this.lastAppliedTheme === theme && this.affirmAdapter.hasMountedElement(this.ownerId)) {
      return;
    }
    this.lastAppliedTheme = theme;
    if (this.affirmAdapter.hasMountedElement(this.ownerId)) {
      await this.affirmAdapter.updateAppearance(theme, this.ownerId);
    }
  }

  /** Host-decided return phase; standalone panels fall back to URL detection. */
  private resolveReturnPhase(): StripeReturnPhase {
    if (this.hostContext) {
      return this.hostContext.returnPhaseFor('affirm');
    }
    return isStripeReturnAttempt('affirm') ? 'owner' : 'none';
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
        method: 'affirm',
        provider: 'affirm',
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
        this.affirmAdapter.hasMountedElement(this.ownerId)
      ) {
        const host = this.host().nativeElement;
        const theme = untracked(() => this.resolvedTheme());
        await this.affirmAdapter.mountPaymentElement(
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
      await this.affirmAdapter.ensureStripeLoaded();
      if (generation !== this.initGeneration) {
        return;
      }

      this.uiState.set('loading-session');
      const session = await this.affirmAdapter.createPaymentSession(
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
      await this.affirmAdapter.mountPaymentElement(
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
      const paymentError = normalizeError(err, { method: 'affirm', provider: 'affirm' });
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
      method: 'affirm',
      provider: 'affirm',
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
    const affirm = this.configService.getSnapshot().providers?.affirm;
    const configured = affirm?.locale?.trim();
    if (configured) {
      return configured;
    }
    return toAffirmPreferredLocale(locale, affirm?.purchaseCountry ?? 'US');
  }

  private buildSessionKey(
    product: PaymentProduct,
    checkout: CheckoutOptions | undefined,
    locale: EasyPaymentsResolvedLocale,
  ): string {
    return `${buildAffirmSessionKey(product, checkout)}|${this.resolvePreferredLocale(locale)}`;
  }
}
