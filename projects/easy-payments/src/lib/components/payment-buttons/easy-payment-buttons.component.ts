import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
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
import { PaymentMethodIconComponent } from '../checkout/payment-method-icon.component';

/** Structural slot state for foundation-only rendering (no live payment actions). */
export type EasyPaymentButtonSlotState = 'loading' | 'available' | 'unavailable';

export interface EasyPaymentButtonSlot {
  readonly method: PaymentMethod;
  readonly state: EasyPaymentButtonSlotState;
  readonly isMock: boolean;
  readonly label: string;
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
 * Payment Buttons Only — structural foundation.
 *
 * Renders developer-ordered method placeholders on a permanently transparent host.
 * Does **not** mount provider SDKs or process payments in this step; slots are
 * noninteractive so buyers cannot trigger a fake charge path.
 */
@Component({
  selector: 'easy-payment-buttons',
  standalone: true,
  imports: [PaymentMethodIconComponent],
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
    '[attr.data-foundation]': '"true"',
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
  private readonly destroyRef = inject(DestroyRef);
  private destroyed = false;

  private readonly availabilitySession = new CheckoutAvailabilitySession();
  private availabilityGeneration = 0;

  readonly product = input.required<PaymentProduct>();
  readonly methods = input<PaymentMethod[]>(DEFAULT_BUTTON_METHODS);
  readonly checkout = input<CheckoutOptions>();
  /** Method row orientation. Order always follows `[methods]`. */
  readonly layout = input<EasyPaymentButtonsLayout>('vertical');
  readonly theme = input<PaymentTheme>('system');
  readonly locale = input<EasyPaymentsLocale>('auto');
  readonly translations = input<EasyPaymentsTranslationOverrides>({});
  /**
   * Optional EP-owned token overrides for placeholder chrome.
   * Host background remains permanently transparent regardless of `backgroundColor`.
   */
  readonly visualStyle = input<EasyPaymentsVisualStyle | null>(null);

  /** Declared for public API parity; not emitted until provider flows are wired. */
  readonly started = output<PaymentStartedEvent>();
  /** Declared for public API parity; not emitted in foundation-only mode. */
  readonly methodChange = output<PaymentMethodChangeEvent>();
  readonly success = output<PaymentResult>();
  readonly cancel = output<PaymentResult>();
  readonly error = output<PaymentError>();

  readonly resolvedTheme = this.themeService.resolvedTheme;
  readonly effectiveLocale = this.i18n.effectiveLocale;
  readonly availableMethods = this.availabilitySession.availableMethods;
  readonly availabilityPublished = this.availabilitySession.availabilityPublished;

  readonly visualStyleCssVars = computed(() => resolveVisualStyleCssVars(this.visualStyle()));

  readonly regionAriaLabel = computed(() => {
    const msgs = this.i18n.messages();
    return msgs.paymentMethodSelectionAria || 'Payment methods';
  });

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
      return {
        method,
        state,
        isMock: entry?.isMock ?? false,
        label: getPaymentMethodPresentation(method, theme).label || PAYMENT_METHOD_LABELS[method],
      };
    });
  });

  /** True while foundation mode is active (no live payment actions). */
  readonly foundationOnly = signal(true);

  constructor() {
    this.destroyRef.onDestroy(() => {
      this.destroyed = true;
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
  }

  slotAriaLabel(slot: EasyPaymentButtonSlot): string {
    const base = slot.label;
    if (slot.state === 'loading') {
      return `${base}, checking availability`;
    }
    if (slot.state === 'unavailable') {
      return `${base}, unavailable`;
    }
    return `${base}, payment actions not available yet`;
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
