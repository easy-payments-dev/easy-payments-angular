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
 * H2: `idle → initializing → ready | error → destroyed`.
 * H3.1–H3.4 (Card / Klarna / Affirm / PayPal / Google Pay): `ready → processing → success | pending | cancelled | error`.
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
 * Handle returned by {@link HeadlessCheckoutSession.mount}.
 * `unmount()` is idempotent and does not destroy the Headless session.
 */
export interface HeadlessMountHandle {
  readonly method: PaymentMethod;
  unmount(): Promise<void> | void;
}

/**
 * How the merchant interacts with a Headless method after mount.
 * - `confirm` — merchant CTA calls {@link HeadlessCheckoutSession.confirm}
 * - `wallet-button` / `paypal-buttons` — official SDK button starts payment
 * - `mock` — mock adapters when `enableMockMode` is on
 */
export type HeadlessMethodInteraction =
  | 'confirm'
  | 'wallet-button'
  | 'paypal-buttons'
  | 'venmo-buttons'
  | 'zip-checkout'
  | 'mock';

/**
 * Options for {@link EasyPaymentsHeadless.createSession}.
 *
 * `locale` is passed into provider availability / Stripe Elements context.
 * `translations` are accepted for forward compatibility; Headless does not own
 * a localized chrome surface (merchants own layout copy).
 * `theme` affects Stripe appearance context; it does not mutate the shared root
 * {@link ThemeService}.
 */
export interface HeadlessSessionOptions {
  product: PaymentProduct;
  /** Allow-list and preferred order. Duplicates and unknown values are rejected. */
  methods: PaymentMethod[];
  checkout?: CheckoutOptions;
  /**
   * Optional stable session id. Required for Klarna/Affirm redirect ownership (H4.2):
   * merchant must supply a value reusable after page reload. Auto-generated ids are
   * fine for Card / PayPal / Google Pay / Apple Pay but cannot own BNPL redirects.
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
   * Merchants must call {@link HeadlessCheckoutSession.mount} before paying.
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
  /** Emitted when a payment attempt begins (Card/BNPL confirm, PayPal createOrder, or Google Pay click). */
  readonly started: Observable<PaymentStartedEvent>;
  /** Emitted when {@link HeadlessCheckoutSession.selectMethod} changes selection. */
  readonly methodChange: Observable<PaymentMethodChangeEvent>;
  /** Emitted when a payment is still processing (not success; await backend/webhooks). */
  readonly pending: Observable<PaymentResult>;
  /** Emitted after a verified provider success result for the current attempt. */
  readonly success: Observable<PaymentResult>;
  /** Emitted when the buyer cancels (or the provider reports cancelled). */
  readonly cancel: Observable<PaymentResult>;
  /** Emitted for session or payment failures. */
  readonly error: Observable<PaymentError>;
}

/**
 * Public Headless Checkout session.
 *
 * Supports Card / Klarna / Affirm / US bank account (Payment Element + `confirm()`),
 * PayPal Buttons, Google Pay, and Apple Pay Express Checkout. Klarna/Affirm leave-page
 * returns use {@link HeadlessCheckoutSession.recoverReturn} with a stable
 * `checkoutInstanceId`. ACH returns recover via retrievePaymentIntent only.
 */
export interface HeadlessCheckoutSession {
  readonly id: string;

  readonly state: Signal<HeadlessSessionState>;
  readonly selectedMethod: Signal<PaymentMethod | null>;
  readonly availableMethods: Signal<readonly HeadlessMethodStatus[]>;
  readonly lastError: Signal<PaymentError | null>;
  /** Latest payment result for this session, if any. */
  readonly lastResult: Signal<PaymentResult | null>;

  readonly events: HeadlessCheckoutEvents;

  initialize(): Promise<void>;
  refreshAvailability(): Promise<readonly HeadlessMethodStatus[]>;
  selectMethod(method: PaymentMethod | null): void;

  /**
   * Mount official provider UI into a merchant-owned container.
   * Supports `card`, `klarna`, `affirm`, `us-bank-account`, `paypal`, `venmo`, `google-pay`, and `apple-pay`.
   */
  mount(method: PaymentMethod, container: HTMLElement): Promise<HeadlessMountHandle>;

  /**
   * Confirm the selected Stripe method (`card` | `klarna` | `affirm` | `us-bank-account`)
   * with an active mount. Rejects for PayPal, Google Pay, and Apple Pay — their official
   * controls own the payment gesture.
   */
  confirm(): Promise<void>;

  /**
   * Recover a Klarna/Affirm Stripe redirect return for this session's stable
   * `checkoutInstanceId` via the shared recovery service (no remount / no reconfirm),
   * or an ACH return via retrievePaymentIntent only.
   *
   * @returns Normalized {@link PaymentResult} when this session owns the return;
   * `null` when there is no applicable return for this session (unrelated / absent).
   * Rejects with {@link PaymentError} for owned returns that fail verification.
   */
  recoverReturn(): Promise<PaymentResult | null>;

  destroy(): Promise<void>;
}
