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
import { StripeCardAdapter } from '../../adapters/stripe/stripe-card.adapter';
import { createPaymentOwnerId } from '../../utils/payment-owner-id';
import { buildStripeSessionKey } from '../../adapters/stripe/stripe-appearance';
import { StripeCardUiState } from '../../adapters/stripe/stripe.types';
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
  selector: 'easy-stripe-card-payment',
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
      class="ep-stripe-card"
      [class.ep-stripe-card--minimal]="chrome() === 'minimal'"
      [attr.data-state]="uiState()"
      [attr.data-chrome]="chrome()"
    >
      @if (chrome() === 'full') {
        <div class="ep-stripe-card__header">
          <h3 class="ep-stripe-card__title">{{ msgs().payWithCard }}</h3>
          <easy-checkout-security-message [message]="msgs().secureCardPaymentStripe" />
        </div>
      } @else {
        <easy-checkout-security-message [message]="msgs().secureCardPaymentStripe" />
      }

      @if (uiState() === 'initializing' || uiState() === 'loading-session') {
        <p class="ep-stripe-card__status" role="status">{{ msgs().preparingSecureCardForm }}</p>
      }

      <!--
        Keep the Stripe mount host always in the DOM and visible to layout.
        Toggling display:none on a mounted Stripe iframe causes severe browser jank.
      -->
      <div
        #paymentElementHost
        class="ep-stripe-card__element"
        [class.ep-stripe-card__element--pending]="
          uiState() === 'initializing' || uiState() === 'loading-session'
        "
        [attr.aria-hidden]="uiState() === 'error' || uiState() === 'idle'"
        [attr.aria-label]="msgs().stripeCardFormAria"
      ></div>

      @if (chrome() === 'full') {
        <p class="ep-stripe-card__brands" [attr.aria-label]="msgs().acceptedCardsAria">
          {{ msgs().cardsAcceptedViaStripe }}
        </p>
      }

      @if (inlineError()) {
        <p class="ep-stripe-card__error" role="alert">{{ inlineError() }}</p>
      }

      <!--
        Full Checkout may show an in-panel completion banner.
        Buttons Only (chrome=minimal) is event-driven — the host owns outcome UI.
      -->
      @if (uiState() === 'success' && chrome() !== 'minimal') {
        <p class="ep-stripe-card__success" role="status">{{ msgs().paymentCompleted }}</p>
      }

      <button
        type="button"
        class="ep-stripe-card__pay"
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

      .ep-stripe-card {
        display: flex;
        flex-direction: column;
        gap: 14px;
      }

      .ep-stripe-card__header {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }

      .ep-stripe-card__title {
        margin: 0;
        font-size: 1rem;
        font-weight: 650;
        color: var(--ep-text, #0f172a);
      }

      .ep-stripe-card__status {
        margin: 0;
        font-size: 13px;
        color: var(--ep-text-secondary, #64748b);
      }

      .ep-stripe-card__element {
        min-height: 48px;
        padding: 4px 0;
      }

      .ep-stripe-card__element--pending {
        opacity: 0.45;
        pointer-events: none;
      }

      .ep-stripe-card__brands {
        margin: 0;
        font-size: 12px;
        color: var(--ep-text-secondary, #64748b);
      }

      .ep-stripe-card__error {
        margin: 0;
        color: var(--ep-danger, #b91c1c);
        font-size: 13px;
      }

      .ep-stripe-card__success {
        margin: 0;
        color: var(--ep-success, #15803d);
        font-size: 13px;
        font-weight: 600;
      }

      .ep-stripe-card__pay {
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

      .ep-stripe-card__pay:hover:not(:disabled) {
        background: var(
          --ep-card-cta-hover-bg,
          var(--ep-cta-bg-hover, #1e293b)
        );
        color: var(
          --ep-card-cta-hover-text,
          var(--ep-card-cta-text, var(--ep-cta-text, #f8fafc))
        );
      }

      .ep-stripe-card__pay:active:not(:disabled) {
        background: var(
          --ep-card-cta-hover-bg,
          var(--ep-cta-bg-hover, #1e293b)
        );
        box-shadow: inset 0 1px 0 color-mix(in srgb, #000 18%, transparent);
      }

      .ep-stripe-card__pay:focus-visible {
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

      .ep-stripe-card--minimal .ep-stripe-card__pay {
        min-height: var(--ep-card-cta-min-height, 44px);
        align-self: flex-start;
        min-width: min(100%, 200px);
        padding: var(--ep-card-cta-padding, 0 20px);
        font-size: var(--ep-card-cta-font-size, 14px);
      }

      /*
        Disabled / loading: keep opaque label contrast. Pure opacity on a pale
        dark-theme CTA made "Pay with card" nearly disappear.
        Explicit cardButtonAppearance disabled/loading colors win when set.
      */
      .ep-stripe-card__pay:disabled {
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

      .ep-stripe-card__pay[aria-busy='true']:disabled {
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
        .ep-stripe-card__pay {
          transition: none;
        }
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StripeCardPaymentComponent implements AfterViewInit, OnDestroy {
  private readonly stripeAdapter = inject(StripeCardAdapter);
  private readonly i18n = inject(EasyPaymentsI18nService, { optional: true });
  /** This panel's Payment Element session on the shared StripeCardAdapter. */
  private readonly ownerId = createPaymentOwnerId('card');
  private destroyed = false;

  readonly msgs = computed(() => this.i18n?.messages() ?? EN_TRANSLATIONS);

  readonly product = input.required<PaymentProduct>();
  readonly checkout = input<CheckoutOptions>();
  readonly resolvedTheme = input.required<ResolvedPaymentTheme>();
  /**
   * `full` — checkout chrome (title, brands, amount CTA).
   * `minimal` — Buttons Only expanded panel (security + Element + confirm, no amount).
   */
  readonly chrome = input<'full' | 'minimal'>('full');
  /**
   * Optional Easy Payments–owned Card CTA presentation (label + CSS tokens).
   * Invalid / omitted fields keep theme defaults and localized labels.
   */
  readonly cardButtonAppearance = input<EasyPaymentsCardButtonAppearance | null>(null);

  readonly success = output<PaymentResult>();
  readonly cancel = output<PaymentResult>();
  readonly error = output<PaymentError>();
  /** Fired once when the customer submits the card form. */
  readonly started = output<void>();
  /** True while confirmPayment / 3DS is in progress — parent should lock method switching. */
  readonly busyChange = output<boolean>();

  private readonly host = viewChild.required<ElementRef<HTMLElement>>('paymentElementHost');

  readonly uiState = signal<StripeCardUiState>('idle');
  readonly inlineError = signal<string | null>(null);

  /** Host element is ready for Stripe mount (must be a signal so the session effect can react). */
  private readonly viewReady = signal(false);

  private sessionKey: string | null = null;
  private lastClientSecret: string | null = null;
  private lastMountedLocale: string | null = null;
  private initGeneration = 0;
  private lastAppliedTheme: ResolvedPaymentTheme | null = null;

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
      ? this.msgs().payWithCard
      : interpolate(this.msgs().payAmount, { amount: this.amountLabel() });
  });

  constructor() {
    // Product/checkout changes may require a new PaymentIntent.
    // Theme must NOT recreate PaymentIntents — only update appearance.
    //
    // CRITICAL: ensureSession reads/writes uiState. Without untracked(), those
    // signal writes re-trigger this effect and spam PaymentIntent creation /
    // Element remounts (browser freeze).
    effect(() => {
      const product = this.product();
      const checkout = this.checkout();
      const ready = this.viewReady();
      const locale = this.i18n?.effectiveLocale() ?? 'en';
      if (!ready) {
        return;
      }
      untracked(() => {
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
    void this.stripeAdapter.destroy(this.ownerId);
  }

  canPay(): boolean {
    return this.uiState() === 'ready' && !this.stripeAdapter.isConfirming(this.ownerId);
  }

  async onPay(): Promise<void> {
    if (!this.canPay()) {
      return;
    }

    this.inlineError.set(null);
    this.uiState.set('processing');
    this.started.emit();
    this.busyChange.emit(true);

    try {
      const result = await this.stripeAdapter.confirmPayment(
        this.checkout()?.successUrl,
        this.ownerId,
      );
      if (this.destroyed) {
        return;
      }

      if (result.status === 'success') {
        this.uiState.set('success');
        this.success.emit(result);
      } else if (result.status === 'processing') {
        this.uiState.set('processing');
        this.success.emit(result);
      } else if (result.status === 'cancelled') {
        this.uiState.set('ready');
        this.cancel.emit(result);
      } else {
        this.uiState.set('ready');
        const paymentError = new PaymentError({
          code: 'PAYMENT_FAILED',
          message: result.message ?? 'Payment failed.',
          method: 'card',
          provider: 'stripe',
        });
        this.inlineError.set(localizePaymentError(paymentError.code, this.msgs()));
        this.error.emit(paymentError);
      }
    } catch (err) {
      if (this.destroyed) {
        return;
      }
      const paymentError = normalizeError(err, { method: 'card', provider: 'stripe' });
      if (paymentError.code === 'PAYMENT_CANCELLED') {
        this.uiState.set('ready');
        this.cancel.emit({
          status: 'cancelled',
          method: 'card',
          provider: 'stripe',
          message: paymentError.message,
        });
        return;
      }

      this.uiState.set('ready');
      this.inlineError.set(localizePaymentError(paymentError.code, this.msgs()));
      this.error.emit(paymentError);
    } finally {
      if (!this.destroyed) {
        this.busyChange.emit(false);
      }
    }
  }

  private async applyTheme(theme: ResolvedPaymentTheme): Promise<void> {
    if (this.lastAppliedTheme === theme && this.stripeAdapter.hasMountedElement(this.ownerId)) {
      return;
    }
    this.lastAppliedTheme = theme;
    if (this.stripeAdapter.hasMountedElement(this.ownerId)) {
      await this.stripeAdapter.updateAppearance(theme, this.ownerId);
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
        method: 'card',
        provider: 'stripe',
      });
      this.uiState.set('error');
      this.inlineError.set(localizePaymentError(paymentError.code, this.msgs()));
      this.error.emit(paymentError);
      return;
    }

    const nextKey = buildStripeSessionKey(product, checkout);
    const elementsLocale = toStripeElementsLocale(locale);

    // Same checkout identity (including in-flight): never create another PaymentIntent.
    // sessionKey is cleared only on error/destroy so retries remain possible.
    if (nextKey === this.sessionKey) {
      if (
        this.lastMountedLocale !== elementsLocale &&
        this.lastClientSecret &&
        this.stripeAdapter.hasMountedElement(this.ownerId)
      ) {
        const host = this.host().nativeElement;
        const theme = untracked(() => this.resolvedTheme());
        await this.stripeAdapter.mountPaymentElement(
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
      await this.stripeAdapter.ensureStripeLoaded();
      if (generation !== this.initGeneration) {
        return;
      }

      this.uiState.set('loading-session');
      const session = await this.stripeAdapter.createPaymentSession(
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
      await this.stripeAdapter.mountPaymentElement(
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
      const paymentError = normalizeError(err, { method: 'card', provider: 'stripe' });
      this.uiState.set('error');
      this.inlineError.set(localizePaymentError(paymentError.code, this.msgs()));
      this.error.emit(paymentError);
    }
  }
}
