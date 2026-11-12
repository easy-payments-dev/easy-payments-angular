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
import type {
  EasyPaymentButtonsAppearance,
  EasyPaymentButtonsSelectorLabels,
  EasyPaymentButtonsSelectorVisibility,
} from '../../models/easy-payment-buttons-appearance.model';
import type { EasyPaymentsCardButtonAppearance } from '../../models/easy-payments-card-button-appearance.model';
import type { EasyPaymentsVisualStyle } from '../../models/easy-payments-visual-style.model';
import type { BnplConfirmMode } from '../../models/bnpl-confirm-mode.model';
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
  interpolate,
  toAffirmPreferredLocale,
  toKlarnaPreferredLocale,
  type EasyPaymentsLocale,
  type EasyPaymentsResolvedLocale,
  type EasyPaymentsTranslationOverrides,
} from '../../i18n';
import { EasyPaymentsConfigService } from '../../config/easy-payments-config.service';
import {
  evaluateBnplDirectReadiness,
  type BnplReadinessResult,
} from '../../bnpl/bnpl-direct-readiness';
import { ApplePayAdapter } from '../../adapters/apple-pay/apple-pay.adapter';
import { KlarnaAdapter } from '../../adapters/klarna/klarna.adapter';
import { AffirmAdapter } from '../../adapters/affirm/affirm.adapter';
import { StripeConfirmationGate } from '../../adapters/stripe/stripe-confirmation-gate';
import { StripeRedirectRecoveryService } from '../../adapters/stripe/stripe-redirect-recovery.service';
import {
  buildStripeReturnUrl,
  clearStripePendingReturnFor,
  createStripeReturnAttemptId,
  detectStripeReturnMethod,
  stripeRedirectProvider,
  isStripeReturnAttempt,
  markStripePendingReturn,
  type StripeRedirectMethod,
} from '../../adapters/stripe/stripe-redirect-return';
import { createPaymentOwnerId } from '../../utils/payment-owner-id';
import { validatePaymentProduct } from '../../validators/product.validator';
import { PaymentMethodIconComponent } from '../checkout/payment-method-icon.component';
import { StripeCardPaymentComponent } from '../payment-methods/stripe-card-payment.component';
import { PayPalPaymentComponent } from '../payment-methods/paypal-payment.component';
import { GooglePayPaymentComponent } from '../payment-methods/google-pay-payment.component';
import { ApplePayPaymentComponent } from '../payment-methods/apple-pay-payment.component';
import { KlarnaPaymentComponent } from '../payment-methods/klarna-payment.component';
import { AffirmPaymentComponent } from '../payment-methods/affirm-payment.component';
import { UsBankAccountPaymentComponent } from '../payment-methods/us-bank-account-payment.component';
import { CashAppPayPaymentComponent } from '../payment-methods/cash-app-pay-payment.component';
import { MockMethodPanelComponent } from '../checkout/mock-method-panel.component';
import { UsBankAccountAdapter } from '../../adapters/us-bank-account/us-bank-account.adapter';
import {
  clearAchReturnParamsFromUrl,
  isAchReturnAttempt,
  readAchReturnParams,
} from '../../adapters/us-bank-account/us-bank-account-return';

/** Slot readiness for the method list. */
export type EasyPaymentButtonSlotState = 'loading' | 'available' | 'unavailable';

/**
 * How a method slot is rendered.
 * - `placeholder` — noninteractive (loading or unavailable)
 * - `*-selector` — compact strip selector that reveals the shared panel below
 * - `*-express` — official provider buttons in-slot
 * - `*-mock` — development-only mock wallet strip buttons in-slot
 */
export type EasyPaymentButtonSlotKind =
  | 'placeholder'
  | 'card-selector'
  | 'klarna-selector'
  | 'affirm-selector'
  | 'us-bank-account-selector'
  | 'cash-app-pay-selector'
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
  'us-bank-account-selector',
  'cash-app-pay-selector',
]);

export interface EasyPaymentButtonSlot {
  readonly method: PaymentMethod;
  readonly state: EasyPaymentButtonSlotState;
  readonly isMock: boolean;
  readonly label: string;
  readonly kind: EasyPaymentButtonSlotKind;
  /**
   * True for Card / Klarna / Affirm / US bank account strip selectors.
   * Express mounts are interactive payments but not selectors.
   */
  readonly interactive: boolean;
  /**
   * Visible text next to the mark. Always false when the mark already includes
   * the brand name (Klarna / Affirm). Card / US bank account use a generic icon
   * and show a compact label.
   */
  readonly showVisibleLabel: boolean;
  /** Library brand mark. Ignored by official wallet SDK slots. */
  readonly showBrandIcon: boolean;
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
 * Payment Buttons Only — compact payment strip + shared expanded panel.
 *
 * Wallets (Apple Pay / Google Pay / PayPal) mount official SDK buttons in the strip.
 * Card / Klarna / Affirm / US bank account / Cash App Pay use compact selectors; their secure forms
 * open in one shared region below the entire strip. Mock wallet stand-ins are
 * development-only.
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
    UsBankAccountPaymentComponent,
    CashAppPayPaymentComponent,
    MockMethodPanelComponent,
  ],
  templateUrl: './easy-payment-buttons.component.html',
  styleUrls: [
    './easy-payment-buttons.component.scss',
    './easy-payment-buttons.selector.scss',
  ],
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
    '[attr.data-separators]': 'separatorsEnabled() ? "line" : "none"',
    '[attr.data-card-ready]': 'hasAvailableCard() ? "true" : "false"',
    '[attr.data-paypal-ready]': 'hasAvailablePayPal() ? "true" : "false"',
    '[attr.data-google-pay-ready]': 'hasAvailableGooglePay() ? "true" : "false"',
    '[attr.data-apple-pay-ready]': 'hasAvailableApplePay() ? "true" : "false"',
    '[attr.data-klarna-ready]': 'hasAvailableKlarna() ? "true" : "false"',
    '[attr.data-affirm-ready]': 'hasAvailableAffirm() ? "true" : "false"',
    '[attr.data-us-bank-account-ready]': 'hasAvailableUsBankAccount() ? "true" : "false"',
    '[attr.data-cash-app-pay-ready]': 'hasAvailableCashAppPay() ? "true" : "false"',
    '[attr.data-bnpl-confirm-mode]': 'bnplConfirmMode()',
    '[attr.data-bnpl-direct-active]': 'bnplDirectActive() ? "true" : "false"',
    '[attr.data-selector-visibility]': 'selectorVisibility()',
    '[style.--ep-buttons-selector-bg]': 'selectorBackgroundCss()',
    '[style.--ep-buttons-selector-text]': 'selectorTextCss()',
    '[style.--ep-buttons-selector-font-family]': 'selectorFontFamilyCss()',
    '[style.--ep-buttons-selector-font-size]': 'selectorFontSizeCss()',
    '[style.--ep-buttons-selector-font-weight]': 'selectorFontWeightCss()',
    '[style.--ep-buttons-selector-padding]': 'selectorPaddingCss()',
    '[style.--ep-buttons-selector-hover-bg]': 'selectorHoverBackgroundCss()',
    '[style.--ep-buttons-selector-hover-text]': 'selectorHoverTextCss()',
    '[style.--ep-buttons-selector-hover-border]': 'selectorHoverBorderCss()',
    '[style.--ep-buttons-selector-selected-bg]': 'selectorSelectedBackgroundCss()',
    '[style.--ep-buttons-selector-selected-text]': 'selectorSelectedTextCss()',
    '[style.--ep-buttons-selector-selected-border]': 'selectorSelectedBorderCss()',
    '[style.--ep-buttons-selector-disabled-bg]': 'selectorDisabledBackgroundCss()',
    '[style.--ep-buttons-selector-disabled-text]': 'selectorDisabledTextCss()',
    '[style.--ep-buttons-selector-loading-bg]': 'selectorLoadingBackgroundCss()',
    '[style.--ep-buttons-selector-loading-text]': 'selectorLoadingTextCss()',
    '[style.--ep-buttons-selector-focus-color]': 'selectorFocusOutlineCss()',
    '[style.--ep-font-family]': 'visualStyleCssVars().fontFamily',
    '[style.--ep-text]': 'visualStyleCssVars().textColor',
    '[style.--ep-text-secondary]': 'visualStyleCssVars().textSecondaryColor',
    '[style.--ep-surface]': 'visualStyleCssVars().surfaceColor',
    '[style.--ep-accent]': 'visualStyleCssVars().accentColor',
    '[style.--ep-accent-soft]': 'visualStyleCssVars().accentSoft',
    '[style.--ep-focus]': 'visualStyleCssVars().accentColor',
    '[style.--ep-radius]': 'visualStyleCssVars().borderRadius',
    '[style.--ep-spacing]': 'visualStyleCssVars().spacing',
    '[style.--ep-buttons-gap]': 'buttonsGapCss()',
    '[style.--ep-buttons-padding]': 'buttonsPaddingCss()',
    '[style.--ep-buttons-height]': 'buttonsHeightCss()',
    '[style.--ep-buttons-min-width]': 'buttonsMinWidthCss()',
    '[style.--ep-buttons-width]': 'buttonsWidthCss()',
    '[style.--ep-buttons-slot-width]': 'buttonsSlotWidthCss()',
    '[style.--ep-buttons-radius]': 'buttonsRadiusCss()',
    '[style.--ep-buttons-border-width]': 'buttonsBorderWidthCss()',
    '[style.--ep-buttons-border-color]': 'buttonsBorderColorCss()',
    '[style.--ep-buttons-separator-color]': 'buttonsSeparatorColorCss()',
    '[style.--ep-buttons-strip-bg]': 'buttonsStripBackgroundCss()',
    role: 'region',
    '[attr.aria-label]': 'regionAriaLabel()',
  },
  providers: [EasyPaymentsI18nService, ThemeService, CheckoutHostContext],
})
export class EasyPaymentButtonsComponent {
  private readonly orchestrator = inject(PaymentOrchestratorService);
  private readonly themeService = inject(ThemeService);
  private readonly i18n = inject(EasyPaymentsI18nService);
  private readonly configService = inject(EasyPaymentsConfigService);
  private readonly applePayAdapter = inject(ApplePayAdapter);
  private readonly klarnaAdapter = inject(KlarnaAdapter);
  private readonly affirmAdapter = inject(AffirmAdapter);
  private readonly usBankAccountAdapter = inject(UsBankAccountAdapter);
  private readonly confirmationGate = inject(StripeConfirmationGate);
  private readonly stripeRedirectRecovery = inject(StripeRedirectRecoveryService);
  private readonly hostContext = inject(CheckoutHostContext);
  private readonly pendingTasks = inject(PendingTasks);
  private readonly ngZone = inject(NgZone);
  private readonly destroyRef = inject(DestroyRef);
  private destroyed = false;
  private readonly klarnaDirectOwnerId = createPaymentOwnerId('klarna-direct');
  private readonly affirmDirectOwnerId = createPaymentOwnerId('affirm-direct');
  private directAttemptGeneration = 0;
  /**
   * Page-level mutex for Buttons Only Direct Intent create+confirm.
   * Prevents parallel Klarna/Affirm Direct attempts across multiple hosts
   * before `StripeConfirmationGate` is acquired inside the adapter.
   */
  private static directPageLock: string | null = null;

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
  /** Host-owned ACH return recovery (retrieve only — never a second confirm). */
  private achReturnRecovering = false;
  private achReturnClaimed = false;
  private achReturnRecoveryStarted = false;
  /** After host ACH return settles, keep the PE panel unmounted (no new Intent). */
  private achReturnComplete = false;

  readonly product = input.required<PaymentProduct>();
  readonly methods = input<PaymentMethod[]>(DEFAULT_BUTTON_METHODS);
  readonly checkout = input<CheckoutOptions>();
  /**
   * Optional stable id for this buttons host on pages with several instances.
   * Used to attribute Stripe Klarna/Affirm redirect returns after reload or reorder.
   * Omit on single-host pages. Values: 1–64 chars `[a-zA-Z0-9_.:-]`.
   */
  readonly checkoutInstanceId = input<string | null>(null);
  /** Method row orientation. Order always follows `[methods]`. */
  readonly layout = input<EasyPaymentButtonsLayout>('vertical');
  readonly theme = input<PaymentTheme>('system');
  readonly locale = input<EasyPaymentsLocale>('auto');
  readonly translations = input<EasyPaymentsTranslationOverrides>({});
  /**
   * Optional EP-owned token overrides for list chrome.
   * Host background remains permanently transparent regardless of `backgroundColor`.
   * Use `[buttonsAppearance].background` for an optional strip fill.
   */
  readonly visualStyle = input<EasyPaymentsVisualStyle | null>(null);
  /**
   * Optional strip presentation (gap, separators, borders, radius, dimensions).
   * Defaults to a transparent compact payment strip.
   */
  readonly buttonsAppearance = input<EasyPaymentButtonsAppearance | null>(null);
  /**
   * Optional Easy Payments–owned Card / ACH confirmation CTA presentation
   * (label, colors, typography, border, size, hover/disabled/loading/focus).
   * Independent of `[buttonsAppearance]` (strip chrome). Does not restyle the
   * Stripe Payment Element iframe or official wallet SDK buttons.
   * For ACH with `selectorVisibility="merchant"`, keep a single submit control:
   * host CTA calls {@link requestPayment}('us-bank-account') to open the panel;
   * the library Pay button inside the panel remains the only confirm control.
   */
  readonly cardButtonAppearance = input<EasyPaymentsCardButtonAppearance | null>(null);
  /**
   * Klarna/Affirm confirmation strategy for Buttons Only only.
   * Default `element` preserves Payment Element + Continue for existing merchants.
   * Opt in to `auto` / `direct` for one-click Stripe Direct when checkout customer
   * data satisfies {@link evaluateBnplDirectReadiness}.
   */
  readonly bnplConfirmMode = input<BnplConfirmMode>('element');
  /**
   * `library` (default) renders Easy Payments Card / Klarna / Affirm / ACH selectors.
   * `merchant` hides those selectors so the host app calls {@link requestPayment}.
   * PayPal, Google Pay, and Apple Pay stay official SDK buttons either way.
   */
  readonly selectorVisibility = input<EasyPaymentButtonsSelectorVisibility>('library');

  readonly started = output<PaymentStartedEvent>();
  readonly methodChange = output<PaymentMethodChangeEvent>();
  readonly success = output<PaymentResult>();
  readonly cancel = output<PaymentResult>();
  readonly error = output<PaymentError>();
  /**
   * Fired when a PaymentIntent is still `processing` (not yet succeeded or failed).
   * Not a success and not a definitive failure. Do not retry; await backend/webhook.
   */
  readonly pending = output<PaymentResult>();

  readonly resolvedTheme = this.themeService.resolvedTheme;
  readonly effectiveLocale = this.i18n.effectiveLocale;
  readonly availableMethods = this.availabilitySession.availableMethods;
  readonly availabilityPublished = this.availabilitySession.availabilityPublished;
  readonly loading = this.orchestrator.loading;

  readonly selectedMethod = signal<PaymentMethod | null>(null);
  readonly providerBusy = signal(false);
  readonly processingMethod = signal<PaymentMethod | null>(null);
  /** True while Buttons Only is running (or has locked) a Direct BNPL attempt — suppresses PE panels. */
  readonly bnplDirectActive = signal(false);

  readonly visualStyleCssVars = computed(() => resolveVisualStyleCssVars(this.visualStyle()));
  readonly msgs = computed(() => this.i18n.messages());

  readonly regionAriaLabel = computed(() => {
    const msgs = this.msgs();
    return msgs.paymentMethodSelectionAria || 'Payment methods';
  });

  readonly separatorsEnabled = computed(
    () => (this.buttonsAppearance()?.separators ?? 'none') === 'line',
  );

  readonly borderlessSelectors = computed(
    () => (this.buttonsAppearance()?.border ?? 'default') === 'none',
  );

  readonly buttonsGapCss = computed(
    () =>
      this.buttonsAppearance()?.gap ??
      this.visualStyleCssVars().spacing ??
      '8px',
  );

  readonly buttonsPaddingCss = computed(
    () => this.buttonsAppearance()?.padding ?? '0px',
  );

  readonly buttonsHeightCss = computed(
    () => this.buttonsAppearance()?.buttonHeight ?? '40px',
  );

  readonly buttonsMinWidthCss = computed(
    () => this.buttonsAppearance()?.buttonMinWidth ?? '100px',
  );

  readonly buttonsWidthCss = computed(
    () => this.buttonsAppearance()?.buttonWidth ?? '100%',
  );

  /** Horizontal slot width; `null` keeps the stylesheet default. */
  readonly buttonsSlotWidthCss = computed(() => {
    const width = this.buttonsAppearance()?.buttonWidth?.trim();
    return width && width !== '100%' && width !== 'auto' ? width : null;
  });

  readonly buttonsRadiusCss = computed(
    () =>
      this.buttonsAppearance()?.borderRadius ??
      this.visualStyleCssVars().borderRadius ??
      null,
  );

  readonly buttonsBorderWidthCss = computed(() => {
    if (this.borderlessSelectors()) {
      return '0px';
    }
    return this.buttonsAppearance()?.borderWidth ?? '1px';
  });

  readonly buttonsBorderColorCss = computed(
    () => this.buttonsAppearance()?.borderColor ?? null,
  );

  readonly buttonsSeparatorColorCss = computed(
    () => this.buttonsAppearance()?.separatorColor ?? null,
  );

  readonly buttonsStripBackgroundCss = computed(() => {
    const bg = this.buttonsAppearance()?.background;
    if (bg == null || bg === 'transparent') {
      return 'transparent';
    }
    return bg;
  });

  readonly selectorBackgroundCss = computed(() =>
    cssToken(this.buttonsAppearance()?.selectorBackgroundColor),
  );
  readonly selectorTextCss = computed(() => cssToken(this.buttonsAppearance()?.selectorTextColor));
  readonly selectorFontFamilyCss = computed(() =>
    cssToken(this.buttonsAppearance()?.selectorFontFamily, 120),
  );
  readonly selectorFontSizeCss = computed(() => cssToken(this.buttonsAppearance()?.selectorFontSize));
  readonly selectorFontWeightCss = computed(() =>
    cssToken(this.buttonsAppearance()?.selectorFontWeight),
  );
  readonly selectorPaddingCss = computed(() => cssToken(this.buttonsAppearance()?.selectorPadding));
  readonly selectorHoverBackgroundCss = computed(() =>
    cssToken(this.buttonsAppearance()?.selectorHoverBackgroundColor),
  );
  readonly selectorHoverTextCss = computed(() =>
    cssToken(this.buttonsAppearance()?.selectorHoverTextColor),
  );
  readonly selectorHoverBorderCss = computed(() =>
    cssToken(this.buttonsAppearance()?.selectorHoverBorderColor),
  );
  readonly selectorSelectedBackgroundCss = computed(() =>
    cssToken(this.buttonsAppearance()?.selectorSelectedBackgroundColor),
  );
  readonly selectorSelectedTextCss = computed(() =>
    cssToken(this.buttonsAppearance()?.selectorSelectedTextColor),
  );
  readonly selectorSelectedBorderCss = computed(() =>
    cssToken(this.buttonsAppearance()?.selectorSelectedBorderColor),
  );
  readonly selectorDisabledBackgroundCss = computed(() =>
    cssToken(this.buttonsAppearance()?.selectorDisabledBackgroundColor),
  );
  readonly selectorDisabledTextCss = computed(() =>
    cssToken(this.buttonsAppearance()?.selectorDisabledTextColor),
  );
  readonly selectorLoadingBackgroundCss = computed(() =>
    cssToken(this.buttonsAppearance()?.selectorLoadingBackgroundColor),
  );
  readonly selectorLoadingTextCss = computed(() =>
    cssToken(this.buttonsAppearance()?.selectorLoadingTextColor),
  );
  readonly selectorFocusOutlineCss = computed(() =>
    cssToken(this.buttonsAppearance()?.selectorFocusOutlineColor),
  );

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
    const msgs = this.msgs();

    return requested.map((method) => {
      const entry = availability.find((item) => item.method === method);
      let state: EasyPaymentButtonSlotState = 'loading';
      if (published) {
        state = entry?.available ? 'available' : 'unavailable';
      }
      const isMock = entry?.isMock ?? false;
      const kind = this.resolveSlotKind(method, state, isMock);
      const presentation = getPaymentMethodPresentation(method, theme);
      const brandLabel = presentation.label || PAYMENT_METHOD_LABELS[method];
      const customLabel = selectorLabel(this.buttonsAppearance()?.selectorLabels, method);
      // Card / ACH use library-owned copy; wallet brand names stay provider trademarks.
      const label =
        customLabel ??
        (method === 'card'
          ? msgs.methodCard
          : method === 'us-bank-account'
            ? msgs.methodUsBankAccount
            : method === 'cash-app-pay'
              ? msgs.methodCashAppPay
              : brandLabel);
      // Brand marks already name the provider — never duplicate visible text.
      // Card / ACH generic icons do not include the name; show a compact label
      // so the selector stays visible in light/dark and selected states.
      // Brand marks that already name the provider (Klarna / Affirm) omit duplicate text.
      // Card / ACH / Cash App Pay keep a compact label (Cash App badge is the $ plate only).
      const showVisibleLabel =
        method === 'card' ||
        method === 'us-bank-account' ||
        method === 'cash-app-pay' ||
        customLabel != null;
      const showBrandIcon = this.buttonsAppearance()?.showSelectorIcon !== false;
      return {
        method,
        state,
        isMock,
        label,
        kind,
        interactive: SELECTOR_SLOT_KINDS.has(kind),
        showVisibleLabel,
        showBrandIcon,
      };
    });
  });

  /**
   * Methods followed by a separator. Unavailable slots are collapsed, so a
   * separator only sits between two visible slots.
   */
  readonly separatorAfter = computed<ReadonlySet<PaymentMethod>>(() => {
    const visible = this.methodSlots().filter((slot) => slot.state !== 'unavailable');
    return new Set(visible.slice(0, -1).map((slot) => slot.method));
  });

  /** Availability is known and no requested method can be shown. */
  readonly noMethodsAvailable = computed(
    () =>
      this.availabilityPublished() &&
      this.methodSlots().every((slot) => slot.state === 'unavailable'),
  );

  /** One notice above the strip when any mock stand-in is present (not per-button). */
  readonly showDemoModeNotice = computed(() =>
    this.methodSlots().some((slot) => slot.isMock && slot.state === 'available'),
  );

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

  readonly hasAvailableUsBankAccount = computed(() =>
    this.methodSlots().some(
      (slot) => slot.method === 'us-bank-account' && slot.state === 'available',
    ),
  );

  readonly hasAvailableCashAppPay = computed(() =>
    this.methodSlots().some(
      (slot) => slot.method === 'cash-app-pay' && slot.state === 'available',
    ),
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
    return !!entry && !entry.isMock && this.shouldShowBnplElementPanel('klarna');
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
    return !!entry && !entry.isMock && this.shouldShowBnplElementPanel('affirm');
  });

  readonly showMockAffirmPanel = computed(() => {
    const entry = this.selectedAffirmEntry();
    return !!entry && entry.isMock;
  });

  readonly selectedUsBankAccountEntry = computed(() => {
    if (this.selectedMethod() !== 'us-bank-account') {
      return null;
    }
    return (
      this.availableMethods().find(
        (entry) => entry.method === 'us-bank-account' && entry.available,
      ) ?? null
    );
  });

  readonly showUsBankAccountPanel = computed(() => {
    // Host-owned ACH return: recover via retrieve only; do not remount PE / create Intent.
    if (this.achReturnRecovering || this.achReturnComplete) {
      return false;
    }
    if (this.selectedMethod() !== 'us-bank-account') {
      return false;
    }
    const entry =
      this.availableMethods().find((item) => item.method === 'us-bank-account') ?? null;
    if (entry?.isMock) {
      return false;
    }
    if (entry?.available) {
      return true;
    }
    // Keep the confirming panel alive across availability flaps.
    return this.providerBusy() || this.processingMethod() === 'us-bank-account';
  });

  readonly showMockUsBankAccountPanel = computed(() => {
    if (this.achReturnRecovering || this.achReturnComplete) {
      return false;
    }
    const entry = this.selectedUsBankAccountEntry();
    return !!entry && entry.isMock;
  });

  readonly selectedCashAppPayEntry = computed(() => {
    if (this.selectedMethod() !== 'cash-app-pay') {
      return null;
    }
    return (
      this.availableMethods().find(
        (entry) => entry.method === 'cash-app-pay' && entry.available,
      ) ?? null
    );
  });

  readonly showCashAppPayPanel = computed(() => {
    const entry = this.selectedCashAppPayEntry();
    return !!entry && !entry.isMock;
  });

  readonly showMockCashAppPayPanel = computed(() => {
    const entry = this.selectedCashAppPayEntry();
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
      this.directAttemptGeneration += 1;
      if (
        EasyPaymentButtonsComponent.directPageLock === this.klarnaDirectOwnerId ||
        EasyPaymentButtonsComponent.directPageLock === this.affirmDirectOwnerId
      ) {
        EasyPaymentButtonsComponent.directPageLock = null;
      }
      void this.klarnaAdapter.destroy(this.klarnaDirectOwnerId);
      void this.affirmAdapter.destroy(this.affirmDirectOwnerId);
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
    } else if (typeof window !== 'undefined' && isAchReturnAttempt()) {
      // ACH return: host recovers via retrievePaymentIntent (no second confirm).
      this.achReturnRecovering = true;
      this.updateSelectedMethod('us-bank-account');
      this.providerBusy.set(true);
      this.paymentAttempt = 'active';
    }

    effect(() => {
      const product = this.product();
      const methods = this.methods();
      const checkoutInstanceId = this.checkoutInstanceId();
      untracked(() => {
        this.hostContext.setCheckoutInstanceId(checkoutInstanceId);
        this.hostContext.setProductId(product.id);
        this.claimStripeReturnOnce(methods);
        this.claimAchReturnOnce(methods);
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
      if (
        selected !== 'card' &&
        selected !== 'klarna' &&
        selected !== 'affirm' &&
        selected !== 'us-bank-account' &&
        selected !== 'cash-app-pay'
      ) {
        return;
      }
      if (
        untracked(
          () =>
            this.stripeReturnRecovering ||
            this.achReturnRecovering ||
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

  /** Merchant-owned mode hides library Card / Klarna / Affirm / ACH triggers. Wallets stay visible. */
  merchantOwnsSelector(slot: EasyPaymentButtonSlot): boolean {
    return this.selectorVisibility() === 'merchant' && slot.interactive;
  }

  /**
   * Custom disabled/loading fills apply only when the merchant set them.
   * Otherwise the default selected fill and opacity stay in place.
   */
  selectorStateBackground(method: PaymentMethod): string | null {
    if (this.processingMethod() === method && this.selectorLoadingBackgroundCss()) {
      return this.selectorLoadingBackgroundCss();
    }
    if (this.methodsLocked() && this.selectorDisabledBackgroundCss()) {
      return this.selectorDisabledBackgroundCss();
    }
    return null;
  }

  selectorStateColor(method: PaymentMethod): string | null {
    if (this.processingMethod() === method && this.selectorLoadingTextCss()) {
      return this.selectorLoadingTextCss();
    }
    if (this.methodsLocked() && this.selectorDisabledTextCss()) {
      return this.selectorDisabledTextCss();
    }
    return null;
  }

  slotAriaLabel(slot: EasyPaymentButtonSlot): string {
    const base = slot.label;
    const msgs = this.msgs();
    if (slot.state === 'loading') {
      return `${base}, ${msgs.methodLoadingStatus}`;
    }
    if (slot.state === 'unavailable') {
      return `${base}, ${msgs.methodUnavailableStatus}`;
    }
    if (slot.kind === 'paypal-express') {
      return msgs.paypalCheckoutAria;
    }
    if (slot.kind === 'google-pay-express') {
      return msgs.googlePayCheckoutAria;
    }
    if (slot.kind === 'apple-pay-express') {
      return msgs.applePayCheckoutAria;
    }
    if (
      slot.kind === 'paypal-mock' ||
      slot.kind === 'google-pay-mock' ||
      slot.kind === 'apple-pay-mock'
    ) {
      return interpolate(msgs.demoWalletButtonAria, { method: base });
    }
    if (!slot.interactive) {
      return `${base}, ${msgs.methodUnavailableStatus}`;
    }
    if (this.selectedMethod() === slot.method) {
      return `${base}, selected`;
    }
    return base;
  }

  /**
   * Merchant-owned trigger for Card, Klarna, Affirm, and US bank account.
   * Runs only when the host application calls it from a user action.
   * PayPal, Google Pay, and Apple Pay are refused: those methods stay on official SDK buttons.
   */
  requestPayment(method: PaymentMethod): void {
    if (this.destroyed) {
      return;
    }
    if (method === 'paypal' || method === 'google-pay' || method === 'apple-pay') {
      this.error.emit(
        new PaymentError({
          code: 'CONFIG_INVALID',
          message:
            'PayPal, Google Pay, and Apple Pay require their official SDK buttons. Merchant HTML cannot start these methods.',
          method,
        }),
      );
      return;
    }
    if (
      method !== 'card' &&
      method !== 'klarna' &&
      method !== 'affirm' &&
      method !== 'us-bank-account' &&
      method !== 'cash-app-pay'
    ) {
      this.error.emit(
        new PaymentError({
          code: 'CONFIG_INVALID',
          message: `Unsupported payment method "${String(method)}".`,
          method,
        }),
      );
      return;
    }
    if (this.methodsLocked()) {
      return;
    }
    if (!this.canRequestPayment(method)) {
      this.error.emit(
        new PaymentError({
          code: 'PROVIDER_UNAVAILABLE',
          message: `${method} is not available for this checkout.`,
          method,
        }),
      );
      return;
    }
    this.selectMethod(method);
  }

  /** True when a merchant click may call {@link requestPayment} for this method. */
  canRequestPayment(method: PaymentMethod): boolean {
    if (this.destroyed || this.methodsLocked()) {
      return false;
    }
    if (
      method !== 'card' &&
      method !== 'klarna' &&
      method !== 'affirm' &&
      method !== 'us-bank-account' &&
      method !== 'cash-app-pay'
    ) {
      return false;
    }
    const slot = this.methodSlots().find((entry) => entry.method === method);
    return !!slot && slot.state === 'available' && SELECTOR_SLOT_KINDS.has(slot.kind);
  }

  selectMethod(method: PaymentMethod): void {
    if (this.methodsLocked() || this.destroyed) {
      return;
    }
    const slot = this.methodSlots().find((entry) => entry.method === method);
    if (!slot || !SELECTOR_SLOT_KINDS.has(slot.kind)) {
      return;
    }

    if (
      (method === 'klarna' || method === 'affirm') &&
      slot.state === 'available' &&
      !slot.isMock &&
      this.beginBnplSelectorClick(method)
    ) {
      return;
    }

    this.bnplDirectActive.set(false);
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

  onUsBankAccountStarted(): void {
    this.onPaymentStarted('us-bank-account');
  }

  onUsBankAccountBusy(busy: boolean): void {
    this.providerBusy.set(busy);
  }

  onUsBankAccountSuccess(result: PaymentResult): void {
    this.handleSuccess(result);
  }

  onUsBankAccountCancel(result: PaymentResult): void {
    this.handleCancelled(result);
  }

  onUsBankAccountError(error: PaymentError): void {
    this.handlePaymentError(error);
  }

  onCashAppPayStarted(): void {
    this.onPaymentStarted('cash-app-pay');
  }

  onCashAppPayBusy(busy: boolean): void {
    this.providerBusy.set(busy);
  }

  onCashAppPaySuccess(result: PaymentResult): void {
    this.handleSuccess(result);
  }

  onCashAppPayCancel(result: PaymentResult): void {
    this.handleCancelled(result);
  }

  onCashAppPayError(error: PaymentError): void {
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

  async onMockUsBankAccountPay(): Promise<void> {
    await this.runMockPayment('us-bank-account');
  }

  async onMockCashAppPayPay(): Promise<void> {
    await this.runMockPayment('cash-app-pay');
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
    if (method === 'us-bank-account') {
      return 'us-bank-account-selector';
    }
    if (method === 'cash-app-pay') {
      return 'cash-app-pay-selector';
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

  /**
   * Host-owned ACH return: retrieve the same PaymentIntent only.
   * Never creates or confirms a second payment.
   */
  private claimAchReturnOnce(methods: readonly PaymentMethod[]): void {
    if (!this.achReturnRecovering || this.achReturnClaimed) {
      return;
    }
    this.achReturnClaimed = true;
    if (!methods.includes('us-bank-account')) {
      this.achReturnRecovering = false;
      this.providerBusy.set(false);
      this.paymentAttempt = 'idle';
      this.handlePaymentError(
        new PaymentError({
          code: 'PROVIDER_UNAVAILABLE',
          message: 'US bank account is not enabled for this checkout return.',
          method: 'us-bank-account',
          provider: 'usBankAccount',
        }),
      );
      return;
    }
    const done = this.pendingTasks.add();
    void this.recoverAchReturn().finally(done);
  }

  private async recoverAchReturn(): Promise<void> {
    if (this.achReturnRecoveryStarted) {
      return;
    }
    this.achReturnRecoveryStarted = true;
    this.updateSelectedMethod('us-bank-account');
    this.providerBusy.set(true);

    try {
      const { clientSecret } = readAchReturnParams();
      clearAchReturnParamsFromUrl();
      if (!clientSecret) {
        this.handlePaymentError(
          new PaymentError({
            code: 'PAYMENT_FAILED',
            message: 'US bank account return could not be verified.',
            method: 'us-bank-account',
            provider: 'usBankAccount',
          }),
        );
        return;
      }

      const result = await this.usBankAccountAdapter.recoverReturningPayment(clientSecret);
      if (this.destroyed) {
        return;
      }
      if (result.status === 'success' || result.status === 'processing') {
        // Avoid remounting PE after a verified return (would create a new Intent).
        this.achReturnComplete = true;
        this.handleSuccess(result);
      } else if (result.status === 'cancelled') {
        this.handleCancelled(result);
      } else {
        this.handlePaymentError(
          new PaymentError({
            code: 'PAYMENT_FAILED',
            message: result.message ?? 'US bank account payment failed.',
            method: 'us-bank-account',
            provider: 'usBankAccount',
          }),
        );
      }
    } catch (err) {
      if (this.destroyed) {
        return;
      }
      this.handlePaymentError(
        normalizeError(err, {
          method: 'us-bank-account',
          provider: 'usBankAccount',
        }),
      );
    } finally {
      this.achReturnRecovering = false;
      if (!this.destroyed) {
        this.providerBusy.set(false);
      }
    }
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

    const label =
      method === 'affirm' ? 'Affirm' : method === 'cash-app-pay' ? 'Cash App Pay' : 'Klarna';
    const provider = stripeRedirectProvider(method);

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
            provider,
          }),
        );
        return;
      }

      if (result.status === 'success' || result.status === 'processing') {
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
            provider,
          }),
        );
      }
    } catch (err) {
      if (this.destroyed) {
        return;
      }
      const paymentError = normalizeError(err, { method, provider });
      if (paymentError.code === 'PAYMENT_CANCELLED') {
        this.handleCancelled({
          status: 'cancelled',
          method,
          provider,
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
        if (this.successAfterReturn) {
          // Keep the panel from creating a new PaymentIntent, but clear active-submit UX.
          // `processingMethod` remains set only for genuine pending (awaiting provider).
          if (this.processingMethod() !== null) {
            this.hostContext.setReturnPhase('awaiting', method);
          } else {
            this.hostContext.setReturnPhase('settled', method);
          }
        } else {
          // Cancel / error: allow the panel to create a fresh PaymentIntent for retry.
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
      if (result.status === 'success' || result.status === 'processing') {
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
      // Pending settles with paymentAttempt='settled' and keeps processingMethod locked
      // so the host cannot start another payment. Success / cancel / error already cleared it.
      if (!this.destroyed && this.paymentAttempt !== 'settled') {
        this.processingMethod.set(null);
      }
    }
  }

  private onPaymentStarted(method: PaymentMethod): void {
    if (this.destroyed || this.paymentAttempt === 'active') {
      return;
    }
    // Allow a new attempt after ACH success (settled) or a fresh idle host.
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
    if (result.status === 'processing') {
      this.handlePending(result);
      return;
    }
    if (!this.acceptTerminalEvent()) {
      return;
    }
    this.providerBusy.set(false);
    this.processingMethod.set(null);
    this.bnplDirectActive.set(false);
    this.success.emit(result);
    // ACH: stay settled so a late panel emit cannot duplicate success.
    // A later started attempt can still move idle→active via onPaymentStarted.
    this.paymentAttempt = result.method === 'us-bank-account' ? 'settled' : 'idle';
    this.closeUsBankAccountPanelAfterSettled(result.method);
  }

  /** Asynchronous pending PaymentIntent — lock retry; do not emit success or error. */
  private handlePending(result: PaymentResult): void {
    if (!this.acceptTerminalEvent()) {
      return;
    }
    this.providerBusy.set(false);
    // Keep processingMethod set so methodsLocked stays true (no retry / double charge).
    this.processingMethod.set(result.method);
    this.pending.emit(result);
    // ACH Buttons Only: host owns outcome UI — close the PE panel; lock remains.
    this.closeUsBankAccountPanelAfterSettled(result.method);
  }

  /**
   * After a verified ACH pending/success, collapse the expanded panel so the
   * consumer decides messaging/navigation. Pending keeps {@link methodsLocked}.
   */
  private closeUsBankAccountPanelAfterSettled(method: PaymentMethod): void {
    if (method !== 'us-bank-account') {
      return;
    }
    if (this.selectedMethod() === 'us-bank-account') {
      this.updateSelectedMethod(null);
    }
  }

  private handleCancelled(result: PaymentResult): void {
    if (!this.acceptTerminalEvent()) {
      return;
    }
    this.providerBusy.set(false);
    this.processingMethod.set(null);
    this.bnplDirectActive.set(false);
    this.cancel.emit(result);
    this.paymentAttempt = 'idle';
  }

  private handlePaymentError(error: PaymentError): void {
    if (!this.acceptTerminalEvent()) {
      return;
    }
    this.providerBusy.set(false);
    this.processingMethod.set(null);
    this.bnplDirectActive.set(false);
    this.error.emit(error);
    this.paymentAttempt = 'idle';
  }

  /**
   * Payment Element panels are shown for `element` / `auto` fallback only.
   * `direct` never mounts PE (config error or one-click Direct).
   */
  private shouldShowBnplElementPanel(_provider: 'klarna' | 'affirm'): boolean {
    if (this.bnplDirectActive()) {
      return false;
    }
    return this.bnplConfirmMode() !== 'direct';
  }

  /**
   * Klarna/Affirm selector click: Direct, PE fallback, or configuration error.
   * @returns true when the click was fully handled (caller must not open PE).
   */
  private beginBnplSelectorClick(method: 'klarna' | 'affirm'): boolean {
    const mode = this.bnplConfirmMode();
    if (mode === 'element') {
      return false;
    }

    const readiness = evaluateBnplDirectReadiness({
      provider: method,
      mode,
      checkout: this.checkout(),
    });

    if (readiness.selectedFlow === 'element') {
      return false;
    }

    if (readiness.selectedFlow === 'configuration-error') {
      this.bnplDirectActive.set(false);
      this.updateSelectedMethod(method);
      this.emitBnplDirectConfigurationError(method, readiness);
      return true;
    }

    void this.runBnplDirectPayment(method);
    return true;
  }

  private emitBnplDirectConfigurationError(
    method: 'klarna' | 'affirm',
    readiness: BnplReadinessResult,
  ): void {
    const label = method === 'affirm' ? 'Affirm' : 'Klarna';
    const reasons = readiness.reasonCodes.join(', ');
    const fields = readiness.missingFields.join(', ');
    const detailParts = [
      reasons ? `reasons=${reasons}` : null,
      fields ? `fields=${fields}` : null,
    ].filter((part): part is string => !!part);

    this.handlePaymentError(
      new PaymentError({
        code: 'CONFIG_INVALID',
        message: `${label} Direct confirmation is not ready (${detailParts.join('; ')}).`,
        method,
        provider: method,
        originalError: {
          selectedFlow: readiness.selectedFlow,
          reasonCodes: readiness.reasonCodes,
          missingFields: readiness.missingFields,
        },
      }),
    );
  }

  private async runBnplDirectPayment(method: 'klarna' | 'affirm'): Promise<void> {
    if (this.methodsLocked() || this.destroyed || this.stripeReturnRecovering) {
      return;
    }

    const ownerId =
      method === 'klarna' ? this.klarnaDirectOwnerId : this.affirmDirectOwnerId;
    const adapter = method === 'klarna' ? this.klarnaAdapter : this.affirmAdapter;
    const product = this.product();
    const checkout = this.checkout();
    const validation = validatePaymentProduct(product);
    if (!validation.valid) {
      this.updateSelectedMethod(method);
      this.handlePaymentError(
        new PaymentError({
          code: 'PRODUCT_INVALID',
          message: validation.errors.join(' '),
          method,
          provider: method,
        }),
      );
      return;
    }

    if (
      this.confirmationGate.isHeld() ||
      EasyPaymentButtonsComponent.directPageLock !== null
    ) {
      // Do not select the method — that would mount Payment Element and create another Intent.
      this.handlePaymentError(
        new PaymentError({
          code: 'PROVIDER_UNAVAILABLE',
          message:
            'Another payment is already being confirmed on this page. Wait for it to finish, then try again.',
          method,
          provider: method,
        }),
      );
      return;
    }

    EasyPaymentButtonsComponent.directPageLock = ownerId;

    // Lock before any await so double-clicks and alternating BNPL clicks cannot race.
    this.bnplDirectActive.set(true);
    this.updateSelectedMethod(method);
    this.processingMethod.set(method);
    this.providerBusy.set(true);
    this.onPaymentStarted(method);

    const generation = ++this.directAttemptGeneration;
    const attemptId = createStripeReturnAttemptId();
    let intentCreated = false;
    let confirmStarted = false;

    try {
      await adapter.ensureStripeLoaded();
      if (this.destroyed || generation !== this.directAttemptGeneration) {
        return;
      }

      const preferredLocale = this.resolveBnplPreferredLocale(method);
      const session = await adapter.createPaymentSession(
        product,
        checkout,
        preferredLocale,
        ownerId,
      );
      if (this.destroyed || generation !== this.directAttemptGeneration) {
        return;
      }
      intentCreated = true;

      // Stamp ownership only when this host is allowed to confirm (mirrors PE Continue).
      if (!this.confirmationGate.isHeld()) {
        markStripePendingReturn(
          method,
          product.id,
          undefined,
          this.hostContext.describeReturnOrigin(attemptId),
        );
      }

      const returnUrl = buildStripeReturnUrl(
        method,
        checkout?.successUrl,
        undefined,
        attemptId,
      );

      confirmStarted = true;
      const result = await adapter.confirmDirectPayment(
        {
          clientSecret: session.clientSecret,
          returnUrl,
          customer: checkout?.customer,
          shipping: checkout?.shipping,
        },
        ownerId,
      );

      // Redirect-based BNPL typically unloads before this resolves. When it does resolve,
      // clear our marker and emit the terminal outcome (never treat initiation as success).
      clearStripePendingReturnFor(attemptId);
      if (this.destroyed || generation !== this.directAttemptGeneration) {
        return;
      }

      if (result.status === 'success' || result.status === 'processing') {
        this.handleSuccess(result);
      } else if (result.status === 'cancelled') {
        this.handleCancelled(result);
      } else {
        this.handlePaymentError(
          new PaymentError({
            code: 'PAYMENT_FAILED',
            message: result.message ?? `${method === 'affirm' ? 'Affirm' : 'Klarna'} payment failed.`,
            method,
            provider: method,
          }),
        );
      }
    } catch (err) {
      clearStripePendingReturnFor(attemptId);
      if (this.destroyed || generation !== this.directAttemptGeneration) {
        return;
      }

      const paymentError = normalizeError(err, { method, provider: method });

      // Ambiguous: Intent created and confirm was invoked, but outcome is unclear (e.g. network).
      // Do not auto-retry or fall back to PE. Keep methods locked for merchant-driven recovery.
      if (
        intentCreated &&
        confirmStarted &&
        (paymentError.code === 'NETWORK_ERROR' || paymentError.code === 'UNKNOWN')
      ) {
        this.providerBusy.set(false);
        if (this.acceptTerminalEvent()) {
          this.error.emit(paymentError);
          // Keep processingMethod so a second click cannot create another Intent.
          this.paymentAttempt = 'settled';
        }
        return;
      }

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
      if (!this.destroyed && generation === this.directAttemptGeneration) {
        this.providerBusy.set(false);
        // Definitive cancel/error clears processingMethod inside handlers; ambiguous keeps it.
        if (this.paymentAttempt === 'idle') {
          this.bnplDirectActive.set(false);
          if (this.processingMethod() === method) {
            this.processingMethod.set(null);
          }
          // Clear selection so Payment Element cannot mount and create a new Intent
          // after a completed Direct attempt on this host.
          if (this.selectedMethod() === method) {
            this.updateSelectedMethod(null);
          }
        }
      }
      // Keep the page lock after ambiguous confirm outcomes so no host creates another Intent.
      const retainLockForAmbiguous =
        this.paymentAttempt === 'settled' && this.processingMethod() === method;
      if (
        !retainLockForAmbiguous &&
        EasyPaymentButtonsComponent.directPageLock === ownerId
      ) {
        EasyPaymentButtonsComponent.directPageLock = null;
      }
    }
  }

  private resolveBnplPreferredLocale(method: 'klarna' | 'affirm'): string {
    const locale = this.effectiveLocale() as EasyPaymentsResolvedLocale;
    const snapshot = this.configService.getSnapshot();
    if (method === 'klarna') {
      const klarna = snapshot.providers?.klarna;
      const configured = klarna?.locale?.trim();
      if (configured) {
        return configured;
      }
      return toKlarnaPreferredLocale(locale, klarna?.purchaseCountry ?? 'US');
    }
    const affirm = snapshot.providers?.affirm;
    const configured = affirm?.locale?.trim();
    if (configured) {
      return configured;
    }
    return toAffirmPreferredLocale(locale, affirm?.purchaseCountry ?? 'US');
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

function selectorLabel(
  labels: EasyPaymentButtonsSelectorLabels | undefined,
  method: PaymentMethod,
): string | null {
  if (
    !labels ||
    (method !== 'card' &&
      method !== 'klarna' &&
      method !== 'affirm' &&
      method !== 'us-bank-account' &&
      method !== 'cash-app-pay')
  ) {
    return null;
  }
  const key =
    method === 'us-bank-account'
      ? 'usBankAccount'
      : method === 'cash-app-pay'
        ? 'cashAppPay'
        : method;
  return sanitizeSelectorLabel(labels[key]);
}

/** Plain text only. Rejects markup so a label cannot inject HTML. */
function sanitizeSelectorLabel(value: string | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.replace(/[\u0000-\u001F\u007F]/g, '').replace(/\s+/g, ' ').trim();
  if (!trimmed || trimmed.length > 64 || /[<>]/.test(trimmed)) {
    return null;
  }
  return trimmed;
}

/** CSS custom-property values. Rejects urls, expressions, and stylesheet breaks. */
function cssToken(value: string | number | null | undefined, max = 64): string | null {
  if (value == null || value === '') {
    return null;
  }
  const trimmed = String(value).trim();
  if (!trimmed || trimmed.length > max) {
    return null;
  }
  if (/url\s*\(|expression\s*\(|javascript:|[;{}]|[<>]/i.test(trimmed)) {
    return null;
  }
  if (!/^[#%(),.'"+\-\s\w]+$/.test(trimmed)) {
    return null;
  }
  return trimmed;
}
