import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  NgZone,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import {
  CheckoutOptions,
  PaymentMethod,
  PAYMENT_METHOD_PROVIDER_MAP,
  PaymentMethodChangeEvent,
  PaymentProduct,
  PaymentResult,
  PaymentStartedEvent,
  PaymentTheme,
  ResolvedPaymentTheme,
} from '../../models';
import type { EasyPaymentButtonsLayout } from '../../models/easy-payment-buttons-layout.model';
import type { EasyPaymentsVisualStyle } from '../../models/easy-payments-visual-style.model';
import { PaymentError, normalizeError } from '../../errors/payment-error';
import { CheckoutAvailabilitySession } from '../../services/checkout-availability-session';
import {
  PaymentOrchestratorService,
  type AvailablePaymentMethod,
} from '../../services/payment-orchestrator.service';
import { ThemeService } from '../../themes/theme.service';
import { resolveVisualStyleCssVars } from '../../themes/resolve-visual-style';
import { PAYMENT_METHOD_LABELS } from '../../models/payment-method.model';
import { getPaymentMethodPresentation } from '../../branding/payment-method-presentation';
import {
  EasyPaymentsI18nService,
  type EasyPaymentsLocale,
  type EasyPaymentsTranslationOverrides,
} from '../../i18n';
import { ApplePayAdapter } from '../../adapters/apple-pay/apple-pay.adapter';
import { PaymentMethodIconComponent } from '../checkout/payment-method-icon.component';
import { StripeCardPaymentComponent } from '../payment-methods/stripe-card-payment.component';
import { PayPalPaymentComponent } from '../payment-methods/paypal-payment.component';
import { GooglePayPaymentComponent } from '../payment-methods/google-pay-payment.component';
import { ApplePayPaymentComponent } from '../payment-methods/apple-pay-payment.component';
import { MockMethodPanelComponent } from '../checkout/mock-method-panel.component';

/** Slot readiness for the method list. */
export type EasyPaymentButtonSlotState = 'loading' | 'available' | 'unavailable';

/**
 * How a method slot is rendered.
 * - `placeholder` — noninteractive (not yet integrated, loading, or unavailable)
 * - `card-selector` — Card tile that reveals Stripe/mock panel below the list
 * - `*-express` — official provider buttons in-slot
 * - `*-mock` — clearly labeled mock controls in-slot
 */
export type EasyPaymentButtonSlotKind =
  | 'placeholder'
  | 'card-selector'
  | 'paypal-express'
  | 'paypal-mock'
  | 'google-pay-express'
  | 'google-pay-mock'
  | 'apple-pay-express'
  | 'apple-pay-mock';

export interface EasyPaymentButtonSlot {
  readonly method: PaymentMethod;
  readonly state: EasyPaymentButtonSlotState;
  readonly isMock: boolean;
  readonly label: string;
  readonly kind: EasyPaymentButtonSlotKind;
  /**
   * True for Card selector tiles only.
   * Express mounts are interactive payments but not selectors.
   */
  readonly interactive: boolean;
}

const DEFAULT_BUTTON_METHODS: PaymentMethod[] = [
  'card',
  'paypal',
  'apple-pay',
  'google-pay',
  'klarna',
  'affirm',
];

/**
 * Payment Buttons Only — transparent method list + inline provider mounts.
 *
 * Step 2A: Card selector → Stripe Payment Element / mock panel below the list.
 * Step 2B: Official PayPal Buttons render directly in the PayPal slot.
 * Step 2C: Official Google Pay button renders directly in the google-pay slot.
 * Step 2D: Official Apple Pay ECE button renders directly in the apple-pay slot.
 * Klarna / Affirm remain noninteractive placeholders.
 */
@Component({
  selector: 'easy-payment-buttons',
  standalone: true,
  imports: [
    PaymentMethodIconComponent,
    StripeCardPaymentComponent,
    PayPalPaymentComponent,
    GooglePayPaymentComponent,
    ApplePayPaymentComponent,
    MockMethodPanelComponent,
  ],
  templateUrl: './easy-payment-buttons.component.html',
  styleUrl: './easy-payment-buttons.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'ep-payment-buttons-host',
    '[class.ep-theme-light]': 'resolvedTheme() === "light"',
    '[class.ep-theme-dark]': 'resolvedTheme() === "dark"',
    '[class.ep-payment-buttons-host--horizontal]': 'layout() === "horizontal"',
    '[class.ep-payment-buttons-host--vertical]': 'layout() === "vertical"',
    '[attr.data-theme]': 'resolvedTheme()',
    '[attr.data-layout]': 'layout()',
    '[attr.data-locale]': 'effectiveLocale()',
    '[attr.lang]': 'effectiveLocale()',
    '[attr.data-card-ready]': 'hasAvailableCard() ? "true" : "false"',
    '[attr.data-paypal-ready]': 'hasAvailablePayPal() ? "true" : "false"',
    '[attr.data-google-pay-ready]': 'hasAvailableGooglePay() ? "true" : "false"',
    '[attr.data-apple-pay-ready]': 'hasAvailableApplePay() ? "true" : "false"',
    '[style.--ep-font-family]': 'visualStyleCssVars().fontFamily',
    '[style.--ep-text]': 'visualStyleCssVars().textColor',
    '[style.--ep-text-secondary]': 'visualStyleCssVars().textSecondaryColor',
    '[style.--ep-surface]': 'visualStyleCssVars().surfaceColor',
    '[style.--ep-accent]': 'visualStyleCssVars().accentColor',
    '[style.--ep-accent-soft]': 'visualStyleCssVars().accentSoft',
    '[style.--ep-focus]': 'visualStyleCssVars().accentColor',
    '[style.--ep-radius]': 'visualStyleCssVars().borderRadius',
    '[style.--ep-spacing]': 'visualStyleCssVars().spacing',
    role: 'region',
    '[attr.aria-label]': 'regionAriaLabel()',
  },
  providers: [EasyPaymentsI18nService, ThemeService],
})
export class EasyPaymentButtonsComponent {
  private readonly orchestrator = inject(PaymentOrchestratorService);
  private readonly themeService = inject(ThemeService);
  private readonly i18n = inject(EasyPaymentsI18nService);
  private readonly applePayAdapter = inject(ApplePayAdapter);
  private readonly ngZone = inject(NgZone);
  private readonly destroyRef = inject(DestroyRef);
  private destroyed = false;

  private readonly availabilitySession = new CheckoutAvailabilitySession();
  private availabilityGeneration = 0;
  /** One in-flight attempt. Prevents duplicate terminal emits. */
  private paymentAttempt: 'idle' | 'active' | 'settled' = 'idle';

  readonly product = input.required<PaymentProduct>();
  readonly methods = input<PaymentMethod[]>(DEFAULT_BUTTON_METHODS);
  readonly checkout = input<CheckoutOptions>();
  /** Method row orientation. Order always follows `[methods]`. */
  readonly layout = input<EasyPaymentButtonsLayout>('vertical');
  readonly theme = input<PaymentTheme>('system');
  readonly locale = input<EasyPaymentsLocale>('auto');
  readonly translations = input<EasyPaymentsTranslationOverrides>({});
  /**
   * Optional EP-owned token overrides for list chrome.
   * Host background remains permanently transparent regardless of `backgroundColor`.
   */
  readonly visualStyle = input<EasyPaymentsVisualStyle | null>(null);

  readonly started = output<PaymentStartedEvent>();
  readonly methodChange = output<PaymentMethodChangeEvent>();
  readonly success = output<PaymentResult>();
  readonly cancel = output<PaymentResult>();
  readonly error = output<PaymentError>();

  readonly resolvedTheme = this.themeService.resolvedTheme;
  readonly effectiveLocale = this.i18n.effectiveLocale;
  readonly availableMethods = this.availabilitySession.availableMethods;
  readonly availabilityPublished = this.availabilitySession.availabilityPublished;
  readonly loading = this.orchestrator.loading;

  readonly selectedMethod = signal<PaymentMethod | null>(null);
  readonly providerBusy = signal(false);
  readonly processingMethod = signal<PaymentMethod | null>(null);

  readonly visualStyleCssVars = computed(() => resolveVisualStyleCssVars(this.visualStyle()));

  readonly regionAriaLabel = computed(() => {
    const msgs = this.i18n.messages();
    return msgs.paymentMethodSelectionAria || 'Payment methods';
  });

  readonly methodsLocked = computed(
    () => this.providerBusy() || this.processingMethod() !== null,
  );

  /**
   * Slots in exact developer `[methods]` order.
   * Availability filters state only — never reorders.
   */
  readonly methodSlots = computed<EasyPaymentButtonSlot[]>(() => {
    const requested = this.methods();
    const published = this.availabilityPublished();
    const availability = this.availableMethods();
    const theme = this.resolvedTheme();

    return requested.map((method) => {
      const entry = availability.find((item) => item.method === method);
      let state: EasyPaymentButtonSlotState = 'loading';
      if (published) {
        state = entry?.available ? 'available' : 'unavailable';
      }
      const isMock = entry?.isMock ?? false;
      const kind = this.resolveSlotKind(method, state, isMock);
      return {
        method,
        state,
        isMock,
        label: getPaymentMethodPresentation(method, theme).label || PAYMENT_METHOD_LABELS[method],
        kind,
        interactive: kind === 'card-selector',
      };
    });
  });

  readonly hasAvailableCard = computed(() =>
    this.methodSlots().some((slot) => slot.method === 'card' && slot.state === 'available'),
  );

  readonly hasAvailablePayPal = computed(() =>
    this.methodSlots().some((slot) => slot.method === 'paypal' && slot.state === 'available'),
  );

  readonly hasAvailableGooglePay = computed(() =>
    this.methodSlots().some((slot) => slot.method === 'google-pay' && slot.state === 'available'),
  );

  readonly hasAvailableApplePay = computed(() =>
    this.methodSlots().some((slot) => slot.method === 'apple-pay' && slot.state === 'available'),
  );

  readonly selectedCardEntry = computed(() => {
    if (this.selectedMethod() !== 'card') {
      return null;
    }
    return this.availableMethods().find((entry) => entry.method === 'card' && entry.available) ?? null;
  });

  readonly showStripeCardPanel = computed(() => {
    const entry = this.selectedCardEntry();
    return !!entry && !entry.isMock;
  });

  readonly showMockCardPanel = computed(() => {
    const entry = this.selectedCardEntry();
    return !!entry && entry.isMock;
  });

  /**
   * True when at least one configured method is still a noninteractive placeholder.
   */
  readonly foundationOnly = computed(() =>
    this.methodSlots().some((slot) => slot.kind === 'placeholder' && slot.state !== 'unavailable'),
  );

  constructor() {
    this.destroyRef.onDestroy(() => {
      this.destroyed = true;
      this.applePayAdapter.setAvailabilityListener(null);
    });

    // Stripe ECE `ready` often fires outside NgZone — refresh instance availability
    // so apple-pay slots update after wallet eligibility is known.
    // Note: ApplePayAdapter allows a single global listener (same as Ready-to-Use Checkout).
    this.applePayAdapter.setAvailabilityListener(() => {
      this.ngZone.run(() => {
        if (this.destroyed) {
          return;
        }
        const product = untracked(() => this.product());
        const methods = untracked(() => this.methods());
        const checkout = untracked(() => this.checkout());
        void this.refreshInstanceAvailability(
          methods,
          product,
          checkout,
          this.resolvedTheme(),
        ).catch(() => {
          // Availability refresh errors are non-fatal for button UI.
        });
      });
    });

    effect(() => {
      this.themeService.setTheme(this.theme());
    });

    effect(() => {
      this.i18n.setRequestedLocale(this.locale());
      this.i18n.setOverrides(this.translations());
    });

    effect(() => {
      const product = this.product();
      const methods = this.methods();
      const checkout = this.checkout();
      const theme = this.resolvedTheme();
      untracked(() => {
        void this.refreshInstanceAvailability(methods, product, checkout, theme).catch(
          (err: unknown) => {
            this.error.emit(normalizeError(err));
          },
        );
      });
    });

    // Clear Card selection if Card leaves the allow-list or becomes unavailable.
    effect(() => {
      const selected = this.selectedMethod();
      if (selected !== 'card') {
        return;
      }
      const cardSlot = this.methodSlots().find((slot) => slot.method === 'card');
      if (!cardSlot || cardSlot.state !== 'available') {
        untracked(() => this.updateSelectedMethod(null));
      }
    });
  }

  slotAriaLabel(slot: EasyPaymentButtonSlot): string {
    const base = slot.label;
    if (slot.state === 'loading') {
      return `${base}, checking availability`;
    }
    if (slot.state === 'unavailable') {
      return `${base}, unavailable`;
    }
    if (slot.kind === 'paypal-express') {
      return `${base}, official PayPal button`;
    }
    if (slot.kind === 'google-pay-express') {
      return `${base}, official Google Pay button`;
    }
    if (slot.kind === 'apple-pay-express') {
      return `${base}, official Apple Pay button`;
    }
    if (
      slot.kind === 'paypal-mock' ||
      slot.kind === 'google-pay-mock' ||
      slot.kind === 'apple-pay-mock'
    ) {
      return `${base}, mock payment`;
    }
    if (!slot.interactive) {
      return `${base}, payment actions not available yet`;
    }
    if (this.selectedMethod() === slot.method) {
      return `${base}, selected`;
    }
    return base;
  }

  selectMethod(method: PaymentMethod): void {
    if (this.methodsLocked() || this.destroyed) {
      return;
    }
    const slot = this.methodSlots().find((entry) => entry.method === method);
    if (slot?.kind !== 'card-selector') {
      return;
    }
    this.updateSelectedMethod(method);
  }

  onCardStarted(): void {
    this.onPaymentStarted('card');
  }

  onCardBusy(busy: boolean): void {
    this.providerBusy.set(busy);
  }

  onCardSuccess(result: PaymentResult): void {
    this.handleSuccess(result);
  }

  onCardCancel(result: PaymentResult): void {
    this.handleCancelled(result);
  }

  onCardError(error: PaymentError): void {
    this.handlePaymentError(error);
  }

  /**
   * Official PayPal has no separate selector — engaging the SDK (order create)
   * selects PayPal for methodChange, then emits started.
   */
  onPayPalStarted(): void {
    this.updateSelectedMethod('paypal');
    this.onPaymentStarted('paypal');
  }

  onPayPalBusy(busy: boolean): void {
    this.providerBusy.set(busy);
  }

  onPayPalSuccess(result: PaymentResult): void {
    this.handleSuccess(result);
  }

  onPayPalCancel(result: PaymentResult): void {
    this.handleCancelled(result);
  }

  onPayPalError(error: PaymentError): void {
    this.handlePaymentError(error);
  }

  /**
   * Official Google Pay has no separate selector — buyer click selects the method
   * for methodChange, then emits started.
   */
  onGooglePayStarted(): void {
    this.updateSelectedMethod('google-pay');
    this.onPaymentStarted('google-pay');
  }

  onGooglePayBusy(busy: boolean): void {
    this.providerBusy.set(busy);
  }

  onGooglePaySuccess(result: PaymentResult): void {
    this.handleSuccess(result);
  }

  onGooglePayCancel(result: PaymentResult): void {
    this.handleCancelled(result);
  }

  onGooglePayError(error: PaymentError): void {
    this.handlePaymentError(error);
  }

  /**
   * Official Apple Pay has no separate selector — wallet confirm selects the method
   * for methodChange, then emits started (not on ECE mount / ready).
   */
  onApplePayStarted(): void {
    this.updateSelectedMethod('apple-pay');
    this.onPaymentStarted('apple-pay');
  }

  onApplePayBusy(busy: boolean): void {
    this.providerBusy.set(busy);
  }

  onApplePaySuccess(result: PaymentResult): void {
    this.handleSuccess(result);
  }

  onApplePayCancel(result: PaymentResult): void {
    this.handleCancelled(result);
  }

  onApplePayError(error: PaymentError): void {
    this.handlePaymentError(error);
  }

  async onMockCardPay(): Promise<void> {
    await this.runMockPayment('card');
  }

  async onMockPayPalPay(): Promise<void> {
    if (this.methodsLocked() || this.destroyed) {
      return;
    }
    this.updateSelectedMethod('paypal');
    await this.runMockPayment('paypal');
  }

  async onMockGooglePayPay(): Promise<void> {
    if (this.methodsLocked() || this.destroyed) {
      return;
    }
    this.updateSelectedMethod('google-pay');
    await this.runMockPayment('google-pay');
  }

  async onMockApplePayPay(): Promise<void> {
    if (this.methodsLocked() || this.destroyed) {
      return;
    }
    this.updateSelectedMethod('apple-pay');
    await this.runMockPayment('apple-pay');
  }

  private resolveSlotKind(
    method: PaymentMethod,
    state: EasyPaymentButtonSlotState,
    isMock: boolean,
  ): EasyPaymentButtonSlotKind {
    // Apple Pay ECE must mount to learn wallet eligibility (`ready`).
    // After publish, live apple-pay always gets an express slot; the component
    // hides the button when Stripe reports Apple Pay unavailable (no fake CTA).
    if (method === 'apple-pay') {
      if (state === 'loading') {
        return 'placeholder';
      }
      if (isMock) {
        return state === 'available' ? 'apple-pay-mock' : 'placeholder';
      }
      return 'apple-pay-express';
    }
    if (state !== 'available') {
      return 'placeholder';
    }
    if (method === 'card') {
      return 'card-selector';
    }
    if (method === 'paypal') {
      return isMock ? 'paypal-mock' : 'paypal-express';
    }
    if (method === 'google-pay') {
      return isMock ? 'google-pay-mock' : 'google-pay-express';
    }
    return 'placeholder';
  }

  private async runMockPayment(method: PaymentMethod): Promise<void> {
    if (this.methodsLocked() || this.destroyed) {
      return;
    }
    this.processingMethod.set(method);
    this.onPaymentStarted(method);
    try {
      const result = await this.orchestrator.processPayment(
        method,
        this.product(),
        this.checkout(),
      );
      if (result.status === 'success') {
        this.handleSuccess(result);
      } else if (result.status === 'cancelled') {
        this.handleCancelled(result);
      } else {
        this.handlePaymentError(
          new PaymentError({
            code: 'PAYMENT_FAILED',
            message: result.message ?? 'Payment failed.',
            method,
            provider: PAYMENT_METHOD_PROVIDER_MAP[method],
          }),
        );
      }
    } catch (err) {
      const paymentError = normalizeError(err, {
        method,
        provider: PAYMENT_METHOD_PROVIDER_MAP[method],
      });
      if (paymentError.code === 'PAYMENT_CANCELLED') {
        this.handleCancelled({
          status: 'cancelled',
          method,
          provider: PAYMENT_METHOD_PROVIDER_MAP[method],
          message: paymentError.message,
        });
      } else {
        this.handlePaymentError(paymentError);
      }
    } finally {
      if (!this.destroyed) {
        this.processingMethod.set(null);
      }
    }
  }

  private onPaymentStarted(method: PaymentMethod): void {
    if (this.destroyed || this.paymentAttempt === 'active') {
      return;
    }
    this.paymentAttempt = 'active';
    const product = this.product();
    this.started.emit({
      method,
      provider: PAYMENT_METHOD_PROVIDER_MAP[method],
      amount: product.amount,
      currency: product.currency,
    });
  }

  private updateSelectedMethod(method: PaymentMethod | null): void {
    const previousMethod = this.selectedMethod();
    if (previousMethod === method) {
      return;
    }
    this.selectedMethod.set(method);
    if (this.destroyed) {
      return;
    }
    this.methodChange.emit({
      method,
      previousMethod,
      provider: method ? PAYMENT_METHOD_PROVIDER_MAP[method] : null,
    });
  }

  private acceptTerminalEvent(): boolean {
    if (this.destroyed) {
      return false;
    }
    if (this.paymentAttempt === 'settled') {
      return false;
    }
    if (this.paymentAttempt === 'active') {
      this.paymentAttempt = 'settled';
    }
    return true;
  }

  private handleSuccess(result: PaymentResult): void {
    if (!this.acceptTerminalEvent()) {
      return;
    }
    this.providerBusy.set(false);
    this.processingMethod.set(null);
    this.success.emit(result);
    this.paymentAttempt = 'idle';
  }

  private handleCancelled(result: PaymentResult): void {
    if (!this.acceptTerminalEvent()) {
      return;
    }
    this.providerBusy.set(false);
    this.processingMethod.set(null);
    this.cancel.emit(result);
    this.paymentAttempt = 'idle';
  }

  private handlePaymentError(error: PaymentError): void {
    if (!this.acceptTerminalEvent()) {
      return;
    }
    this.providerBusy.set(false);
    this.processingMethod.set(null);
    this.error.emit(error);
    this.paymentAttempt = 'idle';
  }

  private async refreshInstanceAvailability(
    methods: PaymentMethod[],
    product: PaymentProduct,
    checkout: CheckoutOptions | undefined,
    theme: ResolvedPaymentTheme,
  ): Promise<AvailablePaymentMethod[]> {
    const generation = ++this.availabilityGeneration;
    const results = await this.orchestrator.refreshAvailability(
      methods,
      product,
      checkout,
      theme,
    );
    if (this.destroyed || generation !== this.availabilityGeneration) {
      return results;
    }
    this.availabilitySession.apply(results);
    return results;
  }
}
