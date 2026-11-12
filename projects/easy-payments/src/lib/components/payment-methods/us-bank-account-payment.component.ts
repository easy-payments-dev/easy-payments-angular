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
import { UsBankAccountAdapter } from '../../adapters/us-bank-account/us-bank-account.adapter';
import { logAchLifecycle } from '../../adapters/us-bank-account/us-bank-account-lifecycle';
import {
  clearAchReturnParamsFromUrl,
  isAchReturnAttempt,
  readAchReturnParams,
} from '../../adapters/us-bank-account/us-bank-account-return';
import {
  buildUsBankAccountSessionKey,
  UsBankAccountUiState,
} from '../../adapters/us-bank-account/us-bank-account.types';
import { createPaymentOwnerId } from '../../utils/payment-owner-id';
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

@Component({
  selector: 'easy-us-bank-account-payment',
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
      class="ep-ach"
      [class.ep-ach--minimal]="chrome() === 'minimal'"
      [attr.data-state]="uiState()"
      [attr.data-chrome]="chrome()"
    >
      @if (chrome() === 'full') {
        <div class="ep-ach__header">
          <h3 class="ep-ach__title">{{ msgs().payWithUsBankAccount }}</h3>
          <easy-checkout-security-message [message]="msgs().secureCheckoutUsBankAccount" />
        </div>
      } @else {
        <easy-checkout-security-message [message]="msgs().secureCheckoutUsBankAccount" />
      }

      @if (uiState() === 'initializing' || uiState() === 'loading-session') {
        <p class="ep-ach__status" role="status">{{ msgs().preparingUsBankAccount }}</p>
      }

      <div
        #paymentElementHost
        class="ep-ach__element"
        [class.ep-ach__element--pending]="
          uiState() === 'initializing' ||
          uiState() === 'loading-session' ||
          uiState() === 'pending' ||
          uiState() === 'success'
        "
        [attr.aria-hidden]="uiState() === 'error' || uiState() === 'idle'"
        [attr.aria-label]="msgs().usBankAccountFormAria"
      ></div>

      @if (inlineError()) {
        <p class="ep-ach__error" role="alert">{{ inlineError() }}</p>
      }

      <!--
        Full Checkout: in-panel pending/success copy.
        Buttons Only (chrome=minimal): keep the processing CTA until the host
        closes the panel after a verified pending/success emit.
      -->
      @if (uiState() === 'pending' && chrome() !== 'minimal') {
        <p class="ep-ach__pending" role="status">
          <span class="ep-ach__pending-title">{{ msgs().pendingTitle }}</span>
          <span class="ep-ach__pending-body">{{ msgs().pendingBody }}</span>
        </p>
      }

      @if (uiState() === 'success' && chrome() !== 'minimal') {
        <p class="ep-ach__success" role="status">{{ msgs().paymentCompleted }}</p>
      }

      <button
        type="button"
        class="ep-ach__pay"
        [disabled]="!canPay()"
        [attr.aria-busy]="showProcessingCta()"
        (click)="onPay()"
      >
        @if (showProcessingCta()) {
          {{ msgs().processingPayment }}
        } @else if (uiState() === 'pending') {
          {{ msgs().pendingTitle }}
        } @else if (uiState() === 'success' && chrome() !== 'minimal') {
          {{ msgs().paymentCompleted }}
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

      .ep-ach {
        display: flex;
        flex-direction: column;
        gap: 14px;
      }

      .ep-ach__header {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }

      .ep-ach__title {
        margin: 0;
        font-size: 1rem;
        font-weight: 650;
        color: var(--ep-text, #0f172a);
      }

      .ep-ach__status {
        margin: 0;
        font-size: 13px;
        color: var(--ep-text-secondary, #64748b);
      }

      .ep-ach__element {
        min-height: 48px;
        padding: 4px 0;
      }

      .ep-ach__element--pending {
        opacity: 0.45;
        pointer-events: none;
      }

      .ep-ach__error {
        margin: 0;
        color: var(--ep-danger, #b91c1c);
        font-size: 13px;
      }

      .ep-ach__pending {
        margin: 0;
        display: flex;
        flex-direction: column;
        gap: 4px;
        color: var(--ep-text, #0f172a);
        font-size: 13px;
      }

      .ep-ach__pending-title {
        font-weight: 650;
      }

      .ep-ach__pending-body {
        color: var(--ep-text-secondary, #64748b);
      }

      .ep-ach__success {
        margin: 0;
        color: var(--ep-success, #15803d);
        font-size: 13px;
        font-weight: 600;
      }

      .ep-ach__pay {
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

      .ep-ach__pay:hover:not(:disabled) {
        background: var(--ep-card-cta-hover-bg, var(--ep-cta-bg-hover, #1e293b));
        color: var(
          --ep-card-cta-hover-text,
          var(--ep-card-cta-text, var(--ep-cta-text, #f8fafc))
        );
      }

      .ep-ach__pay:active:not(:disabled) {
        background: var(--ep-card-cta-hover-bg, var(--ep-cta-bg-hover, #1e293b));
        box-shadow: inset 0 1px 0 color-mix(in srgb, #000 18%, transparent);
      }

      .ep-ach__pay:focus-visible {
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

      .ep-ach--minimal .ep-ach__pay {
        min-height: var(--ep-card-cta-min-height, 44px);
        align-self: flex-start;
        min-width: min(100%, 200px);
        padding: var(--ep-card-cta-padding, 0 20px);
        font-size: var(--ep-card-cta-font-size, 14px);
      }

      .ep-ach__pay:disabled {
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

      .ep-ach__pay[aria-busy='true']:disabled {
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
        .ep-ach__pay {
          transition: none;
        }
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UsBankAccountPaymentComponent implements AfterViewInit, OnDestroy {
  private readonly achAdapter = inject(UsBankAccountAdapter);
  private readonly i18n = inject(EasyPaymentsI18nService, { optional: true });
  private readonly ownerId = createPaymentOwnerId('us-bank-account');

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
   * Optional Easy Payments–owned ACH CTA presentation (same shape as Card).
   * Invalid / omitted fields keep theme defaults and localized labels.
   */
  readonly cardButtonAppearance = input<EasyPaymentsCardButtonAppearance | null>(null);

  readonly success = output<PaymentResult>();
  readonly cancel = output<PaymentResult>();
  readonly error = output<PaymentError>();
  readonly started = output<void>();
  readonly busyChange = output<boolean>();

  private readonly host = viewChild.required<ElementRef<HTMLElement>>('paymentElementHost');

  readonly uiState = signal<UsBankAccountUiState>('idle');
  readonly inlineError = signal<string | null>(null);

  private readonly viewReady = signal(false);

  private sessionKey: string | null = null;
  private lastClientSecret: string | null = null;
  private lastMountedLocale: string | null = null;
  private initGeneration = 0;
  private lastAppliedTheme: ResolvedPaymentTheme | null = null;
  private destroyed = false;
  /** Prevents duplicate success/pending emits if confirm resolves after reconcile. */
  private attemptSettled = false;
  private returnRecoveryStarted = false;

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
    const custom = this.resolvedCardButton().label;
    if (custom) {
      return custom;
    }
    return this.chrome() === 'minimal'
      ? this.msgs().payWithUsBankAccount
      : interpolate(this.msgs().payAmount, { amount: this.amountLabel() });
  });

  constructor() {
    effect(() => {
      const product = this.product();
      const checkout = this.checkout();
      const ready = this.viewReady();
      const locale = this.i18n?.effectiveLocale() ?? 'en';
      const chrome = this.chrome();
      if (!ready) {
        return;
      }
      untracked(() => {
        // Full Checkout recovers returns in-panel. Buttons Only (minimal) is host-owned.
        if (chrome === 'full' && isAchReturnAttempt()) {
          void this.recoverReturnIfNeeded();
          return;
        }
        void this.ensureSession(product, checkout, locale);
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
    void this.achAdapter.destroy(this.ownerId);
  }

  canPay(): boolean {
    return this.uiState() === 'ready' && !this.achAdapter.isConfirming(this.ownerId);
  }

  /**
   * Buttons Only keeps the processing CTA until the host closes the panel after
   * a verified pending/success. Full Checkout uses its own pending/success chrome.
   */
  showProcessingCta(): boolean {
    const state = this.uiState();
    if (state === 'processing') {
      return true;
    }
    return this.chrome() === 'minimal' && (state === 'pending' || state === 'success');
  }

  async onPay(): Promise<void> {
    if (!this.canPay()) {
      return;
    }

    this.attemptSettled = false;
    this.inlineError.set(null);
    this.uiState.set('processing');
    this.started.emit();
    this.busyChange.emit(true);

    try {
      const result = await this.achAdapter.confirmPayment(
        this.checkout()?.successUrl,
        this.ownerId,
      );
      if (this.destroyed) {
        return;
      }
      this.emitAttemptResult(result);
    } catch (err) {
      if (this.destroyed || this.attemptSettled) {
        return;
      }
      const paymentError = normalizeError(err, {
        method: 'us-bank-account',
        provider: 'usBankAccount',
      });
      if (paymentError.code === 'PAYMENT_CANCELLED') {
        this.attemptSettled = true;
        this.uiState.set('ready');
        this.cancel.emit({
          status: 'cancelled',
          method: 'us-bank-account',
          provider: 'usBankAccount',
          message: paymentError.message,
        });
        return;
      }

      this.attemptSettled = true;
      this.uiState.set('ready');
      this.inlineError.set(localizePaymentError(paymentError.code, this.msgs()));
      this.error.emit(paymentError);
    } finally {
      if (!this.destroyed) {
        this.busyChange.emit(false);
      }
    }
  }

  private emitAttemptResult(result: PaymentResult): void {
    if (this.attemptSettled || this.destroyed) {
      return;
    }
    this.attemptSettled = true;
    logAchLifecycle('attempt_emitted', {
      paymentIntentId: result.transactionId ?? null,
      status: result.status,
    });

    if (result.status === 'success') {
      this.uiState.set('success');
      this.success.emit(result);
      return;
    }
    if (result.status === 'processing') {
      // Exit loading into a settled pending state. Parent remaps to (pending).
      this.uiState.set('pending');
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
      method: 'us-bank-account',
      provider: 'usBankAccount',
    });
    this.inlineError.set(localizePaymentError(paymentError.code, this.msgs()));
    this.error.emit(paymentError);
  }

  /**
   * After a Stripe-hosted ACH next action, recover the SAME PaymentIntent via
   * retrieve only — never create or confirm a second payment.
   * Buttons Only (chrome=minimal) uses host-owned recovery instead.
   */
  private async recoverReturnIfNeeded(): Promise<void> {
    if (this.returnRecoveryStarted || this.destroyed || this.chrome() !== 'full') {
      return;
    }
    this.returnRecoveryStarted = true;
    this.attemptSettled = false;
    this.uiState.set('processing');
    this.busyChange.emit(true);

    try {
      const { clientSecret } = readAchReturnParams();
      clearAchReturnParamsFromUrl();
      if (!clientSecret) {
        throw new PaymentError({
          code: 'PAYMENT_FAILED',
          message: 'US bank account return could not be verified.',
          method: 'us-bank-account',
          provider: 'usBankAccount',
        });
      }
      const result = await this.achAdapter.recoverReturningPayment(clientSecret);
      if (this.destroyed) {
        return;
      }
      this.emitAttemptResult(result);
    } catch (err) {
      if (this.destroyed || this.attemptSettled) {
        return;
      }
      this.attemptSettled = true;
      const paymentError = normalizeError(err, {
        method: 'us-bank-account',
        provider: 'usBankAccount',
      });
      this.uiState.set('error');
      this.inlineError.set(localizePaymentError(paymentError.code, this.msgs()));
      this.error.emit(paymentError);
    } finally {
      if (!this.destroyed) {
        this.busyChange.emit(false);
      }
    }
  }

  private async applyTheme(theme: ResolvedPaymentTheme): Promise<void> {
    if (this.lastAppliedTheme === theme && this.achAdapter.hasMountedElement(this.ownerId)) {
      return;
    }
    this.lastAppliedTheme = theme;
    if (this.achAdapter.hasMountedElement(this.ownerId)) {
      await this.achAdapter.updateAppearance(theme, this.ownerId);
    }
  }

  private async ensureSession(
    product: PaymentProduct,
    checkout: CheckoutOptions | undefined,
    locale: EasyPaymentsResolvedLocale,
  ): Promise<void> {
    // Do not recreate a PaymentIntent after a verified pending/success attempt.
    if (this.uiState() === 'pending' || this.uiState() === 'success') {
      return;
    }

    const validation = validatePaymentProduct(product);
    if (!validation.valid) {
      const paymentError = new PaymentError({
        code: 'PRODUCT_INVALID',
        message: validation.errors.join(' '),
        method: 'us-bank-account',
        provider: 'usBankAccount',
      });
      this.uiState.set('error');
      this.inlineError.set(localizePaymentError(paymentError.code, this.msgs()));
      this.error.emit(paymentError);
      return;
    }

    const nextKey = buildUsBankAccountSessionKey(product, checkout);
    const elementsLocale = toStripeElementsLocale(locale);

    if (nextKey === this.sessionKey) {
      if (
        this.lastMountedLocale !== elementsLocale &&
        this.lastClientSecret &&
        this.achAdapter.hasMountedElement(this.ownerId)
      ) {
        const host = this.host().nativeElement;
        const theme = untracked(() => this.resolvedTheme());
        await this.achAdapter.mountPaymentElement(
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
      await this.achAdapter.ensureStripeLoaded();
      if (generation !== this.initGeneration) {
        return;
      }

      this.uiState.set('loading-session');
      const session = await this.achAdapter.createPaymentSession(product, checkout, this.ownerId);
      if (generation !== this.initGeneration) {
        return;
      }

      const host = this.host().nativeElement;
      const theme = untracked(() => this.resolvedTheme());
      this.lastClientSecret = session.clientSecret;
      await this.achAdapter.mountPaymentElement(
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
      const paymentError = normalizeError(err, {
        method: 'us-bank-account',
        provider: 'usBankAccount',
      });
      this.uiState.set('error');
      this.inlineError.set(localizePaymentError(paymentError.code, this.msgs()));
      this.error.emit(paymentError);
    }
  }
}
