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
import { CheckoutSecurityMessageComponent } from '../checkout/checkout-security-message.component';

@Component({
  selector: 'easy-us-bank-account-payment',
  standalone: true,
  imports: [CheckoutSecurityMessageComponent],
  template: `
    <div class="ep-ach" [attr.data-state]="uiState()">
      <div class="ep-ach__header">
        <h3 class="ep-ach__title">{{ msgs().payWithUsBankAccount }}</h3>
        <easy-checkout-security-message [message]="msgs().secureCheckoutUsBankAccount" />
      </div>

      @if (uiState() === 'initializing' || uiState() === 'loading-session') {
        <p class="ep-ach__status" role="status">{{ msgs().preparingUsBankAccount }}</p>
      }

      <div
        #paymentElementHost
        class="ep-ach__element"
        [class.ep-ach__element--pending]="
          uiState() === 'initializing' || uiState() === 'loading-session'
        "
        [attr.aria-hidden]="uiState() === 'error' || uiState() === 'idle'"
        [attr.aria-label]="msgs().usBankAccountFormAria"
      ></div>

      @if (inlineError()) {
        <p class="ep-ach__error" role="alert">{{ inlineError() }}</p>
      }

      @if (uiState() === 'success') {
        <p class="ep-ach__success" role="status">{{ msgs().paymentCompleted }}</p>
      }

      <button
        type="button"
        class="ep-ach__pay"
        [disabled]="!canPay()"
        [attr.aria-busy]="uiState() === 'processing'"
        (click)="onPay()"
      >
        @if (uiState() === 'processing') {
          {{ msgs().processingPayment }}
        } @else if (uiState() === 'success') {
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

      .ep-ach__success {
        margin: 0;
        color: var(--ep-success, #15803d);
        font-size: 13px;
        font-weight: 600;
      }

      .ep-ach__pay {
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

      .ep-ach__pay:hover:not(:disabled) {
        background: var(--ep-cta-bg-hover, #1e293b);
      }

      .ep-ach__pay:focus-visible {
        outline: 2px solid var(--ep-focus, #2563eb);
        outline-offset: 2px;
        box-shadow: 0 0 0 4px color-mix(in srgb, var(--ep-focus, #2563eb) 28%, transparent);
      }

      .ep-ach__pay:disabled {
        opacity: 0.55;
        cursor: not-allowed;
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
    effect(() => {
      const product = this.product();
      const checkout = this.checkout();
      const ready = this.viewReady();
      const locale = this.i18n?.effectiveLocale() ?? 'en';
      if (!ready) {
        return;
      }
      untracked(() => {
        if (isAchReturnAttempt()) {
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
      // Parent remaps processing → pending (or status-check). Never emit as success alone.
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
      method: 'us-bank-account',
      provider: 'usBankAccount',
    });
    this.inlineError.set(localizePaymentError(paymentError.code, this.msgs()));
    this.error.emit(paymentError);
  }

  /**
   * After a Stripe-hosted ACH next action, recover the SAME PaymentIntent via
   * retrieve only — never create or confirm a second payment.
   */
  private async recoverReturnIfNeeded(): Promise<void> {
    if (this.returnRecoveryStarted || this.destroyed) {
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
