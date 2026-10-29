import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  NgZone,
  PendingTasks,
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
import { CheckoutHostContext } from '../../services/checkout-host-context';
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
import { StripeRedirectRecoveryService } from '../../adapters/stripe/stripe-redirect-recovery.service';
import {
  detectStripeReturnMethod,
  isStripeReturnAttempt,
  type StripeRedirectMethod,
} from '../../adapters/stripe/stripe-redirect-return';
import { PaymentMethodIconComponent } from '../checkout/payment-method-icon.component';
import { StripeCardPaymentComponent } from '../payment-methods/stripe-card-payment.component';
import { PayPalPaymentComponent } from '../payment-methods/paypal-payment.component';
import { GooglePayPaymentComponent } from '../payment-methods/google-pay-payment.component';
import { ApplePayPaymentComponent } from '../payment-methods/apple-pay-payment.component';
import { KlarnaPaymentComponent } from '../payment-methods/klarna-payment.component';
import { AffirmPaymentComponent } from '../payment-methods/affirm-payment.component';
import { MockMethodPanelComponent } from '../checkout/mock-method-panel.component';

/** Slot readiness for the method list. */
export type EasyPaymentButtonSlotState = 'loading' | 'available' | 'unavailable';

/**
 * How a method slot is rendered.
 * - `placeholder` — noninteractive (loading or unavailable)
 * - `*-selector` — tile that reveals Stripe/mock panel below the list
 * - `*-express` — official provider buttons in-slot
 * - `*-mock` — clearly labeled mock wallet controls in-slot
 */
export type EasyPaymentButtonSlotKind =
  | 'placeholder'
  | 'card-selector'
  | 'klarna-selector'
  | 'affirm-selector'
  | 'paypal-express'
  | 'paypal-mock'
  | 'google-pay-express'
  | 'google-pay-mock'
  | 'apple-pay-express'
  | 'apple-pay-mock';

const SELECTOR_SLOT_KINDS: ReadonlySet<EasyPaymentButtonSlotKind> = new Set([
  'card-selector',
  'klarna-selector',
  'affirm-selector',
]);

export interface EasyPaymentButtonSlot {
  readonly method: PaymentMethod;
  readonly state: EasyPaymentButtonSlotState;
  readonly isMock: boolean;
  readonly label: string;
  readonly kind: EasyPaymentButtonSlotKind;
  /**
   * True for Card / Klarna / Affirm selector tiles.
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
 * Step 2E: Klarna / Affirm selectors → Stripe Payment Element / mock panels below.
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
    KlarnaPaymentComponent,
    AffirmPaymentComponent,
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
    '[attr.data-klarna-ready]': 'hasAvailableKlarna() ? "true" : "false"',
    '[attr.data-affirm-ready]': 'hasAvailableAffirm() ? "true" : "false"',
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
  providers: [EasyPaymentsI18nService, ThemeService, CheckoutHostContext],
})
export class EasyPaymentButtonsComponent {
  private readonly orchestrator = inject(PaymentOrchestratorService);
  private readonly themeService = inject(ThemeService);
  private readonly i18n = inject(EasyPaymentsI18nService);
  private readonly applePayAdapter = inject(ApplePayAdapter);
  private readonly stripeRedirectRecovery = inject(StripeRedirectRecoveryService);
  private readonly hostContext = inject(CheckoutHostContext);
  private readonly pendingTasks = inject(PendingTasks);
  private readonly ngZone = inject(NgZone);
  private readonly destroyRef = inject(DestroyRef);
  private destroyed = false;

  private readonly availabilitySession = new CheckoutAvailabilitySession();
  private availabilityGeneration = 0;
  /** One in-flight attempt. Prevents duplicate terminal emits. */
  private paymentAttempt: 'idle' | 'active' | 'settled' = 'idle';
  /** Idempotent Klarna/Affirm redirect recovery per host instance. */
  private stripeReturnRecoveryStarted = false;
  /** True while a Stripe BNPL return is pending ownership or being recovered (blocks selection clears). */
  private stripeReturnRecovering = false;
  /** Method of a Stripe BNPL return seen at construction, until ownership is claimed. */
  private stripeReturnMethod: StripeRedirectMethod | null = null;
  private stripeReturnClaimed = false;
  /** A recovered return succeeded: its panel must not create another PaymentIntent. */
  private successAfterReturn = false;

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
        interactive: SELECTOR_SLOT_KINDS.has(kind),
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

  readonly hasAvailableKlarna = computed(() =>
    this.methodSlots().some((slot) => slot.method === 'klarna' && slot.state === 'available'),
  );

  readonly hasAvailableAffirm = computed(() =>
    this.methodSlots().some((slot) => slot.method === 'affirm' && slot.state === 'available'),
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

  readonly selectedKlarnaEntry = computed(() => {
    if (this.selectedMethod() !== 'klarna') {
      return null;
    }
    return (
      this.availableMethods().find((entry) => entry.method === 'klarna' && entry.available) ?? null
    );
  });

  readonly showKlarnaPanel = computed(() => {
    const entry = this.selectedKlarnaEntry();
    return !!entry && !entry.isMock;
  });

  readonly showMockKlarnaPanel = computed(() => {
    const entry = this.selectedKlarnaEntry();
    return !!entry && entry.isMock;
  });

  readonly selectedAffirmEntry = computed(() => {
    if (this.selectedMethod() !== 'affirm') {
      return null;
    }
    return (
      this.availableMethods().find((entry) => entry.method === 'affirm' && entry.available) ?? null
    );
  });

  readonly showAffirmPanel = computed(() => {
    const entry = this.selectedAffirmEntry();
    return !!entry && !entry.isMock;
  });

  readonly showMockAffirmPanel = computed(() => {
    const entry = this.selectedAffirmEntry();
    return !!entry && entry.isMock;
  });

  /**
   * True when at least one configured method is still loading (placeholder, not unavailable).
   */
  readonly foundationOnly = computed(() =>
    this.methodSlots().some((slot) => slot.kind === 'placeholder' && slot.state !== 'unavailable'),
  );

  constructor() {
    this.hostContext.kind = 'buttons';

    // Stripe ECE `ready` often fires outside NgZone — refresh instance availability
    // so apple-pay slots update after wallet eligibility is known. One listener per host.
    const removeApplePayListener = this.applePayAdapter.addAvailabilityListener(() => {
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

    this.destroyRef.onDestroy(() => {
      this.destroyed = true;
      removeApplePayListener();
    });

    // Klarna/Affirm redirect return: hold the UI until the recovery service decides
    // which host on the page owns it. Only the owner recovers and emits.
    if (typeof window !== 'undefined' && isStripeReturnAttempt()) {
      const method = detectStripeReturnMethod() ?? 'klarna';
      this.stripeReturnMethod = method;
      this.stripeReturnRecovering = true;
      this.hostContext.setReturnPhase('pending', method);
      this.updateSelectedMethod(method);
      this.providerBusy.set(true);
    }

    effect(() => {
      const product = this.product();
      const methods = this.methods();
      untracked(() => {
        this.hostContext.setProductId(product.id);
        this.claimStripeReturnOnce(methods);
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

    // Clear selector methods if they leave the allow-list or become unavailable.
    // Skip while busy / BNPL redirect recovery so availability publish cannot steal selection.
    effect(() => {
      const selected = this.selectedMethod();
      if (selected !== 'card' && selected !== 'klarna' && selected !== 'affirm') {
        return;
      }
      if (
        untracked(
          () =>
            this.stripeReturnRecovering ||
            this.providerBusy() ||
            this.processingMethod() !== null,
        )
      ) {
        return;
      }
      const slot = this.methodSlots().find((entry) => entry.method === selected);
      if (!slot || slot.state !== 'available') {
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
    if (!slot || !SELECTOR_SLOT_KINDS.has(slot.kind)) {
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

  onKlarnaStarted(): void {
    this.onPaymentStarted('klarna');
  }

  onKlarnaBusy(busy: boolean): void {
    this.providerBusy.set(busy);
  }

  onKlarnaSuccess(result: PaymentResult): void {
    this.handleSuccess(result);
  }

  onKlarnaCancel(result: PaymentResult): void {
    this.handleCancelled(result);
  }

  onKlarnaError(error: PaymentError): void {
    this.handlePaymentError(error);
  }

  onAffirmStarted(): void {
    this.onPaymentStarted('affirm');
  }

  onAffirmBusy(busy: boolean): void {
    this.providerBusy.set(busy);
  }

  onAffirmSuccess(result: PaymentResult): void {
    this.handleSuccess(result);
  }

  onAffirmCancel(result: PaymentResult): void {
    this.handleCancelled(result);
  }

  onAffirmError(error: PaymentError): void {
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

  async onMockKlarnaPay(): Promise<void> {
    await this.runMockPayment('klarna');
  }

  async onMockAffirmPay(): Promise<void> {
    await this.runMockPayment('affirm');
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
    if (method === 'klarna') {
      return 'klarna-selector';
    }
    if (method === 'affirm') {
      return 'affirm-selector';
    }
    if (method === 'paypal') {
      return isMock ? 'paypal-mock' : 'paypal-express';
    }
    if (method === 'google-pay') {
      return isMock ? 'google-pay-mock' : 'google-pay-express';
    }
    return 'placeholder';
  }

  private claimStripeReturnOnce(methods: readonly PaymentMethod[]): void {
    const method = this.stripeReturnMethod;
    if (!method || this.stripeReturnClaimed) {
      return;
    }
    this.stripeReturnClaimed = true;
    const done = this.pendingTasks.add();
    void this.stripeRedirectRecovery
      .claimReturn(this.hostContext, methods)
      .then(async (claim) => {
        if (this.destroyed) {
          return;
        }
        if (claim === 'owner') {
          this.hostContext.setReturnPhase('owner', method);
          await this.recoverStripeReturn(method);
        } else {
          this.releaseStripeReturn();
        }
      })
      .finally(done);
  }

  /** Another host owns the return (or it was unattributable): resume a normal, idle list. */
  private releaseStripeReturn(): void {
    this.stripeReturnRecovering = false;
    this.stripeReturnMethod = null;
    this.hostContext.setReturnPhase('none');
    this.providerBusy.set(false);
    // The provisional selection was set before outputs were subscribed; revert it silently.
    this.selectedMethod.set(null);
  }

  /**
   * Library-owned Stripe BNPL redirect recovery (Klarna / Affirm).
   * Always leaves busy for a terminal success / cancel / error. Idempotent per host.
   * Does not emit `started` — confirmation already happened before redirect.
   */
  private async recoverStripeReturn(method: StripeRedirectMethod): Promise<void> {
    if (this.stripeReturnRecoveryStarted) {
      return;
    }
    this.stripeReturnRecoveryStarted = true;

    this.updateSelectedMethod(method);
    this.providerBusy.set(true);

    const label = method === 'affirm' ? 'Affirm' : 'Klarna';

    try {
      const result = await this.stripeRedirectRecovery.consumeReturn();
      if (this.destroyed) {
        return;
      }
      if (!result) {
        this.handlePaymentError(
          new PaymentError({
            code: 'PAYMENT_FAILED',
            message: `${label} return could not be verified.`,
            method,
            provider: method,
          }),
        );
        return;
      }

      if (result.status === 'success') {
        this.successAfterReturn = true;
        this.handleSuccess(result);
      } else if (result.status === 'cancelled') {
        this.handleCancelled(result);
      } else {
        this.handlePaymentError(
          new PaymentError({
            code: 'PAYMENT_FAILED',
            message: result.message ?? `${label} payment failed.`,
            method,
            provider: method,
          }),
        );
      }
    } catch (err) {
      if (this.destroyed) {
        return;
      }
      const paymentError = normalizeError(err, { method, provider: method });
      if (paymentError.code === 'PAYMENT_CANCELLED') {
        this.handleCancelled({
          status: 'cancelled',
          method,
          provider: method,
          message: paymentError.message,
        });
      } else {
        this.handlePaymentError(paymentError);
      }
    } finally {
      this.stripeReturnRecovering = false;
      this.stripeReturnMethod = null;
      if (!this.destroyed) {
        this.providerBusy.set(false);
        // After a non-success return the panel may create a fresh PaymentIntent for retry.
        if (!this.successAfterReturn) {
          this.hostContext.setReturnPhase('none');
        }
      }
    }
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
