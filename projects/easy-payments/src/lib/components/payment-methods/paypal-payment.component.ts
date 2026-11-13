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
import { PayPalAdapter } from '../../adapters/paypal/paypal.adapter';
import { createPaymentOwnerId } from '../../utils/payment-owner-id';
import { buildPayPalRenderKey, PayPalUiState } from '../../adapters/paypal/paypal.types';
import { mapPayPalError } from '../../adapters/paypal/paypal-error.mapper';
import {
  EasyPaymentsI18nService,
  EN_TRANSLATIONS,
  localizePaymentError,
  type EasyPaymentsResolvedLocale,
} from '../../i18n';
import { CheckoutSecurityMessageComponent } from '../checkout/checkout-security-message.component';
import { resolvePayPalBorderRadiusStyle } from '../../utils/button-border-radius';

/** Matches the default `--ep-buttons-height` of the Buttons Only strip. */
const PAYPAL_COMPACT_BUTTON_HEIGHT = 40;

@Component({
  selector: 'easy-paypal-payment',
  standalone: true,
  imports: [CheckoutSecurityMessageComponent],
  template: `
    <div
      class="ep-paypal"
      [class.ep-paypal--compact]="compact()"
      [attr.data-state]="uiState()"
      [attr.data-has-error]="inlineError() ? 'true' : null"
    >
      @if (!compact()) {
        <div class="ep-paypal__header">
          <h3 class="ep-paypal__title">{{ msgs().payWithPayPal }}</h3>
          <easy-checkout-security-message [message]="msgs().secureCheckoutPayPal" />
        </div>
      }

      <!-- Compact: no status copy in the strip — it shifts neighboring slots. -->
      @if (uiState() === 'initializing' && !compact()) {
        <p class="ep-paypal__status" role="status">{{ msgs().preparingPayPal }}</p>
      }

      @if (uiState() === 'creating-order' && !compact()) {
        <p class="ep-paypal__status" role="status">{{ msgs().creatingPayPalOrder }}</p>
      }

      @if (uiState() === 'waiting-approval' && !compact()) {
        <p class="ep-paypal__status" role="status">{{ msgs().waitingPayPalApproval }}</p>
      }

      @if (uiState() === 'capturing' && !compact()) {
        <p class="ep-paypal__status" role="status">{{ msgs().capturingPayPal }}</p>
      }

      <!--
        Keep the Buttons host in the DOM while PayPal is available.
        Hide via parent clip (not display:none) when another method is selected.
      -->
      <div
        #paypalButtonsHost
        class="ep-paypal__buttons"
        [class.ep-paypal__buttons--pending]="uiState() === 'initializing'"
        [class.ep-paypal__buttons--unavailable]="compact() && uiState() === 'error'"
        [attr.aria-busy]="isBusyState()"
        [attr.aria-label]="compactButtonsAriaLabel()"
        [attr.aria-invalid]="compact() && inlineError() ? 'true' : null"
      ></div>

      <!--
        Full Checkout keeps inline payment/init error alerts.
        Buttons Only is event-driven: emit error/cancel; do not insert strip banners
        that move the official PayPal button.
      -->
      @if (inlineError() && !compact()) {
        <p class="ep-paypal__error" role="alert">{{ inlineError() }}</p>
      }

      @if (uiState() === 'success' && !compact()) {
        <p class="ep-paypal__success" role="status">{{ msgs().paymentCompleted }}</p>
      }

      @if (uiState() === 'cancelled' && !compact()) {
        <p class="ep-paypal__status" role="status">{{ msgs().paypalCancelled }}</p>
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

      .ep-paypal {
        display: flex;
        flex-direction: column;
        gap: 14px;
      }

      /*
        Compact strip slot: fixed geometry across idle / busy / error / retry.
        No gap and no in-strip alerts — host apps own outcome UI via events.
      */
      .ep-paypal--compact {
        gap: 0;
        min-height: ${PAYPAL_COMPACT_BUTTON_HEIGHT}px;
        height: ${PAYPAL_COMPACT_BUTTON_HEIGHT}px;
      }

      .ep-paypal__header {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }

      .ep-paypal__title {
        margin: 0;
        font-size: 1rem;
        font-weight: 650;
        color: var(--ep-text, #0f172a);
      }

      .ep-paypal__status {
        margin: 0;
        font-size: 13px;
        color: var(--ep-text-secondary, #64748b);
      }

      .ep-paypal__buttons {
        min-height: 48px;
      }

      .ep-paypal--compact .ep-paypal__buttons {
        box-sizing: border-box;
        width: 100%;
        height: ${PAYPAL_COMPACT_BUTTON_HEIGHT}px;
        min-height: ${PAYPAL_COMPACT_BUTTON_HEIGHT}px;
        max-height: ${PAYPAL_COMPACT_BUTTON_HEIGHT}px;
      }

      .ep-paypal--compact .ep-paypal__buttons--unavailable {
        opacity: 0.45;
        pointer-events: none;
      }

      /*
        Host-page focus chrome only. The PayPal Buttons iframe is cross-origin —
        never style its internals. ::ng-deep is required so rules reach SDK-
        injected iframe / .paypal-buttons nodes (they lack _ngcontent attrs).
        Suppress Chromium's duplicated outer iframe outline after click/Tab so
        only the SDK's own in-button focus remains.
      */
      :host ::ng-deep .ep-paypal--compact .ep-paypal__buttons,
      :host ::ng-deep .ep-paypal--compact .ep-paypal__buttons:focus,
      :host ::ng-deep .ep-paypal--compact .ep-paypal__buttons:focus-visible,
      :host ::ng-deep .ep-paypal--compact .ep-paypal__buttons:focus-within {
        outline: none;
        box-shadow: none;
      }

      :host ::ng-deep .ep-paypal__buttons iframe,
      :host ::ng-deep .ep-paypal__buttons iframe:focus,
      :host ::ng-deep .ep-paypal__buttons iframe:focus-visible {
        outline: none !important;
        box-shadow: none !important;
      }

      /* PayPal injects .paypal-buttons around the iframe on the host page. */
      :host ::ng-deep .ep-paypal__buttons .paypal-buttons:focus,
      :host ::ng-deep .ep-paypal__buttons .paypal-buttons:focus-visible,
      :host ::ng-deep .ep-paypal__buttons .paypal-buttons *:focus,
      :host ::ng-deep .ep-paypal__buttons .paypal-buttons *:focus-visible {
        outline: none !important;
        box-shadow: none !important;
      }

      .ep-paypal__buttons--pending {
        opacity: 0.45;
        pointer-events: none;
      }

      .ep-paypal__error {
        margin: 0;
        color: var(--ep-danger, #b91c1c);
        font-size: 13px;
      }

      .ep-paypal__success {
        margin: 0;
        color: var(--ep-success, #15803d);
        font-size: 13px;
        font-weight: 600;
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PayPalPaymentComponent implements AfterViewInit, OnDestroy {
  private readonly paypalAdapter = inject(PayPalAdapter);
  private readonly i18n = inject(EasyPaymentsI18nService, { optional: true });

  readonly msgs = computed(() => this.i18n?.messages() ?? EN_TRANSLATIONS);

  readonly product = input.required<PaymentProduct>();
  readonly checkout = input<CheckoutOptions>();
  /** Theme is accepted for API symmetry with Stripe; PayPal Buttons use official gold styling. */
  readonly resolvedTheme = input.required<ResolvedPaymentTheme>();
  /**
   * Compact in-list / Payment Buttons Only mount: official PayPal Buttons without
   * checkout panel chrome (title, security blurb, verbose status copy).
   */
  readonly compact = input(false);
  /**
   * Shared Buttons Only grid corner radius in CSS pixels (`buttonsAppearance.borderRadius`).
   * Omitted keeps PayPal SDK defaults (`shape: 'rect'`).
   */
  readonly buttonBorderRadiusPx = input<number | null>(null);

  readonly success = output<PaymentResult>();
  readonly cancel = output<PaymentResult>();
  readonly error = output<PaymentError>();
  /** Fired once when PayPal order creation begins. Capture does not fire it again. */
  readonly started = output<void>();
  /** True during create/approve/capture — parent should lock method switching. */
  readonly busyChange = output<boolean>();

  private readonly host = viewChild.required<ElementRef<HTMLElement>>('paypalButtonsHost');

  readonly uiState = signal<PayPalUiState>('idle');
  readonly inlineError = signal<string | null>(null);

  private readonly viewReady = signal(false);
  private renderKey: string | null = null;
  private renderGeneration = 0;
  private attemptAnnounced = false;
  private captureEmitted = false;
  /** Ownership token for this host's Buttons mount on the shared PayPalAdapter. */
  private buttonsMountId: string | null = null;
  /** Owner token for order-create guards on the shared PayPalAdapter. */
  private readonly orderOwnerId = createPaymentOwnerId('paypal');
  /** This host's most recent order — never another host's. */
  private currentOrderId: string | null = null;

  constructor() {
    // Product/checkout/locale identity may require re-rendering Buttons (createOrder closure).
    // Theme must NOT recreate orders or reload the SDK.
    effect(() => {
      const product = this.product();
      const checkout = this.checkout();
      const ready = this.viewReady();
      const locale = this.i18n?.effectiveLocale() ?? 'en';
      const compact = this.compact();
      const borderRadiusPx = this.buttonBorderRadiusPx();
      // Read theme so Angular tracks it, but do not use it as a render key.
      void this.resolvedTheme();
      if (!ready) {
        return;
      }
      untracked(() => {
        void this.ensureButtons(product, checkout, locale, compact, borderRadiusPx);
      });
    });

    effect(() => {
      const busy = this.isBusyState();
      untracked(() => this.busyChange.emit(busy));
    });
  }

  ngAfterViewInit(): void {
    this.viewReady.set(true);
  }

  ngOnDestroy(): void {
    this.renderGeneration += 1;
    this.renderKey = null;
    const mountId = this.buttonsMountId;
    this.buttonsMountId = null;
    // Ownership-scoped cleanup only — do not call adapter.destroy(), which would
    // close sibling PayPal mounts and clear shared in-flight order flags.
    if (mountId) {
      void this.paypalAdapter.destroyButtons(mountId);
    }
  }

  isBusyState(): boolean {
    const state = this.uiState();
    return (
      state === 'creating-order' ||
      state === 'waiting-approval' ||
      state === 'capturing' ||
      this.paypalAdapter.isBusy(this.orderOwnerId, this.currentOrderId)
    );
  }

  /**
   * Compact strip ARIA: keep a single accessible name on the mount host.
   * Transaction/init failures still emit `error`; in-strip banners are omitted.
   */
  compactButtonsAriaLabel(): string {
    const base = this.msgs().paypalCheckoutAria;
    if (!this.compact()) {
      return base;
    }
    if (this.uiState() === 'initializing') {
      return `${base}, ${this.msgs().preparingPayPal}`;
    }
    const err = this.inlineError();
    if (err) {
      return `${base}, ${err}`;
    }
    return base;
  }

  private async ensureButtons(
    product: PaymentProduct,
    checkout: CheckoutOptions | undefined,
    locale: EasyPaymentsResolvedLocale,
    compact = false,
    borderRadiusPx: number | null = null,
  ): Promise<void> {
    const validation = validatePaymentProduct(product);
    if (!validation.valid) {
      const paymentError = new PaymentError({
        code: 'PRODUCT_INVALID',
        message: validation.errors.join(' '),
        method: 'paypal',
        provider: 'paypal',
      });
      this.uiState.set('error');
      this.inlineError.set(localizePaymentError(paymentError.code, this.msgs()));
      this.error.emit(paymentError);
      return;
    }

    const radiusKey = borderRadiusPx == null ? 'default' : String(borderRadiusPx);
    const nextKey = `${buildPayPalRenderKey(product, checkout)}|${locale}|compact:${compact ? 1 : 0}|r:${radiusKey}`;
    if (nextKey === this.renderKey) {
      return;
    }

    const generation = ++this.renderGeneration;
    this.renderKey = nextKey;
    this.uiState.set('initializing');
    this.inlineError.set(null);

    try {
      try {
        await this.paypalAdapter.ensureSdkLoaded(locale);
      } catch (err) {
        if (generation !== this.renderGeneration) {
          return;
        }
        this.renderKey = null;
        const paymentError = mapPayPalError(
          err,
          'SDK_LOAD_FAILED',
          'PayPal SDK script failed to load.',
        );
        this.uiState.set('error');
        this.inlineError.set(localizePaymentError(paymentError.code, this.msgs()));
        this.error.emit(paymentError);
        return;
      }

      if (generation !== this.renderGeneration) {
        return;
      }

      const host = this.host().nativeElement;
      host.replaceChildren();

      const radiusStyle = resolvePayPalBorderRadiusStyle(borderRadiusPx);

      // Buttons Only: one primary PayPal funding button. Full checkout keeps
      // SDK-eligible funding sources (Pay Later / card) via omitted fundingSource.
      const mountId = await this.paypalAdapter.renderButtons(
        host,
        {
          ...(compact
            ? {
                fundingSource: 'paypal',
                style: {
                  layout: 'vertical',
                  color: 'gold',
                  label: 'paypal',
                  height: PAYPAL_COMPACT_BUTTON_HEIGHT,
                  ...radiusStyle,
                },
              }
            : {}),
          createOrder: () => this.onCreateOrder(product, checkout, generation),
          onApprove: (data) => this.onApprove(data.orderID, generation),
          onCancel: () => this.onCancel(generation),
          onError: (err) => this.onSdkError(err, generation),
          onClick: async (_data, actions) => {
            if (
              this.paypalAdapter.isBusy(this.orderOwnerId, this.currentOrderId) ||
              this.uiState() === 'success'
            ) {
              await actions.reject();
              return;
            }
            await actions.resolve();
          },
        },
        locale,
        this.buttonsMountId ?? undefined,
      );

      if (generation !== this.renderGeneration) {
        await this.paypalAdapter.destroyButtons(mountId);
        if (this.buttonsMountId === mountId) {
          this.buttonsMountId = null;
        }
        return;
      }

      this.buttonsMountId = mountId;
      this.uiState.set('ready');
    } catch (err) {
      if (generation !== this.renderGeneration) {
        return;
      }
      this.renderKey = null;
      // SDK script already loaded — classify Buttons create/render separately.
      const paymentError = mapPayPalError(
        err,
        'PROVIDER_UNAVAILABLE',
        'PayPal Buttons failed to initialize.',
      );
      this.uiState.set('error');
      this.inlineError.set(localizePaymentError(paymentError.code, this.msgs()));
      this.error.emit(paymentError);
    }
  }

  private async onCreateOrder(
    product: PaymentProduct,
    checkout: CheckoutOptions | undefined,
    generation: number,
  ): Promise<string> {
    if (generation !== this.renderGeneration) {
      throw new PaymentError({
        code: 'PAYMENT_FAILED',
        message: 'PayPal checkout was superseded.',
        method: 'paypal',
        provider: 'paypal',
      });
    }

    this.inlineError.set(null);
    this.uiState.set('creating-order');
    this.captureEmitted = false;
    if (!this.attemptAnnounced) {
      this.attemptAnnounced = true;
      this.started.emit();
    }

    try {
      const orderId = await this.paypalAdapter.createOrder(product, checkout, this.orderOwnerId);
      if (generation === this.renderGeneration) {
        this.currentOrderId = orderId;
        this.uiState.set('waiting-approval');
      }
      return orderId;
    } catch (err) {
      const paymentError = mapPayPalError(err, 'BACKEND_ERROR', 'Failed to create PayPal order.');
      if (generation === this.renderGeneration) {
        this.attemptAnnounced = false;
        this.uiState.set('ready');
        this.inlineError.set(localizePaymentError(paymentError.code, this.msgs()));
        this.error.emit(paymentError);
      }
      throw paymentError;
    }
  }

  private async onApprove(orderId: string, generation: number): Promise<void> {
    if (generation !== this.renderGeneration || this.captureEmitted) {
      return;
    }
    this.captureEmitted = true;

    this.uiState.set('capturing');
    this.inlineError.set(null);

    try {
      const result = await this.paypalAdapter.captureOrder(orderId);
      if (generation !== this.renderGeneration) {
        return;
      }

      if (result.status === 'success') {
        this.attemptAnnounced = false;
        this.uiState.set('success');
        this.success.emit(result);
        return;
      }

      if (result.status === 'cancelled') {
        this.attemptAnnounced = false;
        this.uiState.set('cancelled');
        this.cancel.emit(result);
        return;
      }

      const paymentError = new PaymentError({
        code: 'PAYMENT_FAILED',
        message: result.message ?? 'PayPal payment failed.',
        method: 'paypal',
        provider: 'paypal',
      });
      this.attemptAnnounced = false;
      this.captureEmitted = false;
      this.uiState.set('ready');
      this.inlineError.set(localizePaymentError(paymentError.code, this.msgs()));
      this.error.emit(paymentError);
    } catch (err) {
      if (generation !== this.renderGeneration) {
        return;
      }
      const paymentError = normalizeError(err, { method: 'paypal', provider: 'paypal' });
      if (paymentError.code === 'PAYMENT_CANCELLED') {
        this.attemptAnnounced = false;
        this.captureEmitted = false;
        this.uiState.set('cancelled');
        this.cancel.emit({
          status: 'cancelled',
          method: 'paypal',
          provider: 'paypal',
          message: paymentError.message,
          sessionId: orderId,
        });
        return;
      }

      this.attemptAnnounced = false;
      this.captureEmitted = false;
      this.uiState.set('ready');
      this.inlineError.set(localizePaymentError(paymentError.code, this.msgs()));
      this.error.emit(paymentError);
    }
  }

  private onCancel(generation: number): void {
    if (generation !== this.renderGeneration) {
      return;
    }

    this.attemptAnnounced = false;
    this.uiState.set('cancelled');
    this.cancel.emit({
      status: 'cancelled',
      method: 'paypal',
      provider: 'paypal',
      message: 'PayPal checkout was cancelled.',
      sessionId: this.currentOrderId ?? undefined,
    });

    // Allow another attempt without remounting Buttons.
    queueMicrotask(() => {
      if (generation === this.renderGeneration && this.uiState() === 'cancelled') {
        this.uiState.set('ready');
      }
    });
  }

  private onSdkError(err: unknown, generation: number): void {
    if (generation !== this.renderGeneration) {
      return;
    }

    const paymentError = mapPayPalError(err);
    if (paymentError.code === 'PAYMENT_CANCELLED') {
      this.onCancel(generation);
      return;
    }

    this.attemptAnnounced = false;
    this.uiState.set('ready');
    this.inlineError.set(localizePaymentError(paymentError.code, this.msgs()));
    this.error.emit(paymentError);
  }
}
