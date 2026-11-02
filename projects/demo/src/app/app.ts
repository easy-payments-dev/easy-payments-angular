import { HttpClient } from '@angular/common/http';
import { NgComponentOutlet } from '@angular/common';
import {
  Component,
  computed,
  inject,
  signal,
  ChangeDetectionStrategy,
  type Type,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import {
  EasyPaymentButtonsComponent,
  EasyPaymentsComponent,
  EasyPaymentsConfigService,
  EasyPaymentsDiagnosticsService,
  EasyPaymentsConfigValidator,
  MockPaymentController,
  PaymentError,
  PaymentMethod,
  PaymentMethodChangeEvent,
  PaymentOrchestratorService,
  PaymentProduct,
  PaymentResult,
  PaymentStartedEvent,
  PaymentTheme,
  PAYMENT_METHOD_LABELS,
  isAnyStripeBnplReturnAttempt,
  type EasyPaymentButtonsAppearance,
  type EasyPaymentButtonsLayout,
  type EasyPaymentsAppearance,
  type EasyPaymentsCardButtonAppearance,
  type EasyPaymentsLocale,
  type EasyPaymentsTranslationOverrides,
  type EasyPaymentsVisualStyle,
  resolveEffectiveLocale,
} from '@easy-payments/angular';

/** Main playground: Ready-to-Use Checkout vs Payment Buttons Only. */
type PlaygroundExperience = 'checkout' | 'buttons';
import { environment } from '../environments/environment';
import {
  persistDemoMode,
  readPersistedDemoMode,
  type PersistedDemoMode,
} from './demo-mode-persistence';
import { persistDemoLocale, readPersistedDemoLocale } from './demo-locale-persistence';

function isMultiInstanceQaQuery(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  return new URLSearchParams(window.location.search).get('ep_qa') === 'multi';
}

interface MethodRow {
  method: PaymentMethod;
  enabled: boolean;
}

/** Demo = all mocks. Real = every configured TEST/Sandbox provider becomes live. */
type DemoMode = PersistedDemoMode;

/** Preview backdrop shown behind checkout when appearance is transparent. */
type TransparentPreviewBackdrop = 'light' | 'dark';

/** Mirrors NestJS CatalogProduct — display must match charged amount in Real mode. */
interface TrustedCatalogProduct {
  id: string;
  name: string;
  description: string;
  unitAmount: number;
  currency: string;
}

const DEMO_MERCHANT_METADATA = {
  orderId: 'ORDER-12345',
  customerReference: 'CUSTOMER-789',
} as const;

const DEFAULT_PRODUCT: PaymentProduct = {
  id: 'premium-plan',
  name: 'Premium Plan',
  description: 'One year subscription',
  amount: 99,
  currency: 'USD',
  quantity: 1,
};

const DEFAULT_METHODS: MethodRow[] = [
  { method: 'card', enabled: true },
  { method: 'paypal', enabled: true },
  { method: 'apple-pay', enabled: true },
  { method: 'google-pay', enabled: true },
  { method: 'klarna', enabled: true },
  { method: 'affirm', enabled: true },
];

/** Phase 3 visual QA — demo-only presets (not production merchant UI). */
type VisualQaPresetId =
  | 'default'
  | 'custom-dark'
  | 'custom-light'
  | 'transparent'
  | 'low-contrast';

interface VisualQaPreset {
  readonly id: VisualQaPresetId;
  readonly label: string;
  readonly description: string;
  readonly theme: PaymentTheme;
  readonly appearance: EasyPaymentsAppearance;
  readonly transparentPreviewBackdrop?: TransparentPreviewBackdrop;
  readonly visualStyle: EasyPaymentsVisualStyle | null;
}

const VISUAL_QA_PRESETS: readonly VisualQaPreset[] = [
  {
    id: 'default',
    label: 'Default checkout',
    description: 'Library defaults — visualStyle null.',
    theme: 'system',
    appearance: 'default',
    visualStyle: null,
  },
  {
    id: 'custom-dark',
    label: 'Custom dark checkout',
    description: 'Dark theme + branded surface/accent.',
    theme: 'dark',
    appearance: 'default',
    visualStyle: {
      fontFamily: 'Georgia, "Times New Roman", serif',
      textColor: '#f8fafc',
      textSecondaryColor: '#94a3b8',
      backgroundColor: 'transparent',
      surfaceColor: '#0b1220',
      accentColor: '#34d399',
      borderRadius: '18px',
      spacing: '14px',
    },
  },
  {
    id: 'custom-light',
    label: 'Custom light checkout',
    description: 'Light theme + warm brand tokens.',
    theme: 'light',
    appearance: 'default',
    visualStyle: {
      fontFamily: '"Trebuchet MS", "Segoe UI", sans-serif',
      textColor: '#1c1917',
      textSecondaryColor: '#78716c',
      backgroundColor: 'transparent',
      surfaceColor: '#fff7ed',
      accentColor: '#c2410c',
      borderRadius: '8px',
      spacing: '10px',
    },
  },
  {
    id: 'transparent',
    label: 'Transparent checkout',
    description: 'Shell clear; tiles keep a solid surface.',
    theme: 'light',
    appearance: 'transparent',
    transparentPreviewBackdrop: 'dark',
    visualStyle: {
      backgroundColor: 'transparent',
      surfaceColor: '#ffffff',
      accentColor: '#2563eb',
      borderRadius: '12px',
      spacing: '12px',
    },
  },
  {
    id: 'low-contrast',
    label: 'Low-contrast (diagnostics)',
    description: 'DevTools console should warn in ng serve (dev mode).',
    theme: 'light',
    appearance: 'default',
    visualStyle: {
      textColor: '#cccccc',
      textSecondaryColor: '#dddddd',
      surfaceColor: '#ffffff',
      accentColor: '#e2e8f0',
    },
  },
];

const VISUAL_STYLE_FIELDS: readonly {
  readonly key: keyof EasyPaymentsVisualStyle;
  readonly label: string;
  readonly placeholder: string;
}[] = [
  { key: 'fontFamily', label: 'fontFamily', placeholder: 'e.g. Georgia, serif' },
  { key: 'textColor', label: 'textColor', placeholder: '#0f172a' },
  { key: 'textSecondaryColor', label: 'textSecondaryColor', placeholder: '#64748b' },
  { key: 'backgroundColor', label: 'backgroundColor', placeholder: 'transparent' },
  { key: 'surfaceColor', label: 'surfaceColor', placeholder: '#ffffff' },
  { key: 'accentColor', label: 'accentColor', placeholder: '#2563eb' },
  { key: 'borderRadius', label: 'borderRadius', placeholder: '12px' },
  { key: 'spacing', label: 'spacing', placeholder: '12px' },
];

@Component({
  selector: 'app-root',
  imports: [EasyPaymentsComponent, EasyPaymentButtonsComponent, NgComponentOutlet],
  templateUrl: './app.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './app.scss',
})
export class App {
  /**
   * Dev-only multi-instance harness. Open `/?ep_qa=multi`.
   * Loaded via dynamic import so the normal demo stays out of that chunk.
   * Not part of the published library API.
   */
  readonly multiInstanceQa = isMultiInstanceQaQuery();
  /** Set only when `?ep_qa=multi` — keeps MultiInstanceQaPage out of the initial bundle. */
  readonly qaPage = signal<Type<unknown> | null>(null);

  private readonly mockController = inject(MockPaymentController);
  private readonly configValidator = inject(EasyPaymentsConfigValidator);
  private readonly configService = inject(EasyPaymentsConfigService);
  private readonly orchestrator = inject(PaymentOrchestratorService);
  private readonly http = inject(HttpClient);
  /** Developer readiness. Kept outside the customer-facing checkout. */
  readonly paymentDiagnostics = inject(EasyPaymentsDiagnosticsService).diagnostics;

  readonly productName = signal(DEFAULT_PRODUCT.name);
  readonly productDescription = signal(DEFAULT_PRODUCT.description ?? '');
  readonly productAmount = signal(String(DEFAULT_PRODUCT.amount));
  readonly productCurrency = signal(DEFAULT_PRODUCT.currency);
  readonly productQuantity = signal(String(DEFAULT_PRODUCT.quantity ?? 1));
  readonly theme = signal<PaymentTheme>('system');
  readonly appearance = signal<EasyPaymentsAppearance>('default');
  /** Demo locale control for `<easy-payments [locale]>`. */
  readonly locale = signal<EasyPaymentsLocale>(readPersistedDemoLocale() ?? 'auto');
  readonly effectiveLocale = computed(() => resolveEffectiveLocale(this.locale()));
  /** Optional partial text overrides (demo). */
  readonly customTranslations = signal<EasyPaymentsTranslationOverrides>({});
  /** Demo-only: parent backdrop so transparent appearance is visible. */
  readonly transparentPreviewBackdrop = signal<TransparentPreviewBackdrop>('light');
  /**
   * Phase 3 visual QA: live `[visualStyle]` bound to the primary checkout.
   * `null` restores library theme defaults.
   */
  readonly visualStyle = signal<EasyPaymentsVisualStyle | null>(null);
  readonly visualQaPresetId = signal<VisualQaPresetId | 'custom'>('default');
  readonly visualStyleFields = VISUAL_STYLE_FIELDS;
  readonly visualQaPresets = VISUAL_QA_PRESETS;
  readonly visualStyleSummary = computed(() => {
    const style = this.visualStyle();
    return style === null ? 'null (theme defaults)' : JSON.stringify(style);
  });
  /**
   * Optional dual-instance theme independence check. Off by default — a second
   * mounted checkout shares the root orchestrator and can interfere with primary
   * payment-session QA.
   */
  readonly showMultiInstanceQa = signal(false);
  /** Stable visualStyle objects for dual-instance QA (avoid per-CD object literals). */
  readonly multiInstanceStyleA: EasyPaymentsVisualStyle = { accentColor: '#2563eb' };
  readonly multiInstanceStyleB: EasyPaymentsVisualStyle = { accentColor: '#34d399' };
  /** Demo-only control for <easy-payments [maxWidth]>. */
  readonly checkoutMaxWidth = signal(640);
  readonly methodRows = signal<MethodRow[]>(DEFAULT_METHODS.map((row) => ({ ...row })));
  readonly lastEvent = signal<string>('No payment events yet.');
  /** Newest first. Safe event lines only. */
  readonly paymentEvents = signal<string[]>([]);
  /**
   * Demo-application outcome banner for Buttons Only.
   * Not library UI — shows how a host can react to public events.
   */
  readonly buttonsHostOutcome = signal<{
    kind: 'success' | 'error' | 'cancel' | 'pending';
    title: string;
    detail: string;
  } | null>(null);
  readonly mode = signal<DemoMode>('demo');
  readonly modeMessage = signal<string | null>(null);
  readonly switchingMode = signal(false);
  /** Full Checkout vs Payment Buttons Only playground surface. */
  readonly playgroundExperience = signal<PlaygroundExperience>('checkout');
  readonly buttonsLayout = signal<EasyPaymentButtonsLayout>('horizontal');
  readonly buttonsSeparators = signal<'none' | 'line'>('none');
  readonly buttonsSeparatorColor = signal('');
  readonly buttonsBackgroundPreset = signal<'transparent' | 'light' | 'dark' | 'custom'>(
    'transparent',
  );
  readonly buttonsBackgroundCustom = signal('#f8fafc');
  readonly buttonsBorder = signal<'default' | 'none'>('default');
  readonly buttonsBorderColor = signal('');
  readonly buttonsBorderWidth = signal('1px');
  readonly buttonsBorderRadius = signal(10);
  readonly buttonsGap = signal(8);
  readonly buttonsPadding = signal(0);
  readonly buttonsHeight = signal(40);
  readonly buttonsMinWidth = signal(100);
  readonly buttonsWidthMode = signal<'auto' | 'fixed'>('auto');
  readonly buttonsFixedWidth = signal(160);
  readonly buttonsCheckoutInstanceId = signal('demo-buttons-1');

  /**
   * Demo controls for public `[cardButtonAppearance]` — Easy Payments–owned
   * Stripe Card confirmation CTA (not method tiles / SDK buttons).
   * Empty fields → `null` (library theme defaults).
   */
  readonly cardCtaLabel = signal('');
  readonly cardCtaBackgroundColor = signal('');
  readonly cardCtaTextColor = signal('');
  readonly cardCtaFontFamily = signal('');
  readonly cardCtaFontSize = signal('');
  readonly cardCtaFontWeight = signal('');
  readonly cardCtaTextAlign = signal<'left' | 'center' | 'right' | 'start' | 'end' | ''>(
    '',
  );
  readonly cardCtaBorder = signal<'default' | 'none'>('default');
  readonly cardCtaBorderWidth = signal('');
  readonly cardCtaBorderStyle = signal('');
  readonly cardCtaBorderColor = signal('');
  readonly cardCtaBorderRadius = signal('');
  readonly cardCtaMinHeight = signal('');
  readonly cardCtaWidth = signal('');
  readonly cardCtaPadding = signal('');
  readonly cardCtaHoverBackgroundColor = signal('');
  readonly cardCtaHoverTextColor = signal('');
  readonly cardCtaDisabledBackgroundColor = signal('');
  readonly cardCtaDisabledTextColor = signal('');
  readonly cardCtaLoadingBackgroundColor = signal('');
  readonly cardCtaLoadingTextColor = signal('');
  readonly cardCtaFocusOutlineColor = signal('');
  readonly cardCtaFocusOutlineWidth = signal('');
  readonly cardCtaFocusOutlineOffset = signal('');

  readonly cardButtonAppearance = computed<EasyPaymentsCardButtonAppearance | null>(() => {
    const appearance: EasyPaymentsCardButtonAppearance = {};
    const label = this.cardCtaLabel().trim();
    if (label) {
      appearance.label = label;
    }
    const backgroundColor = this.cardCtaBackgroundColor().trim();
    if (backgroundColor) {
      appearance.backgroundColor = backgroundColor;
    }
    const textColor = this.cardCtaTextColor().trim();
    if (textColor) {
      appearance.textColor = textColor;
    }
    const fontFamily = this.cardCtaFontFamily().trim();
    if (fontFamily) {
      appearance.fontFamily = fontFamily;
    }
    const fontSize = this.cardCtaFontSize().trim();
    if (fontSize) {
      appearance.fontSize = fontSize;
    }
    const fontWeightRaw = this.cardCtaFontWeight().trim();
    if (fontWeightRaw) {
      const asNum = Number(fontWeightRaw);
      appearance.fontWeight =
        Number.isFinite(asNum) && /^-?\d+(\.\d+)?$/.test(fontWeightRaw)
          ? asNum
          : fontWeightRaw;
    }
    const textAlign = this.cardCtaTextAlign();
    if (textAlign) {
      appearance.textAlign = textAlign;
    }
    if (this.cardCtaBorder() === 'none') {
      appearance.border = 'none';
    }
    const borderWidth = this.cardCtaBorderWidth().trim();
    if (borderWidth) {
      appearance.borderWidth = borderWidth;
    }
    const borderStyle = this.cardCtaBorderStyle().trim();
    if (borderStyle) {
      appearance.borderStyle = borderStyle;
    }
    const borderColor = this.cardCtaBorderColor().trim();
    if (borderColor) {
      appearance.borderColor = borderColor;
    }
    const borderRadius = this.cardCtaBorderRadius().trim();
    if (borderRadius) {
      appearance.borderRadius = borderRadius;
    }
    const minHeight = this.cardCtaMinHeight().trim();
    if (minHeight) {
      appearance.minHeight = minHeight;
    }
    const width = this.cardCtaWidth().trim();
    if (width) {
      appearance.width = width;
    }
    const padding = this.cardCtaPadding().trim();
    if (padding) {
      appearance.padding = padding;
    }
    const hoverBackgroundColor = this.cardCtaHoverBackgroundColor().trim();
    if (hoverBackgroundColor) {
      appearance.hoverBackgroundColor = hoverBackgroundColor;
    }
    const hoverTextColor = this.cardCtaHoverTextColor().trim();
    if (hoverTextColor) {
      appearance.hoverTextColor = hoverTextColor;
    }
    const disabledBackgroundColor = this.cardCtaDisabledBackgroundColor().trim();
    if (disabledBackgroundColor) {
      appearance.disabledBackgroundColor = disabledBackgroundColor;
    }
    const disabledTextColor = this.cardCtaDisabledTextColor().trim();
    if (disabledTextColor) {
      appearance.disabledTextColor = disabledTextColor;
    }
    const loadingBackgroundColor = this.cardCtaLoadingBackgroundColor().trim();
    if (loadingBackgroundColor) {
      appearance.loadingBackgroundColor = loadingBackgroundColor;
    }
    const loadingTextColor = this.cardCtaLoadingTextColor().trim();
    if (loadingTextColor) {
      appearance.loadingTextColor = loadingTextColor;
    }
    const focusOutlineColor = this.cardCtaFocusOutlineColor().trim();
    if (focusOutlineColor) {
      appearance.focusOutlineColor = focusOutlineColor;
    }
    const focusOutlineWidth = this.cardCtaFocusOutlineWidth().trim();
    if (focusOutlineWidth) {
      appearance.focusOutlineWidth = focusOutlineWidth;
    }
    const focusOutlineOffset = this.cardCtaFocusOutlineOffset().trim();
    if (focusOutlineOffset) {
      appearance.focusOutlineOffset = focusOutlineOffset;
    }
    return Object.keys(appearance).length === 0 ? null : appearance;
  });

  readonly cardButtonAppearanceSummary = computed(() => {
    const style = this.cardButtonAppearance();
    return style === null ? 'null (theme defaults)' : JSON.stringify(style);
  });

  readonly buttonsAppearance = computed<EasyPaymentButtonsAppearance>(() => {
    const bgPreset = this.buttonsBackgroundPreset();
    let background: EasyPaymentButtonsAppearance['background'] = 'transparent';
    if (bgPreset === 'light') {
      background = '#f8fafc';
    } else if (bgPreset === 'dark') {
      background = '#0f172a';
    } else if (bgPreset === 'custom') {
      background = this.buttonsBackgroundCustom().trim() || 'transparent';
    }

    const appearance: EasyPaymentButtonsAppearance = {
      gap: `${this.buttonsGap()}px`,
      padding: `${this.buttonsPadding()}px`,
      separators: this.buttonsSeparators(),
      background,
      border: this.buttonsBorder(),
      borderRadius: `${this.buttonsBorderRadius()}px`,
      buttonHeight: `${this.buttonsHeight()}px`,
      buttonMinWidth: `${this.buttonsMinWidth()}px`,
    };

    const sepColor = this.buttonsSeparatorColor().trim();
    if (sepColor) {
      appearance.separatorColor = sepColor;
    }
    if (this.buttonsBorder() !== 'none') {
      const borderColor = this.buttonsBorderColor().trim();
      if (borderColor) {
        appearance.borderColor = borderColor;
      }
      const borderWidth = this.buttonsBorderWidth().trim();
      if (borderWidth) {
        appearance.borderWidth = borderWidth;
      }
    }
    if (this.buttonsWidthMode() === 'fixed') {
      appearance.buttonWidth = `${this.buttonsFixedWidth()}px`;
    }
    return appearance;
  });

  /** Copy-ready Angular example reflecting the current Buttons Only configuration. */
  readonly buttonsCodeExample = computed(() => {
    const methods = this.methods();
    const methodsLiteral = methods.length
      ? `[${methods.map((m) => `'${m}'`).join(', ')}]`
      : `['card', 'paypal']`;
    const appearance = this.buttonsAppearance();
    const appearanceLines = Object.entries(appearance)
      .filter(([, value]) => value != null && value !== '')
      .map(([key, value]) => `  ${key}: ${JSON.stringify(value)},`)
      .join('\n');
    const cardAppearance = this.cardButtonAppearance();
    const cardAppearanceBlock =
      cardAppearance === null
        ? ''
        : `
readonly cardButtonAppearance: EasyPaymentsCardButtonAppearance = ${JSON.stringify(
            cardAppearance,
            null,
            2,
          )};
`;
    const cardAppearanceBinding =
      cardAppearance === null ? '' : `\n  [cardButtonAppearance]="cardButtonAppearance"`;
    const locale = this.locale();
    const theme = this.theme();
    const layout = this.buttonsLayout();
    const instanceId = this.buttonsCheckoutInstanceId().trim() || 'demo-buttons-1';

    return `import { bootstrapApplication } from '@angular/platform-browser';
import {
  provideEasyPayments,
  EasyPaymentButtonsComponent,
  type EasyPaymentButtonsAppearance,
  type EasyPaymentsCardButtonAppearance,
  type PaymentProduct,
} from '@easy-payments/angular';

bootstrapApplication(App, {
  providers: [
    provideEasyPayments({
      // Configure providers + backend URLs for live payments.
      // Demo Mode in this playground uses enableMockMode: true.
    }),
  ],
});

readonly product: PaymentProduct = {
  id: ${JSON.stringify(this.product().id)},
  name: ${JSON.stringify(this.product().name)},
  amount: ${this.product().amount},
  currency: ${JSON.stringify(this.product().currency)},
};

readonly methods = ${methodsLiteral} as const;

readonly buttonsAppearance: EasyPaymentButtonsAppearance = {
${appearanceLines}
};
${cardAppearanceBlock}
// template — Buttons Only is event-driven; host owns outcome UI
<easy-payment-buttons
  [product]="product"
  [methods]="methods"
  layout="${layout}"
  theme="${theme}"
  locale="${locale}"
  [buttonsAppearance]="buttonsAppearance"${cardAppearanceBinding}
  checkoutInstanceId="${instanceId}"
  (started)="onStarted($event)"
  (methodChange)="onMethodChange($event)"
  (success)="onSuccess($event)"
  (cancel)="onCancel($event)"
  (error)="onError($event)"
  (pending)="onPending($event)"
/>

// Host example (not library UI):
// onSuccess(result) { showToast('Paid ' + result.method); }
// onPending(result) { showToast('Pending — await webhook'); } // not completed
`;
  });
  /**
   * False until persisted/forced mode + provider config are applied.
   * Prevents mounting <easy-payments> in Demo Mode while recovering a real Klarna return.
   */
  readonly checkoutReady = signal(false);
  readonly bootstrapping = signal(true);
  /** When set, Real mode displays/charges from this trusted catalog entry. */
  readonly trustedCatalogProduct = signal<TrustedCatalogProduct | null>(null);

  readonly product = computed<PaymentProduct>(() => {
    const quantity = Number(this.productQuantity());

    // The catalog seeds the form when Real mode loads; from there the form wins so
    // the price shown in the checkout is the price the backend is asked to charge.
    return {
      id: this.trustedCatalogProduct()?.id ?? 'premium-plan',
      name: this.productName(),
      description: this.productDescription(),
      amount: Number(this.productAmount()),
      currency: this.productCurrency().trim().toUpperCase(),
      quantity: Number.isFinite(quantity) && quantity >= 1 ? quantity : 1,
      metadata: { ...DEMO_MERCHANT_METADATA },
    };
  });

  readonly methods = computed(() =>
    this.methodRows()
      .filter((row) => row.enabled)
      .map((row) => row.method),
  );

  readonly configStatus = computed(() => this.configValidator.getStatusSummary(this.methods()));

  readonly stripeConfigReady = computed(() => {
    const key = environment.stripePublishableKey?.trim() ?? '';
    const url = environment.createPaymentUrl?.trim() ?? '';
    return /^pk_(test|live)_/i.test(key) && !!url && !key.includes('xxxx');
  });

  readonly paypalConfigReady = computed(() => {
    const clientId = environment.paypalClientId?.trim() ?? '';
    const createUrl = environment.paypalCreateOrderUrl?.trim() ?? '';
    const captureUrl = environment.paypalCaptureOrderUrl?.trim() ?? '';
    const isPlaceholder =
      !clientId ||
      /REPLACE|YOUR_|EXAMPLE|XXXX/i.test(clientId) ||
      clientId.length < 10;
    return !isPlaceholder && !!createUrl && !!captureUrl;
  });

  readonly realProvidersReady = computed(
    () => this.stripeConfigReady() || this.paypalConfigReady(),
  );

  /**
   * The playground stays editable in Real / Test Providers: the demo backend honours
   * the requested amount for Stripe-based flows (card, Apple Pay, Google Pay).
   */
  readonly productFieldsLocked = computed(() => false);

  readonly returningFromProvider = computed(
    () => typeof window !== 'undefined' && isAnyStripeBnplReturnAttempt(),
  );

  constructor() {
    this.mockController.setDelay(350);
    this.applyThemeFromQuery();
    if (this.multiInstanceQa) {
      void import('./multi-instance-qa/multi-instance-qa.page').then((m) => {
        this.qaPage.set(m.MultiInstanceQaPage);
      });
    } else {
      void this.bootstrapPlaygroundMode();
    }
  }

  private applyThemeFromQuery(): void {
    if (typeof window === 'undefined') {
      return;
    }
    const value = new URLSearchParams(window.location.search).get('theme');
    if (value === 'light' || value === 'dark' || value === 'system') {
      this.theme.set(value);
    }
  }

  /**
   * Restore Demo vs Real before mounting <easy-payments>.
   * A Klarna/Stripe return URL forces Real even if sessionStorage is empty.
   */
  private async bootstrapPlaygroundMode(): Promise<void> {
    this.bootstrapping.set(true);
    this.checkoutReady.set(false);

    try {
      const forceReal = typeof window !== 'undefined' && isAnyStripeBnplReturnAttempt();
      const persisted = readPersistedDemoMode();
      const target: DemoMode = forceReal ? 'real' : (persisted ?? 'demo');

      if (target === 'real') {
        if (!this.realProvidersReady()) {
          this.modeMessage.set(
            forceReal
              ? 'Returned from a Stripe payment (Klarna/Affirm), but Real / Test Providers are not configured. Add Stripe pk_test_... and NestJS URLs.'
              : 'Real / Test Providers mode requires Stripe (pk_test_...) and/or PayPal Sandbox Client ID plus NestJS backend URLs.',
          );
          await this.applyDemoModeConfig();
          persistDemoMode('demo');
        } else {
          await this.applyRealModeConfig();
          persistDemoMode('real');
        }
      } else {
        await this.applyDemoModeConfig();
        persistDemoMode('demo');
      }
    } catch (error) {
      this.trustedCatalogProduct.set(null);
      this.mode.set('demo');
      this.modeMessage.set(
        error instanceof Error
          ? error.message
          : 'Failed to restore payment mode. Is the NestJS catalog endpoint running?',
      );
      await this.applyDemoModeConfig();
    } finally {
      this.bootstrapping.set(false);
      this.checkoutReady.set(true);
    }
  }

  setTheme(theme: PaymentTheme): void {
    this.theme.set(theme);
  }

  setLocale(locale: EasyPaymentsLocale): void {
    this.locale.set(locale);
    persistDemoLocale(locale);
  }

  setAppearance(appearance: EasyPaymentsAppearance): void {
    this.appearance.set(appearance);
  }

  setTransparentPreviewBackdrop(backdrop: TransparentPreviewBackdrop): void {
    this.transparentPreviewBackdrop.set(backdrop);
  }

  visualStyleFieldValue(key: keyof EasyPaymentsVisualStyle): string {
    return this.visualStyle()?.[key] ?? '';
  }

  updateVisualStyleField(key: keyof EasyPaymentsVisualStyle, raw: string): void {
    const value = raw.trim();
    this.visualQaPresetId.set('custom');
    this.visualStyle.update((current) => {
      const next: EasyPaymentsVisualStyle = { ...(current ?? {}) };
      if (!value) {
        delete next[key];
      } else {
        next[key] = value;
      }
      return Object.keys(next).length === 0 ? null : next;
    });
  }

  resetVisualStyle(): void {
    this.visualStyle.set(null);
    this.visualQaPresetId.set('default');
    this.theme.set('system');
    this.appearance.set('default');
    this.transparentPreviewBackdrop.set('light');
  }

  applyVisualQaPreset(presetId: VisualQaPresetId): void {
    const preset = VISUAL_QA_PRESETS.find((entry) => entry.id === presetId);
    if (!preset) {
      return;
    }
    this.visualQaPresetId.set(preset.id);
    this.theme.set(preset.theme);
    this.appearance.set(preset.appearance);
    this.visualStyle.set(preset.visualStyle ? { ...preset.visualStyle } : null);
    if (preset.transparentPreviewBackdrop) {
      this.transparentPreviewBackdrop.set(preset.transparentPreviewBackdrop);
    }
  }

  setShowMultiInstanceQa(enabled: boolean): void {
    this.showMultiInstanceQa.set(enabled);
  }

  setPlaygroundExperience(experience: PlaygroundExperience): void {
    this.playgroundExperience.set(experience);
    this.buttonsHostOutcome.set(null);
  }

  setButtonsLayout(layout: EasyPaymentButtonsLayout): void {
    this.buttonsLayout.set(layout);
  }

  setButtonsSeparators(value: 'none' | 'line'): void {
    this.buttonsSeparators.set(value);
  }

  setButtonsBackgroundPreset(value: 'transparent' | 'light' | 'dark' | 'custom'): void {
    this.buttonsBackgroundPreset.set(value);
  }

  setButtonsBorder(value: 'default' | 'none'): void {
    this.buttonsBorder.set(value);
  }

  setCardCtaBorder(value: 'default' | 'none'): void {
    this.cardCtaBorder.set(value);
  }

  setCardCtaTextAlign(value: 'left' | 'center' | 'right' | 'start' | 'end' | ''): void {
    this.cardCtaTextAlign.set(value);
  }

  /** Demo helper: sample branded Card CTA (does not change payment behavior). */
  applyCardCtaSample(): void {
    this.cardCtaLabel.set('Complete card payment');
    this.cardCtaBackgroundColor.set('#0b6e4f');
    this.cardCtaTextColor.set('#f8fafc');
    this.cardCtaFontFamily.set('Georgia, serif');
    this.cardCtaFontSize.set('16px');
    this.cardCtaFontWeight.set('700');
    this.cardCtaTextAlign.set('center');
    this.cardCtaBorder.set('none');
    this.cardCtaBorderWidth.set('');
    this.cardCtaBorderStyle.set('');
    this.cardCtaBorderColor.set('');
    this.cardCtaBorderRadius.set('10px');
    this.cardCtaMinHeight.set('48px');
    this.cardCtaWidth.set('100%');
    this.cardCtaPadding.set('0 20px');
    this.cardCtaHoverBackgroundColor.set('#095c42');
    this.cardCtaHoverTextColor.set('#ffffff');
    this.cardCtaDisabledBackgroundColor.set('#4b5563');
    this.cardCtaDisabledTextColor.set('#d1d5db');
    this.cardCtaLoadingBackgroundColor.set('#1f2937');
    this.cardCtaLoadingTextColor.set('#f9fafb');
    this.cardCtaFocusOutlineColor.set('#22c55e');
    this.cardCtaFocusOutlineWidth.set('2px');
    this.cardCtaFocusOutlineOffset.set('2px');
  }

  resetCardButtonAppearance(): void {
    this.cardCtaLabel.set('');
    this.cardCtaBackgroundColor.set('');
    this.cardCtaTextColor.set('');
    this.cardCtaFontFamily.set('');
    this.cardCtaFontSize.set('');
    this.cardCtaFontWeight.set('');
    this.cardCtaTextAlign.set('');
    this.cardCtaBorder.set('default');
    this.cardCtaBorderWidth.set('');
    this.cardCtaBorderStyle.set('');
    this.cardCtaBorderColor.set('');
    this.cardCtaBorderRadius.set('');
    this.cardCtaMinHeight.set('');
    this.cardCtaWidth.set('');
    this.cardCtaPadding.set('');
    this.cardCtaHoverBackgroundColor.set('');
    this.cardCtaHoverTextColor.set('');
    this.cardCtaDisabledBackgroundColor.set('');
    this.cardCtaDisabledTextColor.set('');
    this.cardCtaLoadingBackgroundColor.set('');
    this.cardCtaLoadingTextColor.set('');
    this.cardCtaFocusOutlineColor.set('');
    this.cardCtaFocusOutlineWidth.set('');
    this.cardCtaFocusOutlineOffset.set('');
  }

  async copyButtonsCodeExample(): Promise<void> {
    const text = this.buttonsCodeExample();
    try {
      await navigator.clipboard.writeText(text);
      this.lastEvent.set('Copied Buttons Only integration example.');
    } catch {
      this.lastEvent.set('Could not copy example — select the code block manually.');
    }
  }

  setCheckoutMaxWidth(value: number | string): void {
    const numeric = typeof value === 'number' ? value : Number(value);
    this.checkoutMaxWidth.set(Number.isFinite(numeric) ? numeric : 640);
  }

  setMockOutcome(outcome: 'success' | 'cancelled' | 'failed'): void {
    this.mockController.setOutcome(outcome);
  }

  mockOutcome(): 'success' | 'cancelled' | 'failed' {
    return this.mockController.outcome();
  }

  private async loadTrustedCatalogProduct(productId: string): Promise<TrustedCatalogProduct> {
    const base = environment.catalogProductUrl?.trim().replace(/\/$/, '');
    if (!base) {
      throw new Error('catalogProductUrl is not configured in environment.ts');
    }
    return firstValueFrom(this.http.get<TrustedCatalogProduct>(`${base}/${encodeURIComponent(productId)}`));
  }

  private async applyDemoModeConfig(): Promise<void> {
    this.trustedCatalogProduct.set(null);
    this.configService.replace({
      enableMockMode: true,
      providers: {},
    });
    this.mockController.reset();
    this.mockController.setDelay(350);
    this.mode.set('demo');
    await this.orchestrator.reinitialize();
    await this.orchestrator.refreshAvailability(this.methods(), this.product());
  }

  private async applyRealModeConfig(): Promise<void> {
    const trusted = await this.loadTrustedCatalogProduct('premium-plan');
    this.trustedCatalogProduct.set(trusted);
    this.productName.set(trusted.name);
    this.productDescription.set(trusted.description);
    this.productAmount.set(String(trusted.unitAmount));
    this.productCurrency.set(trusted.currency);

    const backendBaseUrl = (environment as { backendBaseUrl?: string }).backendBaseUrl?.trim();

    this.configService.replace({
      enableMockMode: false,
      providers: {
        ...(this.stripeConfigReady()
          ? {
              stripe: {
                publishableKey: environment.stripePublishableKey.trim(),
              },
              googlePay: {
                environment: 'TEST' as const,
                merchantName: 'Easy Payments Demo',
                countryCode: 'US',
              },
              // Apple Pay via Stripe Express Checkout Element (same pk_test / sk_test).
              // Tile only appears when Express Checkout availablepaymentmethodschange reports Apple Pay.
              applePay: {
                merchantName: 'Easy Payments Demo',
                countryCode: 'US',
              },
              klarna: {
                purchaseCountry: 'US',
              },
              // Affirm via Stripe Payment Element (same pk_test / sk_test).
              affirm: {
                purchaseCountry: 'US',
              },
            }
          : {}),
        ...(this.paypalConfigReady()
          ? {
              paypal: {
                clientId: environment.paypalClientId.trim(),
                currency: trusted.currency,
                intent: 'capture' as const,
              },
            }
          : {}),
      },
      backend: {
        ...(backendBaseUrl ? { baseUrl: backendBaseUrl } : {}),
        createPaymentUrl: environment.createPaymentUrl.trim(),
        paypalCreateOrderUrl: environment.paypalCreateOrderUrl.trim(),
        paypalCaptureOrderUrl: environment.paypalCaptureOrderUrl.trim(),
        klarnaCreatePaymentUrl: environment.klarnaCreatePaymentUrl.trim(),
        affirmCreatePaymentUrl: environment.affirmCreatePaymentUrl.trim(),
      },
    });

    this.mode.set('real');
    await this.orchestrator.reinitialize();
    await this.orchestrator.refreshAvailability(this.methods(), this.product());
  }

  async setMode(mode: DemoMode): Promise<void> {
    if (this.switchingMode()) {
      return;
    }

    if (mode === this.mode()) {
      persistDemoMode(mode);
      return;
    }

    if (mode === 'real' && !this.realProvidersReady()) {
      this.modeMessage.set(
        'Real / Test Providers mode requires Stripe (pk_test_...) and/or PayPal Sandbox Client ID plus NestJS backend URLs. See projects/demo/src/environments/environment.example.ts.',
      );
      return;
    }

    this.switchingMode.set(true);
    this.modeMessage.set(null);

    try {
      if (mode === 'demo') {
        await this.applyDemoModeConfig();
      } else {
        await this.applyRealModeConfig();
      }
      persistDemoMode(mode);
    } catch (error) {
      this.trustedCatalogProduct.set(null);
      this.modeMessage.set(
        error instanceof Error
          ? error.message
          : 'Failed to switch payment mode. Is the NestJS catalog endpoint running?',
      );
    } finally {
      this.switchingMode.set(false);
    }
  }

  toggleMethod(method: PaymentMethod, enabled: boolean): void {
    this.methodRows.update((rows) =>
      rows.map((row) => (row.method === method ? { ...row, enabled } : row)),
    );
  }

  moveMethod(index: number, direction: -1 | 1): void {
    this.methodRows.update((rows) => {
      const next = [...rows];
      const target = index + direction;
      if (target < 0 || target >= next.length) {
        return next;
      }
      const [row] = next.splice(index, 1);
      next.splice(target, 0, row);
      return next;
    });
  }

  methodLabel(method: PaymentMethod): string {
    return PAYMENT_METHOD_LABELS[method];
  }

  onPaymentStarted(event: PaymentStartedEvent): void {
    this.recordEvent(`started · ${event.method} · ${event.provider}`);
  }

  onPaymentMethodChange(event: PaymentMethodChangeEvent): void {
    const next = event.method ?? 'none';
    this.recordEvent(`methodChange · ${event.previousMethod ?? 'none'} → ${next}`);
  }

  onPaymentSuccess(result: PaymentResult): void {
    const reference = result.transactionId ?? result.sessionId;
    this.recordEvent(`success · ${result.method}${reference ? ` · ${reference}` : ''}`);
    if (this.playgroundExperience() === 'buttons') {
      this.buttonsHostOutcome.set({
        kind: 'success',
        title: 'Payment succeeded',
        detail: reference
          ? `${result.method} · ${reference} — fulfill only after backend/webhook verification.`
          : `${result.method} — fulfill only after backend/webhook verification.`,
      });
    }
  }

  onSuccessContinue(result: PaymentResult): void {
    // Library already resets the checkout view; keep playground config + Real mode intact.
    this.recordEvent(
      `Continue after success (${result.method}) — checkout reset for another test payment.`,
    );
  }

  onPaymentCancel(result: PaymentResult): void {
    this.recordEvent(`cancel · ${result.method}`);
    if (this.playgroundExperience() === 'buttons') {
      this.buttonsHostOutcome.set({
        kind: 'cancel',
        title: 'Payment cancelled',
        detail: `${result.method} — the buyer cancelled before confirmation.`,
      });
    }
  }

  onPaymentPending(result: PaymentResult): void {
    this.recordEvent(`pending · ${result.method} · await webhook`);
    if (this.playgroundExperience() === 'buttons') {
      this.buttonsHostOutcome.set({
        kind: 'pending',
        title: 'Payment pending',
        detail: `${result.method} — not completed. Await backend/webhook before fulfillment.`,
      });
    }
  }

  onPaymentError(error: PaymentError): void {
    this.recordEvent(`error · ${error.method ?? 'unknown'} · ${error.code}`);
    if (this.playgroundExperience() === 'buttons') {
      this.buttonsHostOutcome.set({
        kind: 'error',
        title: 'Payment failed',
        detail: `${error.method ?? 'unknown'} · ${error.code}`,
      });
    }
  }

  clearButtonsHostOutcome(): void {
    this.buttonsHostOutcome.set(null);
  }

  private recordEvent(line: string): void {
    this.lastEvent.set(line);
    this.paymentEvents.update((events) => {
      if (events[0] === line) {
        return events;
      }
      return [line, ...events].slice(0, 8);
    });
  }
}
