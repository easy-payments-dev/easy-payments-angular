import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  NgZone,
  PendingTasks,
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
  CheckoutSuccessBehavior,
  PaymentMethod,
  PAYMENT_METHOD_PROVIDER_MAP,
  PaymentMethodChangeEvent,
  PaymentProduct,
  PaymentResult,
  PaymentStartedEvent,
  PaymentTheme,
  ResolvedPaymentTheme,
} from '../../models';
import type { EasyPaymentsAppearance } from '../../models/easy-payments-appearance.model';
import type { EasyPaymentsCardButtonAppearance } from '../../models/easy-payments-card-button-appearance.model';
import type { EasyPaymentButtonsSelectorLabels } from '../../models/easy-payment-buttons-appearance.model';
import type { EasyPaymentsVisualStyle } from '../../models/easy-payments-visual-style.model';
import { PaymentError, normalizeError } from '../../errors/payment-error';
import {
  isIsolatedProviderFailure,
  warnProviderDiagnostic,
} from '../../diagnostics/provider-diagnostics';
import { appendMetadataSessionPart } from '../../metadata/merchant-metadata';
import { CheckoutAvailabilitySession } from '../../services/checkout-availability-session';
import { CheckoutHostContext } from '../../services/checkout-host-context';
import {
  PaymentOrchestratorService,
  type AvailablePaymentMethod,
} from '../../services/payment-orchestrator.service';
import { ThemeService } from '../../themes/theme.service';
import { resolveVisualStyleCssVars } from '../../themes/resolve-visual-style';
import {
  evaluateVisualStyleContrast,
  VisualStyleContrastWarningTracker,
} from '../../themes/visual-style-contrast';
import { StripeCardPaymentComponent } from '../payment-methods/stripe-card-payment.component';
import { PayPalPaymentComponent } from '../payment-methods/paypal-payment.component';
import { GooglePayPaymentComponent } from '../payment-methods/google-pay-payment.component';
import { ApplePayAdapter } from '../../adapters/apple-pay/apple-pay.adapter';
import { ApplePayPaymentComponent } from '../payment-methods/apple-pay-payment.component';
import { KlarnaPaymentComponent } from '../payment-methods/klarna-payment.component';
import { AffirmPaymentComponent } from '../payment-methods/affirm-payment.component';
import { UsBankAccountPaymentComponent } from '../payment-methods/us-bank-account-payment.component';
import { CashAppPayPaymentComponent } from '../payment-methods/cash-app-pay-payment.component';
import { AfterpayPaymentComponent } from '../payment-methods/afterpay-payment.component';
import { VenmoPaymentComponent } from '../payment-methods/venmo-payment.component';
import { ZipPaymentComponent } from '../payment-methods/zip-payment.component';
import { CheckoutProductSummaryComponent } from '../checkout/checkout-product-summary.component';
import { PaymentMethodSelectorComponent } from '../checkout/payment-method-selector.component';
import { MockMethodPanelComponent } from '../checkout/mock-method-panel.component';
import { CheckoutOutcomeComponent } from '../checkout/checkout-outcome.component';
import { CheckoutViewState } from '../checkout/checkout-view-state';
import {
  DEFAULT_CHECKOUT_MAX_WIDTH,
  resolveCheckoutMaxWidth,
} from '../../layout/checkout-layout';
import { StripeRedirectRecoveryService } from '../../adapters/stripe/stripe-redirect-recovery.service';
import {
  detectStripeReturnMethod,
  isStripeReturnAttempt,
  type StripeRedirectMethod,
} from '../../adapters/stripe/stripe-redirect-return';
import { isAchReturnAttempt } from '../../adapters/us-bank-account/us-bank-account-return';
import {
  EasyPaymentsI18nService,
  type EasyPaymentsLocale,
  type EasyPaymentsTranslationOverrides,
  toStripeElementsLocale,
} from '../../i18n';

@Component({
  selector: 'easy-payments',
  standalone: true,
  imports: [
    CheckoutProductSummaryComponent,
    PaymentMethodSelectorComponent,
    MockMethodPanelComponent,
    StripeCardPaymentComponent,
    PayPalPaymentComponent,
    GooglePayPaymentComponent,
    ApplePayPaymentComponent,
    KlarnaPaymentComponent,
    AffirmPaymentComponent,
    UsBankAccountPaymentComponent,
    CashAppPayPaymentComponent,
    AfterpayPaymentComponent,
    VenmoPaymentComponent,
    ZipPaymentComponent,
    CheckoutOutcomeComponent,
  ],
  templateUrl: './easy-payments.component.html',
  styleUrl: './easy-payments.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class.ep-theme-light]': 'resolvedTheme() === "light"',
    '[class.ep-theme-dark]': 'resolvedTheme() === "dark"',
    '[class.ep-appearance-transparent]': 'appearance() === "transparent"',
    '[attr.data-theme]': 'resolvedTheme()',
    '[attr.data-appearance]': 'appearance()',
    '[attr.data-locale]': 'effectiveLocale()',
    '[attr.lang]': 'effectiveLocale()',
    '[style.--ep-checkout-max-width]': 'checkoutMaxWidthCss()',
    '[style.--ep-font-family]': 'visualStyleCssVars().fontFamily',
    '[style.--ep-text]': 'visualStyleCssVars().textColor',
    '[style.--ep-text-secondary]': 'visualStyleCssVars().textSecondaryColor',
    '[style.--ep-background]': 'visualStyleCssVars().backgroundColor',
    '[style.--ep-surface]': 'visualStyleCssVars().surfaceColor',
    '[style.--ep-accent]': 'visualStyleCssVars().accentColor',
    '[style.--ep-accent-soft]': 'visualStyleCssVars().accentSoft',
    '[style.--ep-focus]': 'visualStyleCssVars().accentColor',
    '[style.--ep-radius]': 'visualStyleCssVars().borderRadius',
    '[style.--ep-spacing]': 'visualStyleCssVars().spacing',
    '[style.max-width.px]': 'effectiveMaxWidth()',
    role: 'region',
    '[attr.aria-label]': 'checkoutAriaLabel()',
  },
  /**
   * Per-checkout ThemeService so concurrent <easy-payments> instances can use
   * independent light/dark/system themes. PaymentOrchestratorService stays root
   * (adapters / processPayment / global diagnostics). Each host owns a local
   * {@link CheckoutAvailabilitySession} so readiness tiles do not clobber siblings.
   */
  providers: [EasyPaymentsI18nService, ThemeService, CheckoutHostContext],
})
export class EasyPaymentsComponent {
  private readonly orchestrator = inject(PaymentOrchestratorService);
  private readonly themeService = inject(ThemeService);
  private readonly stripeRedirectRecovery = inject(StripeRedirectRecoveryService);
  private readonly applePayAdapter = inject(ApplePayAdapter);
  private readonly i18n = inject(EasyPaymentsI18nService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly ngZone = inject(NgZone);
  private readonly hostContext = inject(CheckoutHostContext);
  private readonly pendingTasks = inject(PendingTasks);
  private destroyed = false;
  /** True while this component owns the availability ECE mount (Minimal-style host). */
  private applePayBootstrapOwned = false;
  private applePayBootstrapGeneration = 0;
  /**
   * Instance-local availability. Updated from orchestrator.refreshAvailability
   * return values; stale async completions are ignored via generation counter.
   */
  private readonly availabilitySession = new CheckoutAvailabilitySession();
  private availabilityGeneration = 0;
  /** Per-instance contrast warning dedupe (dev console only; never buyer-facing). */
  private readonly contrastWarnings = new VisualStyleContrastWarningTracker();

  private readonly applePayBootstrapHost =
    viewChild<ElementRef<HTMLElement>>('applePayBootstrapHost');

  readonly product = input.required<PaymentProduct>();
  readonly methods = input<PaymentMethod[]>(['apple-pay', 'google-pay', 'paypal', 'card']);
  readonly checkout = input<CheckoutOptions>();
  /**
   * Optional stable id for this checkout host on pages with several instances.
   * Used to attribute Stripe Klarna/Affirm/Cash App Pay redirect returns after reload or reorder.
   * Omit on single-host pages. Values: 1–64 chars `[a-zA-Z0-9_.:-]`.
   */
  readonly checkoutInstanceId = input<string | null>(null);
  readonly theme = input<PaymentTheme>('system');
  /**
   * Outer shell style. `default` draws the built-in card chrome;
   * `transparent` removes it so a merchant parent background shows through.
   */
  readonly appearance = input<EasyPaymentsAppearance>('default');
  /**
   * Optional Easy Payments–owned visual overrides (font, text/surface colors,
   * accent, radius, spacing). Independent of `theme` and `appearance`.
   * Invalid or omitted fields leave built-in tokens unchanged. Does not restyle
   * official provider SDK buttons or marks.
   */
  readonly visualStyle = input<EasyPaymentsVisualStyle | null>(null);
  /**
   * Optional Easy Payments–owned Stripe Card confirmation CTA presentation
   * (label, colors, typography, border, size, hover/disabled/loading/focus).
   * Does not restyle the Stripe Payment Element iframe or other providers.
   */
  readonly cardButtonAppearance = input<EasyPaymentsCardButtonAppearance | null>(null);
  /**
   * Optional plain-text overrides for Full Checkout method selector tiles
   * (same shape as Buttons Only `buttonsAppearance.selectorLabels`).
   * Card and US bank account can be set independently; blank/omitted keys keep
   * localized defaults. Accessible names follow the visible label. Does not
   * change confirmation button labels (`cardButtonAppearance` owns those).
   */
  readonly selectorLabels = input<EasyPaymentButtonsSelectorLabels | null>(null);
  /**
   * Maximum checkout width in pixels. The component stays fluid (`width: 100%`)
   * up to this cap. Values are clamped to library-safe limits (320–1200).
   * Defaults to 640.
   */
  readonly maxWidth = input<number | string | null | undefined>(DEFAULT_CHECKOUT_MAX_WIDTH);
  /**
   * Built-in confirmation UI after success. Defaults to confirmation.
   * Can also be set via checkout.successBehavior.
   */
  readonly successBehavior = input<CheckoutSuccessBehavior>('confirmation');

  /**
   * UI locale. `auto` detects from the browser (es-*, pt-*, en-* → matching base;
   * anything else → English). Defaults to `auto`.
   */
  readonly locale = input<EasyPaymentsLocale>('auto');

  /**
   * Partial overrides for Easy Payments-owned UI text.
   * Priority: override → effective locale dictionary → English.
   */
  readonly translations = input<EasyPaymentsTranslationOverrides>({});

  readonly success = output<PaymentResult>();
  readonly cancel = output<PaymentResult>();
  readonly error = output<PaymentError>();
  /**
   * Fired when a PaymentIntent is still `processing` (not yet succeeded or failed).
   * Not a success and not a definitive failure. Do not retry; await backend/webhook.
   */
  readonly pending = output<PaymentResult>();
  /** Fired when the customer clicks Continue on the built-in success screen. */
  readonly successContinue = output<PaymentResult>();
  /**
   * Fired once when a payment attempt begins.
   * Selecting a method tile does not start an attempt.
   */
  readonly started = output<PaymentStartedEvent>();
  /** Fired when the selected method changes, including when it becomes unavailable. */
  readonly methodChange = output<PaymentMethodChangeEvent>();

  readonly effectiveLocale = this.i18n.effectiveLocale;
  readonly checkoutAriaLabel = computed(() => this.i18n.messages().checkoutAriaLabel);
  readonly paymentMethodSelectionAria = computed(
    () => this.i18n.messages().paymentMethodSelectionAria,
  );
  readonly checkoutTitle = computed(() => this.i18n.messages().checkoutTitle);
  readonly checkoutSubtitle = computed(() => this.i18n.messages().checkoutSubtitle);
  readonly noPaymentMethodsAvailable = computed(
    () => this.i18n.messages().noPaymentMethodsAvailable,
  );

  readonly resolvedTheme = this.themeService.resolvedTheme;
  /** Per-instance readiness — not the root orchestrator snapshot. */
  readonly availableMethods = this.availabilitySession.availableMethods;
  readonly loading = this.orchestrator.loading;

  /** Clamped max-width applied to the host (and used by container queries). */
  readonly effectiveMaxWidth = computed(() => resolveCheckoutMaxWidth(this.maxWidth()));
  readonly checkoutMaxWidthCss = computed(() => `${this.effectiveMaxWidth()}px`);

  /** Sanitized host CSS variable overrides from `[visualStyle]` (null = use SCSS defaults). */
  readonly visualStyleCssVars = computed(() => resolveVisualStyleCssVars(this.visualStyle()));

  readonly selectedMethod = signal<PaymentMethod | null>(null);
  private readonly processingMethod = signal<PaymentMethod | null>(null);
  /** Real provider is mid-flow (3DS / PayPal approval / Google Pay sheet). */
  readonly providerBusy = signal(false);

  readonly viewState = signal<CheckoutViewState>('checkout');
  readonly lastResult = signal<PaymentResult | null>(null);
  readonly lastError = signal<PaymentError | null>(null);
  /** Bumped on reset so real provider panels remount with a fresh session. */
  readonly providerMountKey = signal(0);
  /**
   * Stable `@for` collection for provider panels. Inline `[providerMountKey()]`
   * recreates a new array every CD and can destroy Payment Elements mid-confirm.
   */
  readonly providerMountKeys = computed(() => [this.providerMountKey()]);

  /** Prevents duplicate Stripe BNPL return recovery / success emits on one page load. */
  private stripeReturnRecoveryStarted = false;
  /** Method of a Stripe BNPL return seen at construction, until ownership is claimed. */
  private stripeReturnMethod: StripeRedirectMethod | null = null;
  private stripeReturnClaimed = false;
  /** Re-runs default method selection after a non-owned return releases this host. */
  private readonly selectionRefresh = signal(0);
  private terminalSuccessEmitted = false;
  /** One in-flight attempt. `settled` drops duplicate terminal callbacks until the next attempt. */
  private paymentAttempt: 'idle' | 'active' | 'settled' = 'idle';

  /** Terminal/mock-processing screens that replace the checkout form. */
  readonly showOutcome = computed(() => {
    const state = this.viewState();
    return (
      state === 'success' ||
      state === 'error' ||
      state === 'cancelled' ||
      state === 'processing' ||
      state === 'pending' ||
      state === 'status-check'
    );
  });

  readonly showCheckoutForm = computed(() => !this.showOutcome());

  readonly methodsLocked = computed(
    () => this.showOutcome() || this.providerBusy() || this.processingMethod() !== null,
  );

  readonly resolvedSuccessBehavior = computed<CheckoutSuccessBehavior>(() => {
    return this.checkout()?.successBehavior ?? this.successBehavior();
  });

  readonly outcomeState = computed(() => {
    const state = this.viewState();
    if (state === 'checkout') {
      return 'processing' as const;
    }
    return state;
  });

  readonly visibleMethods = computed(() => {
    const requested = this.methods();
    const availability = this.availableMethods();

    return requested
      .map((method) => availability.find((a) => a.method === method))
      .filter((entry): entry is NonNullable<typeof entry> => !!entry && entry.available);
  });

  readonly selectedEntry = computed(() => {
    const selected = this.selectedMethod();
    if (!selected) {
      return null;
    }
    return this.visibleMethods().find((entry) => entry.method === selected) ?? null;
  });

  readonly hasRealCardMethod = computed(() =>
    this.visibleMethods().some((entry) => entry.method === 'card' && !entry.isMock),
  );

  readonly hasRealPayPalMethod = computed(() =>
    this.visibleMethods().some((entry) => entry.method === 'paypal' && !entry.isMock),
  );

  readonly hasRealGooglePayMethod = computed(() =>
    this.visibleMethods().some((entry) => entry.method === 'google-pay' && !entry.isMock),
  );

  readonly hasRealApplePayMethod = computed(() =>
    this.visibleMethods().some((entry) => entry.method === 'apple-pay' && !entry.isMock),
  );

  readonly hasRealKlarnaMethod = computed(() =>
    this.visibleMethods().some((entry) => entry.method === 'klarna' && !entry.isMock),
  );

  readonly hasRealAffirmMethod = computed(() =>
    this.visibleMethods().some((entry) => entry.method === 'affirm' && !entry.isMock),
  );

  readonly hasRealUsBankAccountMethod = computed(() =>
    this.visibleMethods().some((entry) => entry.method === 'us-bank-account' && !entry.isMock),
  );

  readonly hasRealCashAppPayMethod = computed(() =>
    this.visibleMethods().some((entry) => entry.method === 'cash-app-pay' && !entry.isMock),
  );

  readonly hasRealAfterpayMethod = computed(() =>
    this.visibleMethods().some((entry) => entry.method === 'afterpay' && !entry.isMock),
  );

  readonly hasRealVenmoMethod = computed(() =>
    this.visibleMethods().some((entry) => entry.method === 'venmo' && !entry.isMock),
  );

  readonly hasRealZipMethod = computed(() =>
    this.visibleMethods().some((entry) => entry.method === 'zip' && !entry.isMock),
  );

  readonly showMockPanel = computed(() => {
    if (!this.showCheckoutForm()) {
      return false;
    }
    const entry = this.selectedEntry();
    if (!entry) {
      return false;
    }
    if (entry.method === 'card' && !entry.isMock) {
      return false;
    }
    if (entry.method === 'paypal' && !entry.isMock) {
      return false;
    }
    if (entry.method === 'google-pay' && !entry.isMock) {
      return false;
    }
    if (entry.method === 'apple-pay' && !entry.isMock) {
      return false;
    }
    if (entry.method === 'klarna' && !entry.isMock) {
      return false;
    }
    if (entry.method === 'affirm' && !entry.isMock) {
      return false;
    }
    if (entry.method === 'us-bank-account' && !entry.isMock) {
      return false;
    }
    if (entry.method === 'cash-app-pay' && !entry.isMock) {
      return false;
    }
    if (entry.method === 'afterpay' && !entry.isMock) {
      return false;
    }
    if (entry.method === 'venmo' && !entry.isMock) {
      return false;
    }
    if (entry.method === 'zip' && !entry.isMock) {
      return false;
    }
    return true;
  });

  readonly showStripePanel = computed(() => this.hasRealCardMethod());
  readonly showPayPalPanel = computed(() => this.hasRealPayPalMethod());
  readonly showGooglePayPanel = computed(() => this.hasRealGooglePayMethod());

  /**
   * Dedicated Minimal-ECE-style host: mounts while Apple Pay availability is unknown.
   * Independent of tile/panel visibility so Stripe can fire `ready` on iOS Safari.
   */
  readonly showApplePayBootstrap = computed(() => {
    if (!this.methods().includes('apple-pay')) {
      return false;
    }
    // Reactive — recomputes when ApplePayAdapter finishes initialize().
    if (!this.applePayAdapter.configured()) {
      return false;
    }
    const entry = this.availableMethods().find((e) => e.method === 'apple-pay');
    if (entry?.isMock) {
      return false;
    }
    if (entry?.available === true || entry?.status === 'available') {
      return false;
    }
    // Only stop after Stripe ready said applePay is not available (or load error).
    if (entry?.status === 'unavailable' || entry?.status === 'error') {
      return false;
    }
    return true;
  });

  /**
   * Payment panel after Stripe reports Apple Pay available.
   * Only mount when selected so ECE is not remounted into a clipped inactive panel.
   */
  /**
   * Real Apple Pay renders Stripe's own button inside the methods list, so it is an
   * express action rather than a selectable tile. Mock Apple Pay keeps the tile + panel.
   */
  readonly applePayExpressInList = computed(() => this.hasRealApplePayMethod());

  readonly showApplePayPanel = computed(
    () =>
      this.showCheckoutForm() &&
      this.hasRealApplePayMethod() &&
      !this.applePayExpressInList() &&
      this.selectedMethod() === 'apple-pay',
  );

  readonly showKlarnaPanel = computed(() => this.hasRealKlarnaMethod());
  readonly showAffirmPanel = computed(() => this.hasRealAffirmMethod());
  readonly showUsBankAccountPanel = computed(() => this.hasRealUsBankAccountMethod());
  readonly showCashAppPayPanel = computed(() => this.hasRealCashAppPayMethod());
  readonly showAfterpayPanel = computed(() => this.hasRealAfterpayMethod());
  readonly showVenmoPanel = computed(() => this.hasRealVenmoMethod());
  readonly showZipPanel = computed(() => this.hasRealZipMethod());

  /**
   * Keep the active real-provider panel interactive while its own UI is needed
   * (including during providerBusy / 3DS / sheets). Clip only when another method
   * is selected or a terminal/mock-processing outcome replaced the form.
   */
  readonly stripePanelActive = computed(
    () =>
      this.showCheckoutForm() &&
      this.selectedMethod() === 'card' &&
      this.hasRealCardMethod(),
  );

  readonly paypalPanelActive = computed(
    () =>
      this.showCheckoutForm() &&
      this.selectedMethod() === 'paypal' &&
      this.hasRealPayPalMethod(),
  );

  readonly googlePayPanelActive = computed(
    () =>
      this.showCheckoutForm() &&
      this.selectedMethod() === 'google-pay' &&
      this.hasRealGooglePayMethod(),
  );

  readonly applePayPanelActive = computed(
    () =>
      this.showCheckoutForm() &&
      this.selectedMethod() === 'apple-pay' &&
      this.hasRealApplePayMethod(),
  );

  readonly klarnaPanelActive = computed(
    () =>
      this.showCheckoutForm() &&
      this.selectedMethod() === 'klarna' &&
      this.hasRealKlarnaMethod(),
  );

  readonly affirmPanelActive = computed(
    () =>
      this.showCheckoutForm() &&
      this.selectedMethod() === 'affirm' &&
      this.hasRealAffirmMethod(),
  );

  readonly usBankAccountPanelActive = computed(
    () =>
      this.showCheckoutForm() &&
      this.selectedMethod() === 'us-bank-account' &&
      this.hasRealUsBankAccountMethod(),
  );

  readonly cashAppPayPanelActive = computed(
    () =>
      this.showCheckoutForm() &&
      this.selectedMethod() === 'cash-app-pay' &&
      this.hasRealCashAppPayMethod(),
  );

  readonly afterpayPanelActive = computed(
    () =>
      this.showCheckoutForm() &&
      this.selectedMethod() === 'afterpay' &&
      this.hasRealAfterpayMethod(),
  );

  readonly venmoPanelActive = computed(
    () =>
      this.showCheckoutForm() &&
      this.selectedMethod() === 'venmo' &&
      this.hasRealVenmoMethod(),
  );

  readonly zipPanelActive = computed(
    () =>
      this.showCheckoutForm() &&
      this.selectedMethod() === 'zip' &&
      this.hasRealZipMethod(),
  );

  constructor() {
    // Stripe ECE `ready` often fires outside NgZone — re-enter so tile filtering updates.
    // One listener per host, so concurrent checkouts each refresh their own tiles.
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
          // Availability refresh errors are non-fatal for checkout UI.
        });
      });
    });

    this.destroyRef.onDestroy(() => {
      this.destroyed = true;
      removeApplePayListener();
    });

    // Avoid flashing fresh checkout when Stripe redirects back from Klarna/Affirm/Cash App Pay.
    // Recovery is owned by exactly one host on the page (decided by the recovery
    // service), so Processing always resolves even if the panel has not mounted yet.
    if (typeof window !== 'undefined' && isStripeReturnAttempt()) {
      const method = detectStripeReturnMethod() ?? 'klarna';
      this.stripeReturnMethod = method;
      this.hostContext.setReturnPhase('pending', method);
      this.viewState.set('processing');
      this.updateSelectedMethod(method);
      this.providerBusy.set(true);
    } else if (typeof window !== 'undefined' && isAchReturnAttempt()) {
      // ACH return: panel recovers via retrievePaymentIntent (no second confirm).
      this.viewState.set('processing');
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
      });
    });

    effect(() => {
      this.themeService.setTheme(this.theme());
    });

    // Developer-only contrast diagnostics for EP-owned colors. Never mutates
    // colors, never blocks checkout, never touches provider SDK chrome.
    effect(() => {
      const style = this.visualStyle();
      const appearance = this.appearance();
      const theme = this.resolvedTheme();
      untracked(() => {
        this.contrastWarnings.report(
          evaluateVisualStyleContrast({ theme, appearance, style }),
        );
      });
    });

    effect(() => {
      this.i18n.setRequestedLocale(this.locale());
      this.i18n.setOverrides(this.translations());
    });

    // Merchant removed apple-pay from allowed methods — drop this checkout's preserved
    // ECE ready state only (sibling hosts keep their own Apple Pay availability).
    let allowedApplePay = false;
    effect(() => {
      const allowsApplePay = this.methods().includes('apple-pay');
      if (allowedApplePay && !allowsApplePay) {
        const product = untracked(() => this.product());
        untracked(() => this.applePayAdapter.clearAvailability(product));
      }
      allowedApplePay = allowsApplePay;
    });

    effect(() => {
      const product = this.product();
      const methods = this.methods();
      const checkout = this.checkout();

      const theme = this.resolvedTheme();
      untracked(() => {
        void this.refreshInstanceAvailability(methods, product, checkout, theme).catch(
          (err: unknown) => {
            // Config/availability errors emit only — do not take over the checkout UI.
            this.error.emit(normalizeError(err));
          },
        );
      });
    });

    effect(() => {
      this.selectionRefresh();
      const express = this.applePayExpressInList();
      // Express methods own their own button and are never the selected tile.
      const visible = this.visibleMethods().filter(
        (entry) => !(express && entry.method === 'apple-pay'),
      );
      const current = untracked(() => this.selectedMethod());
      const state = untracked(() => this.viewState());

      // Do not steal method selection during Stripe BNPL return recovery / outcomes.
      if (state !== 'checkout') {
        return;
      }

      if (visible.length === 0) {
        if (current !== null) {
          this.updateSelectedMethod(null);
        }
        return;
      }

      if (!current || !visible.some((entry) => entry.method === current)) {
        this.updateSelectedMethod(visible[0].method);
      }
    });

    // Mount Apple Pay ECE once on an in-flow visible host (Minimal ECE parity).
    effect((onCleanup) => {
      const show = this.showApplePayBootstrap();
      const hostRef = this.applePayBootstrapHost();
      const product = this.product();

      if (!show || !hostRef) {
        return;
      }

      // Depend on the value of the session key, never on object identity: a remount
      // before Stripe reports `ready` (~500ms) permanently keeps availability at
      // `checking`, which is exactly what hides the tile.
      const elementsLocale = toStripeElementsLocale(this.i18n.effectiveLocale());
      const sessionKey = appendMetadataSessionPart(
        [product.id, product.quantity ?? 1, product.currency, product.amount, elementsLocale].join(
          '|',
        ),
        product.metadata,
      );
      const host = hostRef.nativeElement;

      if (
        this.applePayBootstrapOwned &&
        this.applePayBootstrapSessionKey === sessionKey &&
        this.applePayBootstrapHostElement === host
      ) {
        return;
      }

      const generation = ++this.applePayBootstrapGeneration;

      untracked(() => {
        void this.mountApplePayBootstrap(
          host,
          this.product(),
          this.checkout(),
          this.resolvedTheme(),
          generation,
          sessionKey,
        );
      });

      onCleanup(() => {
        if (generation !== this.applePayBootstrapGeneration) {
          return;
        }
        if (this.applePayBootstrapOwned) {
          this.applePayAdapter.unmountExpressCheckout({ preserveAvailability: true });
          this.applePayBootstrapOwned = false;
          this.applePayBootstrapSessionKey = null;
          this.applePayBootstrapHostElement = null;
        }
      });
    });
  }

  /**
   * Minimal-ECE-parity availability mount. Tile appears only after ready + applePay:true.
   */
  private applePayBootstrapSessionKey: string | null = null;
  private applePayBootstrapHostElement: HTMLElement | null = null;

  /**
   * Evaluate availability through the root orchestrator (adapters + global diagnostics
   * projection), then store the returned snapshot on this instance only.
   */
  private async refreshInstanceAvailability(
    methods: PaymentMethod[],
    product: PaymentProduct,
    checkout: CheckoutOptions | undefined,
    theme: ResolvedPaymentTheme,
  ): Promise<AvailablePaymentMethod[]> {
    const generation = ++this.availabilityGeneration;
    try {
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
    } catch (error) {
      if (!this.destroyed && generation === this.availabilityGeneration) {
        // Keep prior tiles if any; do not clear on transient failures.
      }
      throw error;
    }
  }

  private async mountApplePayBootstrap(
    host: HTMLElement,
    product: PaymentProduct,
    checkout: CheckoutOptions | undefined,
    theme: ResolvedPaymentTheme,
    generation: number,
    sessionKey: string,
  ): Promise<void> {
    try {
      this.applePayBootstrapOwned = true;
      this.applePayBootstrapSessionKey = sessionKey;
      this.applePayBootstrapHostElement = host;
      await this.applePayAdapter.mountExpressCheckout(host, {
        product,
        checkout,
        theme,
        locale: toStripeElementsLocale(this.i18n.effectiveLocale()),
        onSuccess: () => undefined,
        onCancel: () => undefined,
        onError: () => undefined,
        onAttempt: () => this.onPaymentStarted('apple-pay'),
      });
      if (this.destroyed || generation !== this.applePayBootstrapGeneration) {
        return;
      }
    } catch {
      if (generation === this.applePayBootstrapGeneration) {
        this.applePayBootstrapOwned = false;
        this.applePayBootstrapSessionKey = null;
        this.applePayBootstrapHostElement = null;
      }
    }
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

  /** Another host owns the return (or it was unattributable): show a normal checkout. */
  private releaseStripeReturn(): void {
    this.stripeReturnMethod = null;
    this.hostContext.setReturnPhase('none');
    this.providerBusy.set(false);
    this.viewState.set('checkout');
    // The provisional selection was set before outputs were subscribed; revert it silently
    // and let default selection run as on a fresh load.
    this.selectedMethod.set(null);
    this.selectionRefresh.update((value) => value + 1);
  }

  /**
   * Library-owned Stripe redirect recovery (Klarna / Affirm / Cash App Pay / Afterpay). Always leaves
   * processing for a terminal state (success / error / cancelled). Idempotent per page load.
   */
  private async recoverStripeReturn(method: StripeRedirectMethod): Promise<void> {
    if (this.stripeReturnRecoveryStarted) {
      return;
    }
    this.stripeReturnRecoveryStarted = true;

    this.viewState.set('processing');
    this.updateSelectedMethod(method);
    this.providerBusy.set(true);

    const label =
      method === 'affirm'
        ? 'Affirm'
        : method === 'cash-app-pay'
          ? 'Cash App Pay'
          : method === 'afterpay'
            ? 'Afterpay'
            : 'Klarna';
    const provider = PAYMENT_METHOD_PROVIDER_MAP[method];

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
      this.stripeReturnMethod = null;
      if (!this.destroyed) {
        this.providerBusy.set(false);
        // After cancel/error the panel may create a fresh PaymentIntent for retry.
        // After success/pending, keep a non-creating phase so panels do not recreate —
        // but do not leave `owner` (which forces Affirm/Klarna into perpetual Processing UI).
        const state = this.viewState();
        if (state === 'success' || this.terminalSuccessEmitted) {
          this.hostContext.setReturnPhase('settled', method);
        } else if (state === 'processing') {
          this.hostContext.setReturnPhase('awaiting', method);
        } else {
          this.hostContext.setReturnPhase('none');
        }
      }
    }
  }

  selectMethod(method: PaymentMethod): void {
    if (this.methodsLocked()) {
      return;
    }
    if (method === 'apple-pay' && this.applePayExpressInList()) {
      // The express button owns the interaction; there is no tile to select.
      return;
    }
    this.updateSelectedMethod(method);
  }

  isMethodLoading(method: PaymentMethod): boolean {
    return this.loading() && this.processingMethod() === method;
  }

  onProviderBusy(busy: boolean): void {
    this.providerBusy.set(busy);
  }

  onStripeSuccess(result: PaymentResult): void {
    this.handleSuccess(result);
  }

  onStripeCancel(result: PaymentResult): void {
    this.handleCancelled(result);
  }

  onStripeError(error: PaymentError): void {
    this.handlePaymentError(error);
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

  onGooglePaySuccess(result: PaymentResult): void {
    this.handleSuccess(result);
  }

  onGooglePayCancel(result: PaymentResult): void {
    this.handleCancelled(result);
  }

  onGooglePayError(error: PaymentError): void {
    this.handlePaymentError(error);
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

  onKlarnaSuccess(result: PaymentResult): void {
    // Parent owns redirect recovery; ignore duplicate panel success for the same load.
    if (this.stripeRedirectRecovery.wasReturnConsumed() && this.terminalSuccessEmitted) {
      return;
    }
    this.handleSuccess(result);
  }

  onKlarnaCancel(result: PaymentResult): void {
    this.handleCancelled(result);
  }

  onKlarnaError(error: PaymentError): void {
    this.handlePaymentError(error);
  }

  /**
   * Klarna panel busy/returning signals (in-page confirm). Redirect recovery is
   * owned by recoverStripeReturn() so Processing cannot hang without a panel.
   */
  onKlarnaReturning(active: boolean): void {
    if (active) {
      this.updateSelectedMethod('klarna');
      if (this.viewState() === 'checkout') {
        this.viewState.set('processing');
      }
      this.providerBusy.set(true);
      return;
    }
    this.providerBusy.set(false);
  }

  onAffirmSuccess(result: PaymentResult): void {
    if (this.stripeRedirectRecovery.wasReturnConsumed() && this.terminalSuccessEmitted) {
      return;
    }
    this.handleSuccess(result);
  }

  onAffirmCancel(result: PaymentResult): void {
    this.handleCancelled(result);
  }

  onAffirmError(error: PaymentError): void {
    this.handlePaymentError(error);
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

  onCashAppPaySuccess(result: PaymentResult): void {
    // Parent owns redirect recovery; ignore duplicate panel success for the same load.
    if (this.stripeRedirectRecovery.wasReturnConsumed() && this.terminalSuccessEmitted) {
      return;
    }
    this.handleSuccess(result);
  }

  onCashAppPayCancel(result: PaymentResult): void {
    this.handleCancelled(result);
  }

  onCashAppPayError(error: PaymentError): void {
    this.handlePaymentError(error);
  }

  /**
   * Cash App Pay panel busy/returning signals (in-page confirm). Redirect recovery is
   * owned by recoverStripeReturn() so Processing cannot hang without a panel.
   */
  onCashAppPayReturning(active: boolean): void {
    if (active) {
      this.updateSelectedMethod('cash-app-pay');
      if (this.viewState() === 'checkout') {
        this.viewState.set('processing');
      }
      this.providerBusy.set(true);
      return;
    }
    this.providerBusy.set(false);
  }

  onAfterpaySuccess(result: PaymentResult): void {
    if (this.stripeRedirectRecovery.wasReturnConsumed() && this.terminalSuccessEmitted) {
      return;
    }
    this.handleSuccess(result);
  }

  onAfterpayCancel(result: PaymentResult): void {
    this.handleCancelled(result);
  }

  onAfterpayError(error: PaymentError): void {
    this.handlePaymentError(error);
  }

  /**
   * Afterpay panel busy/returning signals (in-page confirm). Redirect recovery is
   * owned by recoverStripeReturn() so Processing cannot hang without a panel.
   */
  onAfterpayReturning(active: boolean): void {
    if (active) {
      this.updateSelectedMethod('afterpay');
      if (this.viewState() === 'checkout') {
        this.viewState.set('processing');
      }
      this.providerBusy.set(true);
      return;
    }
    this.providerBusy.set(false);
  }

  onVenmoSuccess(result: PaymentResult): void {
    this.handleSuccess(result);
  }

  onVenmoCancel(result: PaymentResult): void {
    this.handleCancelled(result);
  }

  onVenmoError(error: PaymentError): void {
    this.handlePaymentError(error);
  }

  onZipSuccess(result: PaymentResult): void {
    this.handleSuccess(result);
  }

  onZipCancel(result: PaymentResult): void {
    this.handleCancelled(result);
  }

  onZipError(error: PaymentError): void {
    this.handlePaymentError(error);
  }

  onAffirmReturning(active: boolean): void {
    if (active) {
      this.updateSelectedMethod('affirm');
      if (this.viewState() === 'checkout') {
        this.viewState.set('processing');
      }
      this.providerBusy.set(true);
      return;
    }
    this.providerBusy.set(false);
  }

  async onPay(method: PaymentMethod): Promise<void> {
    if (this.methodsLocked() || this.processingMethod()) {
      return;
    }

    this.processingMethod.set(method);
    this.viewState.set('processing');
    this.lastError.set(null);
    this.lastResult.set(null);
    this.onPaymentStarted(method);

    try {
      const result = await this.orchestrator.processPayment(method, this.product(), this.checkout());

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
            provider: result.provider,
          }),
        );
      }
    } catch (err) {
      const paymentError = normalizeError(err, { method });

      if (paymentError.code === 'PAYMENT_CANCELLED') {
        this.handleCancelled({
          status: 'cancelled',
          method,
          provider: paymentError.provider ?? 'stripe',
          message: paymentError.message,
        });
      } else {
        this.handlePaymentError(paymentError);
      }
    } finally {
      this.processingMethod.set(null);
    }
  }

  onOutcomeAction(): void {
    const state = this.viewState();
    if (state === 'success') {
      const result = this.lastResult();
      if (result) {
        this.successContinue.emit(result);
      }
      this.resetCheckoutView();
      return;
    }

    if (
      state === 'error' ||
      state === 'cancelled' ||
      state === 'pending' ||
      state === 'status-check'
    ) {
      this.resetCheckoutView();
    }
  }

  /** Public helper for hosts (e.g. demo Continue) to restore a fresh checkout UI. */
  resetCheckoutView(): void {
    this.viewState.set('checkout');
    this.lastResult.set(null);
    this.lastError.set(null);
    this.processingMethod.set(null);
    this.providerBusy.set(false);
    this.terminalSuccessEmitted = false;
    this.paymentAttempt = 'idle';
    this.hostContext.setReturnPhase('none');
    this.providerMountKey.update((value) => value + 1);
  }

  /** Provider panels call this when a real attempt starts. Tile selection does not. */
  onPaymentStarted(method: PaymentMethod): void {
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

  /** False when this terminal callback repeats an attempt that already finished. */
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
    if (this.destroyed) {
      return;
    }
    if (result.status === 'processing') {
      this.handlePending(result);
      return;
    }
    if (
      this.terminalSuccessEmitted &&
      (result.method === 'klarna' ||
        result.method === 'affirm' ||
        result.method === 'us-bank-account' ||
        result.method === 'cash-app-pay' ||
        result.method === 'afterpay' ||
        result.method === 'zip')
    ) {
      return;
    }
    if (!this.acceptTerminalEvent()) {
      return;
    }
    if (
      result.method === 'klarna' ||
      result.method === 'affirm' ||
      result.method === 'us-bank-account' ||
      result.method === 'cash-app-pay' ||
      result.method === 'afterpay' ||
      result.method === 'zip'
    ) {
      this.terminalSuccessEmitted = true;
    }

    this.success.emit(result);
    this.lastResult.set(result);
    this.lastError.set(null);
    this.providerBusy.set(false);

    if (this.resolvedSuccessBehavior() === 'confirmation') {
      this.viewState.set('success');
    } else {
      this.viewState.set('checkout');
    }
  }

  /**
   * Asynchronous pending PaymentIntent: not success, not failure.
   * Locks retry (settles the attempt). Verified processing exits the spinner
   * into a pending confirmation; unknown status uses status-check.
   */
  private handlePending(result: PaymentResult): void {
    if (this.destroyed) {
      return;
    }
    if (!this.acceptTerminalEvent()) {
      return;
    }
    this.pending.emit(result);
    this.lastResult.set(result);
    this.lastError.set(null);
    this.providerBusy.set(false);
    this.processingMethod.set(result.method);
    this.viewState.set(
      result.metadata?.['statusCheck'] === true ? 'status-check' : 'pending',
    );
  }

  private handleCancelled(result: PaymentResult): void {
    if (!this.acceptTerminalEvent()) {
      return;
    }
    this.cancel.emit(result);
    this.lastResult.set(result);
    this.lastError.set(null);
    this.providerBusy.set(false);
    this.viewState.set('cancelled');
  }

  private handlePaymentError(error: PaymentError): void {
    if (this.destroyed) {
      return;
    }
    if (error.code === 'PAYMENT_CANCELLED') {
      this.handleCancelled({
        status: 'cancelled',
        method: error.method ?? 'card',
        provider: error.provider ?? 'stripe',
        message: error.message,
      });
      return;
    }
    if (!this.acceptTerminalEvent()) {
      return;
    }
    this.error.emit(error);
    if (isIsolatedProviderFailure(error.code)) {
      // Log the stable code only. PaymentError.message may contain a backend
      // response body, a client secret, or a credential-bearing SDK URL.
      if (error.code !== 'BACKEND_ERROR') {
        warnProviderDiagnostic(error.provider ?? error.method ?? 'checkout', error.code);
      }
      this.lastError.set(error);
      this.providerBusy.set(false);
      this.processingMethod.set(null);
      if (this.viewState() === 'processing') {
        this.viewState.set('checkout');
      }
      return;
    }
    this.lastError.set(error);
    this.lastResult.set(null);
    this.providerBusy.set(false);
    this.viewState.set('error');
  }
}
