import type { Signal } from '@angular/core';
import type { Observable } from 'rxjs';
import type { CheckoutOptions } from '../models/checkout-options.model';
import type { PaymentMethod, PaymentProviderName } from '../models/payment-method.model';
import type {
  PaymentMethodChangeEvent,
  PaymentResult,
  PaymentStartedEvent,
} from '../models/payment-result.model';
import type { PaymentProduct } from '../models/payment-product.model';
import type { PaymentTheme } from '../models/payment-theme.model';
import type { MethodReadinessState } from '../diagnostics/provider-diagnostics';
import type { PaymentError } from '../errors/payment-error';
import type {
  EasyPaymentsLocale,
  EasyPaymentsTranslationOverrides,
} from '../i18n';

/**
 * Public Headless Checkout session lifecycle.
 *
 * H2 transitions: `idle → initializing → ready | error → destroyed`.
 * `processing` / `pending` / `success` / `cancelled` are reserved for H3/H4 payment execution.
 */
export type HeadlessSessionState =
  | 'idle'
  | 'initializing'
  | 'ready'
  | 'processing'
  | 'pending'
  | 'success'
  | 'cancelled'
  | 'error'
  | 'destroyed';

/**
 * How the merchant will interact with a method once H3 mounts provider UI.
 * Accurate for current Easy Payments adapters — not a claim that H2 can pay.
 */
export type HeadlessMethodInteraction =
  | 'confirm'
  | 'wallet-button'
  | 'paypal-buttons'
  | 'mock';

/**
 * Options for {@link EasyPaymentsHeadless.createSession}.
 *
 * `locale` / `translations` are accepted and retained for H3 provider messaging;
 * H2 does not localize a Headless UI surface (there is none yet).
 * `theme` affects Stripe appearance context passed into availability checks only;
 * it does not mutate the shared root {@link ThemeService}.
 */
export interface HeadlessSessionOptions {
  product: PaymentProduct;
  /** Allow-list and preferred order. Duplicates and unknown values are rejected. */
  methods: PaymentMethod[];
  checkout?: CheckoutOptions;
  /**
   * Optional stable session id (redirect ownership in H4).
   * Must match `^[a-zA-Z0-9_.:-]{1,64}$` when provided.
   * Must be unique among live Headless sessions.
   */
  checkoutInstanceId?: string | null;
  locale?: EasyPaymentsLocale;
  translations?: EasyPaymentsTranslationOverrides;
  theme?: PaymentTheme;
}

export interface HeadlessMethodStatus {
  method: PaymentMethod;
  provider: PaymentProviderName;
  readiness: MethodReadinessState;
  available: boolean;
  diagnosticCode?: string;
  /**
   * Always true for real interactive methods in Easy Payments.
   * Official provider UI mounting arrives in H3 — H2 never mounts.
   */
  requiresMount: boolean;
  interaction: HeadlessMethodInteraction;
  /** True when the registered adapter is a mock (enableMockMode). */
  mock: boolean;
  /**
   * Present when readiness cannot be finalized without a mounted provider surface
   * (notably Apple Pay Express Checkout Element `ready`).
   */
  readinessNote?: string;
}

export interface HeadlessCheckoutEvents {
  /** Reserved for H3 — not emitted in H2. */
  readonly started: Observable<PaymentStartedEvent>;
  /** Emitted when {@link HeadlessCheckoutSession.selectMethod} changes selection. */
  readonly methodChange: Observable<PaymentMethodChangeEvent>;
  /** Reserved for H3/H4 — not emitted in H2. */
  readonly pending: Observable<PaymentResult>;
  /** Reserved for H3/H4 — not emitted in H2. */
  readonly success: Observable<PaymentResult>;
  /** Reserved for H3/H4 — not emitted in H2. */
  readonly cancel: Observable<PaymentResult>;
  /** Emitted for session-level failures (e.g. initialize). */
  readonly error: Observable<PaymentError>;
}

/**
 * Public Headless Checkout session (H2 foundation).
 *
 * Supports create → initialize → readiness → selectMethod → destroy.
 * Payment execution and provider UI mounting are not available in H2.
 */
export interface HeadlessCheckoutSession {
  readonly id: string;

  readonly state: Signal<HeadlessSessionState>;
  readonly selectedMethod: Signal<PaymentMethod | null>;
  readonly availableMethods: Signal<readonly HeadlessMethodStatus[]>;
  readonly lastError: Signal<PaymentError | null>;
  /** Always `null` in H2 — payment execution is not implemented. */
  readonly lastResult: Signal<PaymentResult | null>;

  readonly events: HeadlessCheckoutEvents;

  initialize(): Promise<void>;
  refreshAvailability(): Promise<readonly HeadlessMethodStatus[]>;
  selectMethod(method: PaymentMethod | null): void;
  destroy(): Promise<void>;
}
