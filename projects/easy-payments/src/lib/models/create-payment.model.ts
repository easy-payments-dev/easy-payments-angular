export interface CreatePaymentRequest {
  provider: 'stripe' | 'paypal';
  productId: string;
  quantity: number;
  currency?: string;
  /**
   * Display/request unit amount from the Angular product (e.g. 99.99).
   * Useful for UI display. Production / demo backends must NOT trust this —
   * derive the authoritative amount server-side from productId / catalog.
   */
  amount?: number;
  /** Optional non-sensitive metadata for the merchant backend. */
  metadata?: Record<string, string>;
}

/**
 * Minimal wire contract for PayPal create-order.
 * Never includes a browser-controlled amount or a metadata map.
 * `orderReference` is the only merchant reference sent to PayPal.
 */
export interface PayPalCreateOrderRequest {
  provider: 'paypal';
  productId: string;
  quantity: number;
  currency: string;
  /**
   * Merchant `orderId` metadata, mapped to PayPal `custom_id`.
   * Other metadata keys are not sent to PayPal.
   */
  orderReference?: string;
}

/**
 * Maps product identity fields into the PayPal create-order HTTP body.
 * Strips amount, metadata, and any other internal fields.
 */
export function toPayPalCreateOrderRequest(input: {
  productId: string;
  quantity: number;
  currency: string;
  orderReference?: string;
}): PayPalCreateOrderRequest {
  const body: PayPalCreateOrderRequest = {
    provider: 'paypal',
    productId: input.productId.trim(),
    quantity: input.quantity,
    currency: input.currency.trim().toUpperCase(),
  };
  if (input.orderReference) {
    body.orderReference = input.orderReference;
  }
  return body;
}

/**
 * Minimal wire contract for Klarna-via-Stripe create PaymentIntent.
 * Never includes a browser-controlled amount. Metadata is a validated string map.
 */
export interface KlarnaCreatePaymentRequest {
  provider: 'klarna';
  productId: string;
  quantity: number;
  currency: string;
  /**
   * Optional Stripe Klarna preferred_locale (e.g. `es-US`).
   * Localization hint only — never affects pricing.
   */
  preferredLocale?: string;
  /** Validated merchant metadata. Amount and currency are not accepted here. */
  metadata?: Record<string, string>;
}

/**
 * Maps product identity fields into the Klarna create-payment HTTP body.
 * Strips amount and any fields other than the validated metadata map.
 */
export function toKlarnaCreatePaymentRequest(input: {
  productId: string;
  quantity: number;
  currency: string;
  preferredLocale?: string;
  metadata?: Record<string, string>;
}): KlarnaCreatePaymentRequest {
  const body: KlarnaCreatePaymentRequest = {
    provider: 'klarna',
    productId: input.productId.trim(),
    quantity: input.quantity,
    currency: input.currency.trim().toUpperCase(),
  };
  const preferredLocale = input.preferredLocale?.trim();
  if (preferredLocale) {
    body.preferredLocale = preferredLocale;
  }
  if (input.metadata && Object.keys(input.metadata).length > 0) {
    body.metadata = { ...input.metadata };
  }
  return body;
}

/**
 * Response expected from the merchant backend after creating a Stripe PaymentIntent.
 * The backend alone decides the trusted amount and uses the Stripe secret key.
 */
export interface CreateStripePaymentResponse {
  provider: 'stripe';
  clientSecret: string;
  sessionId?: string;
  paymentIntentId?: string;
}

/**
 * Response from POST paypal create-order.
 * The backend alone creates the PayPal order with a trusted catalog amount.
 */
export interface CreatePayPalOrderResponse {
  provider: 'paypal';
  orderId: string;
}

/**
 * Response from POST paypal capture-order after buyer approval.
 */
export interface CapturePayPalOrderResponse {
  provider: 'paypal';
  orderId: string;
  captureId: string;
  status?: string;
}

/**
 * Response from POST klarna create (Klarna-only Stripe PaymentIntent).
 * The backend alone decides the trusted amount and uses the Stripe secret key.
 */
export interface CreateKlarnaPaymentResponse {
  provider: 'klarna';
  clientSecret: string;
  paymentIntentId?: string;
  sessionId?: string;
}

/**
 * Minimal wire contract for Affirm-via-Stripe create PaymentIntent.
 * Never includes a browser-controlled amount. Metadata is a validated string map.
 */
export interface AffirmCreatePaymentRequest {
  provider: 'affirm';
  productId: string;
  quantity: number;
  currency: string;
  /**
   * Optional Stripe Affirm preferred_locale (e.g. `en_US`).
   * Localization hint only — never affects pricing.
   */
  preferredLocale?: string;
  /** Validated merchant metadata. Amount and currency are not accepted here. */
  metadata?: Record<string, string>;
}

/**
 * Maps product identity fields into the Affirm create-payment HTTP body.
 * Strips amount and any fields other than the validated metadata map.
 */
export function toAffirmCreatePaymentRequest(input: {
  productId: string;
  quantity: number;
  currency: string;
  preferredLocale?: string;
  metadata?: Record<string, string>;
}): AffirmCreatePaymentRequest {
  const body: AffirmCreatePaymentRequest = {
    provider: 'affirm',
    productId: input.productId.trim(),
    quantity: input.quantity,
    currency: input.currency.trim().toUpperCase(),
  };
  const preferredLocale = input.preferredLocale?.trim();
  if (preferredLocale) {
    body.preferredLocale = preferredLocale;
  }
  if (input.metadata && Object.keys(input.metadata).length > 0) {
    body.metadata = { ...input.metadata };
  }
  return body;
}

/**
 * Response from POST affirm create (Affirm-only Stripe PaymentIntent).
 * The backend alone decides the trusted amount and uses the Stripe secret key.
 */
export interface CreateAffirmPaymentResponse {
  provider: 'affirm';
  clientSecret: string;
  paymentIntentId?: string;
  sessionId?: string;
}

/**
 * Minimal wire contract for ACH (US bank account) via Stripe create PaymentIntent.
 * Never includes a browser-controlled amount. Metadata is a validated string map.
 */
export interface UsBankAccountCreatePaymentRequest {
  provider: 'usBankAccount';
  productId: string;
  quantity: number;
  currency: string;
  /** Validated merchant metadata. Amount and currency are not accepted here. */
  metadata?: Record<string, string>;
}

/**
 * Maps product identity fields into the ACH create-payment HTTP body.
 * Strips amount and any fields other than the validated metadata map.
 */
export function toUsBankAccountCreatePaymentRequest(input: {
  productId: string;
  quantity: number;
  currency: string;
  metadata?: Record<string, string>;
}): UsBankAccountCreatePaymentRequest {
  const body: UsBankAccountCreatePaymentRequest = {
    provider: 'usBankAccount',
    productId: input.productId.trim(),
    quantity: input.quantity,
    currency: input.currency.trim().toUpperCase(),
  };
  if (input.metadata && Object.keys(input.metadata).length > 0) {
    body.metadata = { ...input.metadata };
  }
  return body;
}

/**
 * Response from POST ACH create (us_bank_account-only Stripe PaymentIntent).
 * The backend alone decides the trusted amount and uses the Stripe secret key.
 */
export interface CreateUsBankAccountPaymentResponse {
  provider: 'usBankAccount';
  clientSecret: string;
  paymentIntentId?: string;
  sessionId?: string;
}

/**
 * Minimal wire contract for Cash App Pay via Stripe create PaymentIntent.
 * Never includes a browser-controlled amount. Metadata is a validated string map.
 */
export interface CashAppPayCreatePaymentRequest {
  provider: 'cashAppPay';
  productId: string;
  quantity: number;
  currency: string;
  /** Validated merchant metadata. Amount and currency are not accepted here. */
  metadata?: Record<string, string>;
}

/**
 * Maps product identity fields into the Cash App Pay create-payment HTTP body.
 * Strips amount and any fields other than the validated metadata map.
 */
export function toCashAppPayCreatePaymentRequest(input: {
  productId: string;
  quantity: number;
  currency: string;
  metadata?: Record<string, string>;
}): CashAppPayCreatePaymentRequest {
  const body: CashAppPayCreatePaymentRequest = {
    provider: 'cashAppPay',
    productId: input.productId.trim(),
    quantity: input.quantity,
    currency: input.currency.trim().toUpperCase(),
  };
  if (input.metadata && Object.keys(input.metadata).length > 0) {
    body.metadata = { ...input.metadata };
  }
  return body;
}

/**
 * Response from POST Cash App Pay create (cashapp-only Stripe PaymentIntent).
 * The backend alone decides the trusted amount and uses the Stripe secret key.
 */
export interface CreateCashAppPayPaymentResponse {
  provider: 'cashAppPay';
  clientSecret: string;
  paymentIntentId?: string;
  sessionId?: string;
}

/**
 * Minimal wire contract for Afterpay/Clearpay via Stripe create PaymentIntent.
 * Never includes a browser-controlled amount. Metadata is a validated string map.
 */
export interface AfterpayCreatePaymentRequest {
  provider: 'afterpay';
  productId: string;
  quantity: number;
  currency: string;
  /** Validated merchant metadata. Amount and currency are not accepted here. */
  metadata?: Record<string, string>;
}

/**
 * Maps product identity fields into the Afterpay create-payment HTTP body.
 * Strips amount and any fields other than the validated metadata map.
 */
export function toAfterpayCreatePaymentRequest(input: {
  productId: string;
  quantity: number;
  currency: string;
  metadata?: Record<string, string>;
}): AfterpayCreatePaymentRequest {
  const body: AfterpayCreatePaymentRequest = {
    provider: 'afterpay',
    productId: input.productId.trim(),
    quantity: input.quantity,
    currency: input.currency.trim().toUpperCase(),
  };
  if (input.metadata && Object.keys(input.metadata).length > 0) {
    body.metadata = { ...input.metadata };
  }
  return body;
}

/**
 * Response from POST Afterpay create (afterpay_clearpay-only Stripe PaymentIntent).
 * The backend alone decides the trusted amount and uses the Stripe secret key.
 */
export interface CreateAfterpayPaymentResponse {
  provider: 'afterpay';
  clientSecret: string;
  paymentIntentId?: string;
  sessionId?: string;
}

/**
 * Minimal wire contract for Zip US create-checkout (signed authorize body).
 * Never includes a browser-controlled amount. Metadata is a validated string map.
 */
export interface ZipCreateCheckoutRequest {
  provider: 'zip';
  productId: string;
  quantity: number;
  currency: string;
  /** Merchant page URL Zip redirects to on approval (query params include signature). */
  redirectConfirmUrl: string;
  /** Merchant page URL Zip redirects to on cancel/abandon. */
  redirectCancelUrl: string;
  /** Validated merchant metadata. Amount and currency are not accepted here. */
  metadata?: Record<string, string>;
}

export function toZipCreateCheckoutRequest(input: {
  productId: string;
  quantity: number;
  currency: string;
  redirectConfirmUrl: string;
  redirectCancelUrl: string;
  metadata?: Record<string, string>;
}): ZipCreateCheckoutRequest {
  const body: ZipCreateCheckoutRequest = {
    provider: 'zip',
    productId: input.productId.trim(),
    quantity: input.quantity,
    currency: input.currency.trim().toUpperCase(),
    redirectConfirmUrl: input.redirectConfirmUrl.trim(),
    redirectCancelUrl: input.redirectCancelUrl.trim(),
  };
  if (input.metadata && Object.keys(input.metadata).length > 0) {
    body.metadata = { ...input.metadata };
  }
  return body;
}

/**
 * Response from POST Zip create-checkout.
 * Server alone decides the trusted amount and holds the Zip API secret used to sign.
 */
export interface CreateZipCheckoutResponse {
  provider: 'zip';
  merchantReference: string;
  merchantId: string;
  amount: number;
  currency: string;
  /** Exact JSON object the client must pass to `openCheckout` (do not re-serialize). */
  requestBody: Record<string, unknown>;
  /** HMAC-SHA256 (base64) of the requestBody JSON string. */
  signature: string;
  /** CDN script for the active environment. */
  sdkScriptUrl: string;
  /**
   * True when the demo server signed without ZIP_MERCHANT_ID / ZIP_API_SECRET.
   * Real mode must not open Zip checkout with this response.
   */
  mock?: boolean;
}

export interface ZipVerifyReturnRequest {
  provider: 'zip';
  merchantReference: string;
  orderId?: string;
  /** Raw query string from the Zip redirect confirm URL (includes X-QP-Signature). */
  returnQuery?: string;
  /** Optional client-side completion payload from `onComplete` (never authoritative alone). */
  clientResult?: Record<string, unknown>;
}

export interface ZipVerifyReturnResponse {
  provider: 'zip';
  merchantReference: string;
  orderId: string;
  status: 'confirmed' | 'declined' | 'abandoned' | 'created' | 'unknown';
  success: boolean;
  amount: number;
  currency: string;
  alreadyReported?: boolean;
}

export interface ZipCaptureRequest {
  provider: 'zip';
  orderId: string;
  merchantReference: string;
  amount?: number;
  currency?: string;
}

export interface ZipCaptureResponse {
  provider: 'zip';
  orderId: string;
  merchantReference: string;
  status: string;
  alreadyCaptured?: boolean;
}

export type CreatePaymentResponse =
  | CreateStripePaymentResponse
  | CreatePayPalOrderResponse
  | CreateKlarnaPaymentResponse
  | CreateAffirmPaymentResponse
  | CreateUsBankAccountPaymentResponse
  | CreateCashAppPayPaymentResponse
  | CreateAfterpayPaymentResponse
  | CreateZipCheckoutResponse;
