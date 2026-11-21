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
import { AmazonPayAdapter } from '../../adapters/amazon-pay/amazon-pay.adapter';
import { buildAmazonPayRenderKey, AmazonPayUiState } from '../../adapters/amazon-pay/amazon-pay.types';
import { mapAmazonPayError } from '../../adapters/amazon-pay/amazon-pay-error.mapper';
import { CheckoutSecurityMessageComponent } from '../checkout/checkout-security-message.component';
import { formatMoney } from '../../utils/format-money';
import {
  EasyPaymentsI18nService,
  EN_TRANSLATIONS,
  interpolate,
  localizePaymentError,
  toStripeElementsLocale,
  type EasyPaymentsResolvedLocale,
} from '../../i18n';

@Component({
  selector: 'easy-amazon-pay-payment',
  standalone: true,
  imports: [CheckoutSecurityMessageComponent],
  template: `
    <div
      class="ep-amazon-pay"
      [class.ep-amazon-pay--compact]="compact()"
      [class.ep-amazon-pay--minimal]="chrome() === 'minimal'"
      [attr.data-state]="uiState()"
      [attr.data-chrome]="chrome()"
    >
      @if (!compact() && chrome() === 'full') {
        <div class="ep-amazon-pay__header">
          <h3 class="ep-amazon-pay__title">{{ msgs().payWithAmazonPay }}</h3>
          <easy-checkout-security-message [message]="msgs().secureCheckoutAmazonPay" />
        </div>
      } @else if (!compact() && chrome() === 'minimal') {
        <easy-checkout-security-message [message]="msgs().secureCheckoutAmazonPay" />
      }

      <!-- Compact strip: host owns loading/unavailable presentation. -->
      @if (uiState() === 'initializing' && !compact()) {
        <p class="ep-amazon-pay__status" role="status">{{ msgs().preparingAmazonPay }}</p>
      }

      @if (uiState() === 'unavailable' && !compact()) {
        <p class="ep-amazon-pay__status" role="status">
          {{ msgs().amazonPayUnavailable }}
        </p>
      }

      @if (uiState() === 'processing') {
        <p class="ep-amazon-pay__status" role="status">{{ msgs().processingAmazonPay }}</p>
      }

      <div
        #amazonPayButtonHost
        class="ep-amazon-pay__button"
        [class.ep-amazon-pay__button--busy]="isBusy()"
        [class.ep-amazon-pay__button--hidden]="
          uiState() === 'unavailable' ||
          uiState() === 'error' ||
          (uiState() === 'success' && chrome() === 'minimal')
        "
        [attr.aria-busy]="isBusy()"
        [attr.aria-label]="msgs().amazonPayCheckoutAria"
      ></div>

      @if (!compact() && chrome() === 'full') {
        <p class="ep-amazon-pay__amount" aria-live="polite">{{ totalLabel() }}</p>
      }

      @if (inlineError()) {
        <p class="ep-amazon-pay__error" role="alert">{{ inlineError() }}</p>
      }

      @if (uiState() === 'error') {
        <button type="button" class="ep-amazon-pay__retry" (click)="onRetryMount()">
          {{ msgs().errorTryAgain }}
        </button>
      }

      <!--
        Full Checkout may show an in-panel completion banner.
        Buttons Only (chrome=minimal) is event-driven — the host owns outcome UI.
      -->
      @if (uiState() === 'success' && !compact() && chrome() !== 'minimal') {
        <p class="ep-amazon-pay__success" role="status">{{ msgs().paymentCompleted }}</p>
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

      .ep-amazon-pay {
        display: flex;
        flex-direction: column;
        gap: 14px;
      }

      /* Rendered inside the payment methods grid: button only. */
      .ep-amazon-pay--compact {
        gap: 4px;
        width: 100%;
        align-items: center;
      }

      .ep-amazon-pay--compact .ep-amazon-pay__status,
      .ep-amazon-pay--compact .ep-amazon-pay__error {
        text-align: center;
        font-size: 12px;
        width: 100%;
      }

      /*
        Compact ECE host: ~44px official button, centered.
        Narrow (mobile) containers: full row width for tap comfort.
        Wider containers: capped width so Amazon Pay does not dominate the tile.
      */
      .ep-amazon-pay--compact .ep-amazon-pay__button {
        min-height: 44px;
        height: 44px;
        width: 100%;
        max-width: 100%;
        margin-inline: auto;
      }

      @container ep-checkout (min-width: 360px) {
        .ep-amazon-pay--compact .ep-amazon-pay__button {
          max-width: 168px;
        }
      }

      @container ep-checkout (min-width: 520px) {
        .ep-amazon-pay--compact .ep-amazon-pay__button {
          max-width: 152px;
        }
      }

      .ep-amazon-pay__header {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }

      .ep-amazon-pay__title {
        margin: 0;
        font-size: 1rem;
        font-weight: 650;
        color: var(--ep-text, #0f172a);
      }

      .ep-amazon-pay__status {
        margin: 0;
        font-size: 13px;
        color: var(--ep-text-secondary, #64748b);
      }

      .ep-amazon-pay__button {
        min-height: 44px;
        width: 100%;
      }

      .ep-amazon-pay__button--busy {
        pointer-events: none;
        opacity: 0.65;
      }

      .ep-amazon-pay__button--hidden {
        display: none;
      }

      .ep-amazon-pay__amount {
        margin: 0;
        font-size: 13px;
        color: var(--ep-text-secondary, #64748b);
      }

      .ep-amazon-pay__error {
        margin: 0;
        color: var(--ep-danger, #b91c1c);
        font-size: 13px;
      }

      .ep-amazon-pay__retry {
        align-self: flex-start;
        margin: 0;
        padding: 10px 16px;
        border: 1px solid var(--ep-border, #cbd5e1);
        border-radius: var(--ep-radius, 10px);
        background: var(--ep-surface, #ffffff);
        color: var(--ep-text, #0f172a);
        font: inherit;
        font-size: 14px;
        font-weight: 600;
        cursor: pointer;
      }

      .ep-amazon-pay__retry:hover {
        background: var(--ep-surface-hover, #f8fafc);
      }

      .ep-amazon-pay--compact .ep-amazon-pay__retry,
      .ep-amazon-pay--minimal .ep-amazon-pay__retry {
        align-self: center;
        font-size: 12px;
        padding: 8px 12px;
      }

      .ep-amazon-pay__success {
        margin: 0;
        color: var(--ep-success, #15803d);
        font-size: 13px;
        font-weight: 600;
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AmazonPayPaymentComponent implements AfterViewInit, OnDestroy {
  private readonly amazonPayAdapter = inject(AmazonPayAdapter);
  private readonly i18n = inject(EasyPaymentsI18nService, { optional: true });

  readonly msgs = computed(() => this.i18n?.messages() ?? EN_TRANSLATIONS);

  readonly product = input.required<PaymentProduct>();
  readonly checkout = input<CheckoutOptions>();
  readonly resolvedTheme = input.required<ResolvedPaymentTheme>();
  /** Button-only rendering for the express slot inside the payment methods list. */
  readonly compact = input(false);
  /**
   * `full` — Full Checkout panel (title, amount, optional success banner).
   * `minimal` — Buttons Only expanded panel (security + ECE; host owns outcome UI).
   */
  readonly chrome = input<'full' | 'minimal'>('full');
  /**
   * Shared Buttons Only grid corner radius in CSS pixels (`buttonsAppearance.borderRadius`).
   * Applied via Stripe Elements Appearance `variables.borderRadius`. Omitted keeps Stripe defaults.
   */
  readonly buttonBorderRadiusPx = input<number | null>(null);

  readonly success = output<PaymentResult>();
  readonly cancel = output<PaymentResult>();
  readonly error = output<PaymentError>();
  /** Fired when the wallet confirm event begins. Rendering the button does not fire it. */
  readonly started = output<void>();
  readonly busyChange = output<boolean>();

  private readonly host = viewChild.required<ElementRef<HTMLElement>>('amazonPayButtonHost');

  readonly uiState = signal<AmazonPayUiState>('idle');
  /** Preserved so locale switches re-localize without remounting or re-emitting. */
  private readonly lastErrorCode = signal<PaymentError['code'] | null>(null);
  readonly inlineError = computed(() => {
    const code = this.lastErrorCode();
    return code ? localizePaymentError(code, this.msgs()) : null;
  });

  private readonly viewReady = signal(false);
  private renderKey: string | null = null;
  private lastProductKey: string | null = null;
  private lastTheme: ResolvedPaymentTheme | null = null;
  private lastLocale: string | null = null;
  private renderGeneration = 0;
  private emittedSuccess = false;
  /** Ownership token for this host's ECE mount on the shared AmazonPayAdapter. */
  private eceMountId: string | null = null;

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
    effect(() => {
      const product = this.product();
      const checkout = this.checkout();
      const theme = this.resolvedTheme();
      const ready = this.viewReady();
      const locale = this.i18n?.effectiveLocale() ?? 'en';
      const borderRadiusPx = this.buttonBorderRadiusPx();
      if (!ready) {
        return;
      }
      untracked(() => {
        void this.ensureButton(product, checkout, theme, locale, borderRadiusPx);
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
    const mountId = this.eceMountId;
    this.eceMountId = null;
    // Ownership-scoped unmount — do not tear down sibling ECE mounts.
    // Keep the availability decided by `ready` so checkout tiles survive method switches.
    if (mountId) {
      this.amazonPayAdapter.unmountExpressCheckout({
        preserveAvailability: true,
        mountId,
      });
    }
  }

  isBusy(): boolean {
    const state = this.uiState();
    return (
      state === 'processing' ||
      state === 'success' ||
      (this.eceMountId !== null && this.amazonPayAdapter.isProcessing(this.eceMountId))
    );
  }

  /** Remount after SDK_LOAD_FAILED / ECE create failure without leaving the selected method. */
  async onRetryMount(): Promise<void> {
    if (this.uiState() !== 'error') {
      return;
    }
    this.renderKey = null;
    this.lastErrorCode.set(null);
    if (this.eceMountId) {
      this.amazonPayAdapter.unmountExpressCheckout({
        mountId: this.eceMountId,
      });
    }
    const product = this.product();
    const checkout = this.checkout();
    const theme = this.resolvedTheme();
    const locale = this.i18n?.effectiveLocale() ?? 'en';
    const borderRadiusPx = this.buttonBorderRadiusPx();
    await this.ensureButton(product, checkout, theme, locale, borderRadiusPx);
  }

  private async ensureButton(
    product: PaymentProduct,
    checkout: CheckoutOptions | undefined,
    theme: ResolvedPaymentTheme,
    locale: EasyPaymentsResolvedLocale,
    borderRadiusPx: number | null = null,
  ): Promise<void> {
    const validation = validatePaymentProduct(product);
    if (!validation.valid) {
      const paymentError = new PaymentError({
        code: 'PRODUCT_INVALID',
        message: validation.errors.join(' '),
        method: 'amazon-pay',
        provider: 'amazonPay',
      });
      this.uiState.set('error');
      this.lastErrorCode.set(paymentError.code);
      this.error.emit(paymentError);
      return;
    }

    const productKey = buildAmazonPayRenderKey(product);
    const elementsLocale = toStripeElementsLocale(locale);
    const radiusKey = borderRadiusPx == null ? 'default' : String(borderRadiusPx);
    const nextKey = `${productKey}|r:${radiusKey}`;
    const themeChanged = this.lastTheme !== theme;
    const localeChanged = this.lastLocale !== elementsLocale;
    const productChanged = this.lastProductKey !== productKey;

    // Settled success: update localized chrome via msgs(); do not remount or re-emit.
    if (this.emittedSuccess || this.uiState() === 'success') {
      if (!productChanged) {
        return;
      }
      // New catalog product = new checkout session.
      this.emittedSuccess = false;
    }

    if (
      nextKey === this.renderKey &&
      !themeChanged &&
      !localeChanged &&
      (this.uiState() === 'ready' || this.uiState() === 'error')
    ) {
      // Locale/theme unchanged: keep existing error (msgs() re-localizes via lastErrorCode).
      return;
    }

    // Locale-only change while an error is showing: refresh Stripe Elements locale without
    // clearing the alert or emitting another outcome.
    const preserveError = this.uiState() === 'error' && this.lastErrorCode() !== null && !productChanged;

    const generation = ++this.renderGeneration;
    this.renderKey = nextKey;
    this.lastProductKey = productKey;
    this.lastTheme = theme;
    this.lastLocale = elementsLocale;
    if (productChanged) {
      this.emittedSuccess = false;
    }
    // Availability was already proven by the bootstrap `ready`; don't fall back to
    // "Preparing Amazon Pay…" while the button re-renders in this panel.
    if (!preserveError) {
      this.uiState.set(
        this.amazonPayAdapter.getAvailabilityStatus(product) === 'available' ? 'ready' : 'initializing',
      );
      this.lastErrorCode.set(null);
    }

    try {
      // Mount the real ECE first — availability comes from ready, not a hidden probe.
      if (!this.amazonPayAdapter.isConfigured()) {
        this.uiState.set('unavailable');
        return;
      }

      const host = this.host().nativeElement;
      if (!this.eceMountId) {
        this.eceMountId = this.amazonPayAdapter.createMountId();
      }
      const mountId = await this.amazonPayAdapter.mountExpressCheckout(
        host,
        {
          product,
          checkout,
          theme,
          locale: elementsLocale,
          ...(borderRadiusPx != null ? { buttonBorderRadiusPx: borderRadiusPx } : {}),
          onSuccess: (result) => this.onPaymentSuccess(result, generation),
          onCancel: () => this.onPaymentCancel(generation),
          onError: (err) => this.onPaymentError(err, generation),
          onAttempt: () => {
            if (generation === this.renderGeneration && !this.emittedSuccess) {
              this.started.emit();
            }
          },
          onReady: () => {
            if (generation === this.renderGeneration) {
              if (preserveError) {
                this.uiState.set('error');
              } else {
                this.uiState.set('ready');
              }
            }
          },
          onUnavailable: () => {
            if (generation === this.renderGeneration) {
              this.uiState.set('unavailable');
            }
          },
        },
        this.eceMountId,
      );

      if (generation !== this.renderGeneration) {
        this.amazonPayAdapter.unmountExpressCheckout({
          preserveAvailability: true,
          mountId,
        });
        if (this.eceMountId === mountId) {
          this.eceMountId = null;
        }
        return;
      }

      this.eceMountId = mountId;

      // Stay initializing until ready fires (or unavailable/error).
      // Selector visibility stays config-based; panel readiness follows ECE state.
      if (preserveError) {
        this.uiState.set('error');
        return;
      }
      const status = this.amazonPayAdapter.getAvailabilityStatus(product);
      if (status === 'available') {
        this.uiState.set('ready');
      } else if (status === 'error') {
        this.uiState.set('error');
      } else if (status === 'unavailable') {
        this.uiState.set('unavailable');
      }
    } catch (err) {
      if (generation !== this.renderGeneration) {
        return;
      }
      this.renderKey = null;
      if (this.eceMountId) {
        this.amazonPayAdapter.unmountExpressCheckout({
          mountId: this.eceMountId,
        });
      }
      const paymentError = mapAmazonPayError(err, 'SDK_LOAD_FAILED', 'Failed to initialize Amazon Pay.');
      this.uiState.set('error');
      this.lastErrorCode.set(paymentError.code);
      if (!preserveError) {
        this.error.emit(paymentError);
      }
    }
  }

  private onPaymentSuccess(result: PaymentResult, generation: number): void {
    if (generation !== this.renderGeneration || this.emittedSuccess) {
      return;
    }
    this.emittedSuccess = true;
    this.lastErrorCode.set(null);
    this.uiState.set(result.status === 'processing' ? 'processing' : 'success');
    this.success.emit(result);
  }

  private onPaymentCancel(generation: number): void {
    if (generation !== this.renderGeneration || this.emittedSuccess) {
      return;
    }
    this.uiState.set('ready');
    this.cancel.emit({
      status: 'cancelled',
      method: 'amazon-pay',
      provider: 'amazonPay',
      message: 'Amazon Pay was cancelled.',
    });
  }

  private onPaymentError(err: PaymentError, generation: number): void {
    if (generation !== this.renderGeneration || this.emittedSuccess) {
      return;
    }
    const paymentError = normalizeError(err, { method: 'amazon-pay', provider: 'amazonPay' });
    if (paymentError.code === 'PAYMENT_CANCELLED') {
      this.onPaymentCancel(generation);
      return;
    }
    // Load / mount failures: no usable Stripe button — stay in error with Try again.
    // Confirm-time failures keep the button for another attempt (ready + inline alert).
    const isButtonUnusable =
      paymentError.code === 'SDK_LOAD_FAILED' ||
      paymentError.code === 'PROVIDER_UNAVAILABLE' ||
      paymentError.code === 'CONFIG_MISSING';
    this.uiState.set(isButtonUnusable ? 'error' : 'ready');
    this.lastErrorCode.set(paymentError.code);
    this.error.emit(paymentError);
  }
}
