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
import { GooglePayAdapter } from '../../adapters/google-pay/google-pay.adapter';
import { createPaymentOwnerId } from '../../utils/payment-owner-id';
import { buildGooglePayRenderKey, GooglePayUiState } from '../../adapters/google-pay/google-pay.types';
import { mapGooglePayError } from '../../adapters/google-pay/google-pay-error.mapper';
import { CheckoutSecurityMessageComponent } from '../checkout/checkout-security-message.component';
import { formatMoney } from '../../utils/format-money';
import {
  EasyPaymentsI18nService,
  EN_TRANSLATIONS,
  interpolate,
  localizePaymentError,
  toGooglePayButtonLocale,
  type EasyPaymentsResolvedLocale,
} from '../../i18n';

@Component({
  selector: 'easy-google-pay-payment',
  standalone: true,
  imports: [CheckoutSecurityMessageComponent],
  template: `
    <div class="ep-gpay" [class.ep-gpay--compact]="compact()" [attr.data-state]="uiState()">
      @if (!compact()) {
        <div class="ep-gpay__header">
          <h3 class="ep-gpay__title">{{ msgs().payWithGooglePay }}</h3>
          <easy-checkout-security-message [message]="msgs().secureCheckoutGooglePay" />
        </div>
      }

      @if (uiState() === 'initializing') {
        <p class="ep-gpay__status" role="status">{{ msgs().preparingGooglePay }}</p>
      }

      @if (uiState() === 'unavailable') {
        <p class="ep-gpay__status" role="status">
          {{ msgs().googlePayUnavailable }}
        </p>
      }

      @if (uiState() === 'creating-session' && !compact()) {
        <p class="ep-gpay__status" role="status">{{ msgs().preparingSecurePayment }}</p>
      }

      @if (uiState() === 'awaiting-sheet' && !compact()) {
        <p class="ep-gpay__status" role="status">{{ msgs().waitingGooglePay }}</p>
      }

      @if (uiState() === 'processing' && !compact()) {
        <p class="ep-gpay__status" role="status">{{ msgs().processingGooglePay }}</p>
      }

      <div
        #googlePayButtonHost
        class="ep-gpay__button"
        [class.ep-gpay__button--busy]="isBusy()"
        [class.ep-gpay__button--hidden]="uiState() === 'unavailable'"
        [attr.aria-busy]="isBusy()"
        [attr.aria-label]="msgs().googlePayCheckoutAria"
      ></div>

      @if (!compact()) {
        <p class="ep-gpay__amount" aria-live="polite">{{ totalLabel() }}</p>
      }

      @if (inlineError()) {
        <p class="ep-gpay__error" role="alert">{{ inlineError() }}</p>
      }

      @if (uiState() === 'success' && !compact()) {
        <p class="ep-gpay__success" role="status">{{ msgs().paymentCompleted }}</p>
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

      .ep-gpay {
        display: flex;
        flex-direction: column;
        gap: 14px;
      }

      .ep-gpay--compact {
        gap: 8px;
      }

      .ep-gpay__header {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }

      .ep-gpay__title {
        margin: 0;
        font-size: 1rem;
        font-weight: 650;
        color: var(--ep-text, #0f172a);
      }

      .ep-gpay__status {
        margin: 0;
        font-size: 13px;
        color: var(--ep-text-secondary, #64748b);
      }

      .ep-gpay--compact .ep-gpay__status,
      .ep-gpay--compact .ep-gpay__error {
        font-size: 12px;
      }

      .ep-gpay__button {
        min-height: 48px;
        width: 100%;
      }

      .ep-gpay--compact .ep-gpay__button {
        min-height: 40px;
        height: 40px;
        display: flex;
        align-items: center;
      }

      .ep-gpay--compact .ep-gpay__button > * {
        width: 100%;
        max-width: 100%;
      }

      .ep-gpay__button--busy {
        pointer-events: none;
        opacity: 0.65;
      }

      .ep-gpay__button--hidden {
        display: none;
      }

      .ep-gpay__amount {
        margin: 0;
        font-size: 13px;
        color: var(--ep-text-secondary, #64748b);
      }

      .ep-gpay__error {
        margin: 0;
        color: var(--ep-danger, #b91c1c);
        font-size: 13px;
      }

      .ep-gpay__success {
        margin: 0;
        color: var(--ep-success, #15803d);
        font-size: 13px;
        font-weight: 600;
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GooglePayPaymentComponent implements AfterViewInit, OnDestroy {
  private readonly googlePayAdapter = inject(GooglePayAdapter);
  private readonly i18n = inject(EasyPaymentsI18nService, { optional: true });

  readonly msgs = computed(() => this.i18n?.messages() ?? EN_TRANSLATIONS);

  readonly product = input.required<PaymentProduct>();
  readonly checkout = input<CheckoutOptions>();
  readonly resolvedTheme = input.required<ResolvedPaymentTheme>();
  /**
   * Compact in-list / Payment Buttons Only mount: official Google Pay button without
   * checkout panel chrome (title, security blurb, amount row, verbose status).
   */
  readonly compact = input(false);

  readonly success = output<PaymentResult>();
  readonly cancel = output<PaymentResult>();
  readonly error = output<PaymentError>();
  /** Fired once when the customer clicks the Google Pay button. */
  readonly started = output<void>();
  /** True while sheet/confirm is in progress — parent should lock method switching. */
  readonly busyChange = output<boolean>();

  private readonly host = viewChild.required<ElementRef<HTMLElement>>('googlePayButtonHost');

  readonly uiState = signal<GooglePayUiState>('idle');
  readonly inlineError = signal<string | null>(null);

  private readonly viewReady = signal(false);
  private renderKey: string | null = null;
  private lastTheme: ResolvedPaymentTheme | null = null;
  private lastButtonLocale: string | null = null;
  private renderGeneration = 0;
  /** Ownership token for this host's button mount on the shared GooglePayAdapter. */
  private buttonMountId: string | null = null;
  /** Ownership token for this host's in-flight Google Pay attempt. */
  private readonly payOwnerId = createPaymentOwnerId('google-pay');

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
  readonly totalLabel = computed(() =>
    interpolate(this.msgs().totalAmount, { amount: this.amountLabel() }),
  );

  constructor() {
    // Product identity may require re-checking readiness / rebuilding the button.
    // Theme only restyles the official button — never creates PaymentIntents.
    effect(() => {
      const product = this.product();
      const checkout = this.checkout();
      const theme = this.resolvedTheme();
      const locale = this.i18n?.effectiveLocale() ?? 'en';
      const compact = this.compact();
      const ready = this.viewReady();
      if (!ready) {
        return;
      }
      untracked(() => {
        void this.ensureButton(product, checkout, theme, locale, compact);
      });
    });

    effect(() => {
      const busy = this.isBusy();
      untracked(() => this.busyChange.emit(busy));
    });
  }

  ngAfterViewInit(): void {
    this.viewReady.set(true);
  }

  ngOnDestroy(): void {
    this.renderGeneration += 1;
    this.renderKey = null;
    const mountId = this.buttonMountId;
    this.buttonMountId = null;
    // Ownership-scoped cleanup only — do not call adapter.destroy(), which would
    // clear sibling Google Pay mounts and the shared processing flag.
    if (mountId) {
      this.googlePayAdapter.destroyButtonMount(mountId);
    }
  }

  isBusy(): boolean {
    const state = this.uiState();
    return (
      state === 'creating-session' ||
      state === 'awaiting-sheet' ||
      state === 'processing' ||
      this.googlePayAdapter.isProcessing(this.payOwnerId)
    );
  }

  private async ensureButton(
    product: PaymentProduct,
    checkout: CheckoutOptions | undefined,
    theme: ResolvedPaymentTheme,
    locale: EasyPaymentsResolvedLocale,
    compact = false,
  ): Promise<void> {
    const validation = validatePaymentProduct(product);
    if (!validation.valid) {
      const paymentError = new PaymentError({
        code: 'PRODUCT_INVALID',
        message: validation.errors.join(' '),
        method: 'google-pay',
        provider: 'googlePay',
      });
      this.uiState.set('error');
      this.inlineError.set(localizePaymentError(paymentError.code, this.msgs()));
      this.error.emit(paymentError);
      return;
    }

    const buttonLocale = toGooglePayButtonLocale(locale);
    const nextKey = `${buildGooglePayRenderKey(product)}|${buttonLocale}|compact:${compact ? 1 : 0}`;
    const themeChanged = this.lastTheme !== theme;
    const localeChanged = this.lastButtonLocale !== buttonLocale;
    if (nextKey === this.renderKey && !themeChanged && !localeChanged && this.uiState() === 'ready') {
      return;
    }

    const generation = ++this.renderGeneration;
    this.renderKey = nextKey;
    this.lastTheme = theme;
    this.lastButtonLocale = buttonLocale;
    this.uiState.set('initializing');
    this.inlineError.set(null);

    try {
      const available = await this.googlePayAdapter.isAvailable({
        product,
        theme,
        checkout,
      });
      if (generation !== this.renderGeneration) {
        return;
      }

      if (!available) {
        this.uiState.set('unavailable');
        if (this.buttonMountId) {
          this.googlePayAdapter.destroyButtonMount(this.buttonMountId);
          this.buttonMountId = null;
        }
        return;
      }

      const host = this.host().nativeElement;
      const mountId = await this.googlePayAdapter.renderOfficialButton(
        host,
        {
          theme,
          buttonLocale,
          compact,
          onClick: () => this.onGooglePayClick(product, checkout, generation),
        },
        this.buttonMountId ?? undefined,
      );

      if (generation !== this.renderGeneration) {
        this.googlePayAdapter.destroyButtonMount(mountId);
        if (this.buttonMountId === mountId) {
          this.buttonMountId = null;
        }
        return;
      }

      this.buttonMountId = mountId;
      this.uiState.set('ready');
    } catch (err) {
      if (generation !== this.renderGeneration) {
        return;
      }
      this.renderKey = null;
      const paymentError = mapGooglePayError(err, 'SDK_LOAD_FAILED', 'Failed to initialize Google Pay.');
      this.uiState.set('error');
      this.inlineError.set(localizePaymentError(paymentError.code, this.msgs()));
      this.error.emit(paymentError);
    }
  }

  private async onGooglePayClick(
    product: PaymentProduct,
    checkout: CheckoutOptions | undefined,
    generation: number,
  ): Promise<void> {
    if (generation !== this.renderGeneration || this.isBusy() || this.uiState() === 'success') {
      return;
    }

    this.inlineError.set(null);
    this.started.emit();
    this.uiState.set('creating-session');

    try {
      // Intermediate UI while PaymentIntent is created, then sheet opens.
      this.uiState.set('awaiting-sheet');
      const result = await this.googlePayAdapter.payWithGooglePay(
        product,
        checkout,
        this.payOwnerId,
      );
      if (generation !== this.renderGeneration) {
        return;
      }

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

      const paymentError = new PaymentError({
        code: 'PAYMENT_FAILED',
        message: result.message ?? 'Google Pay payment failed.',
        method: 'google-pay',
        provider: 'googlePay',
      });
      this.uiState.set('ready');
      this.inlineError.set(localizePaymentError(paymentError.code, this.msgs()));
      this.error.emit(paymentError);
    } catch (err) {
      if (generation !== this.renderGeneration) {
        return;
      }

      const paymentError = normalizeError(err, { method: 'google-pay', provider: 'googlePay' });
      if (paymentError.code === 'PAYMENT_CANCELLED') {
        this.uiState.set('ready');
        this.cancel.emit({
          status: 'cancelled',
          method: 'google-pay',
          provider: 'googlePay',
          message: paymentError.message,
        });
        return;
      }

      this.uiState.set('ready');
      this.inlineError.set(localizePaymentError(paymentError.code, this.msgs()));
      this.error.emit(paymentError);
    }
  }
}
