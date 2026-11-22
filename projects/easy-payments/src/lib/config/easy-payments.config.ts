export interface StripeProviderConfig {
  /**
   * Stripe publishable key only (pk_test_... / pk_live_...).
   * Never put a secret key (sk_...) here.
   */
  publishableKey: string;
}

export interface PayPalProviderConfig {
  clientId: string;
  currency?: string;
  intent?: 'capture' | 'authorize';
}

/**
 * Apple Pay via Stripe (Express Checkout Element).
 * Opt in with `providers.applePay: {}` (or with optional display fields).
 * No Apple Merchant ID / certificates in Angular — Stripe registers domains
 * and handles merchant validation. Requires Stripe publishableKey + createPaymentUrl.
 */
export interface ApplePayProviderConfig {
  /** Display name shown in the Apple Pay sheet (optional). */
  merchantName?: string;
  /** ISO 3166-1 alpha-2 country for Payment Request / wallet (default US). */
  countryCode?: string;
  /**
   * @deprecated Not used for Stripe Apple Pay. Stripe creates/manages the Merchant ID.
   * Kept optional for backward compatibility; ignored at runtime.
   */
  merchantId?: string;
}

export interface GooglePayProviderConfig {
  /**
   * Google Pay merchant ID from Google Pay & Wallet Console.
   * Optional in TEST (Easy Payments defaults to Google's documented TEST merchantId).
   * Required for PRODUCTION.
   */
  merchantId?: string;
  /** User-visible merchant name shown in the Google Pay sheet. */
  merchantName?: string;
  /** Defaults to TEST. Do not use PRODUCTION until merchant approval is complete. */
  environment?: 'TEST' | 'PRODUCTION';
  /** ISO 3166-1 alpha-2 country for transactionInfo (default US). */
  countryCode?: string;
}

export interface KlarnaProviderConfig {
  /** ISO country for Klarna purchase context (default US). */
  purchaseCountry?: string;
  /** Locale hint for Klarna/Stripe (default en-US). */
  locale?: string;
}

export interface AffirmProviderConfig {
  /** ISO country for Affirm purchase context (default US). */
  purchaseCountry?: string;
  /** Locale hint for Affirm/Stripe. */
  locale?: string;
}

/**
 * ACH Direct Debit (US bank account) via Stripe Payment Element.
 * Opt in with `providers.usBankAccount: {}`.
 * Requires Stripe publishableKey + backend.createUsBankAccountPaymentUrl.
 * Available in Full Checkout, Payment Buttons Only, and Headless when opted in.
 */
export interface UsBankAccountProviderConfig {
  /** ISO country for ACH purchase context (default US). */
  purchaseCountry?: string;
}

/**
 * Cash App Pay via Stripe Payment Element (`cashapp` PaymentIntent).
 * Opt in with `providers.cashAppPay: {}`.
 * Requires Stripe publishableKey + backend.cashAppPayCreatePaymentUrl.
 * US businesses, US customers, USD only, minimum $0.50. Stripe does not support
 * Cash App Pay in the Express Checkout Element.
 * Available in Full Checkout, Payment Buttons Only, and Headless when opted in.
 */
export type CashAppPayProviderConfig = Record<string, never>;

/**
 * Afterpay/Clearpay via Stripe Payment Element (`afterpay_clearpay` PaymentIntent).
 * Opt in with `providers.afterpay: {}`.
 * Requires Stripe publishableKey + backend.afterpayCreatePaymentUrl.
 * AU/CA/GB/NZ/US; currencies AUD/CAD/GBP/NZD/USD. Stripe does not support
 * Afterpay in the Express Checkout Element.
 * Available in Full Checkout, Payment Buttons Only, and Headless when opted in.
 * UK customers know the brand as Clearpay; Stripe PE shows the regional name.
 */
export type AfterpayProviderConfig = Record<string, never>;

/**
 * Zip US via Zip Gateway API + JS SDK (`window.quadpay.apiCheckout`).
 * Opt in with `providers.zip: {}` (merchantId may be supplied by the create response).
 * Requires backend `zipCreateCheckoutUrl` + `zipVerifyReturnUrl`.
 * API secret stays on the server. US / USD. Disabled by default.
 * Available in Full Checkout, Payment Buttons Only, and Headless when opted in.
 *
 * @see https://docs.us.zip.co/docs/api-javascript-sdk.md
 * @see https://docs.us.zip.co/docs/api-implementation.md
 */
export type ZipProviderConfig = Record<string, never>;

/**
 * Link by Stripe via the Express Checkout Element (official Link button).
 * Opt in with `providers.link: {}` and `'link'` in `methods`.
 * Requires Stripe publishableKey + backend.linkCreatePaymentUrl (the server must
 * create the PaymentIntent with `payment_method_types: ['link', 'card']` — Stripe
 * requires `card` alongside `link`). Card Payment Element keeps `wallets.link: 'never'`
 * so Link is never duplicated inside the card form.
 * Available in Full Checkout, Payment Buttons Only, and Headless when opted in.
 */
export type LinkProviderConfig = Record<string, never>;

/**
 * Amazon Pay via Stripe Express Checkout Element (official Amazon Pay button).
 * Opt in with `providers.amazonPay: {}` and `'amazon-pay'` in `methods`.
 * Requires Stripe publishableKey + backend.amazonPayCreatePaymentUrl (server creates
 * PaymentIntent with `payment_method_types: ['amazon_pay']`).
 * Available in Full Checkout, Payment Buttons Only, and Headless when opted in.
 *
 * @see https://docs.stripe.com/payments/amazon-pay
 * @see https://docs.stripe.com/elements/express-checkout-element
 */
export type AmazonPayProviderConfig = Record<string, never>;

/**
 * Alipay via Stripe Payment Element (redirect confirmation).
 * Opt in with `providers.alipay: {}` and `'alipay'` in `methods`.
 * Requires Stripe publishableKey + backend.alipayCreatePaymentUrl (server creates
 * PaymentIntent with `payment_method_types: ['alipay']`).
 * Available in Full Checkout, Payment Buttons Only, and Headless when opted in.
 *
 * @see https://docs.stripe.com/payments/alipay
 */
export type AlipayProviderConfig = Record<string, never>;

/**
 * Venmo via the PayPal JS SDK (`enable-funding=venmo` + official Venmo Buttons).
 * Opt in with `providers.venmo: {}` (or with sandboxBuyerCountry for sandbox).
 * Requires PayPal `clientId` + backend paypalCreateOrderUrl / paypalCaptureOrderUrl
 * (same Orders v2 flow as PayPal — no separate Venmo Nest routes).
 * US buyers / USD. Disabled by default.
 * Available in Full Checkout, Payment Buttons Only, and Headless when opted in.
 *
 * @see https://developer.paypal.com/docs/checkout/pay-with-venmo/integrate/
 * @see https://developer.paypal.com/docs/checkout/pay-with-venmo/test/
 */
export interface VenmoProviderConfig {
  /**
   * Sandbox only: set `'US'` to simulate a US buyer so the Venmo button can appear.
   * Never set in production — the live SDK uses the buyer's real country.
   */
  sandboxBuyerCountry?: 'US';
}

export interface EasyPaymentsBackendConfig {
  /**
   * Optional origin or origin + path prefix for relative backend endpoints.
   * Example: `https://api.example.com` or `https://api.example.com/v1`.
   * Omitted baseUrl leaves each endpoint unchanged. Absolute http(s) endpoints
   * are used as-is. `javascript:`, `data:`, and protocol-relative URLs are rejected.
   */
  baseUrl?: string;
  /** Merchant endpoint that creates a Stripe PaymentIntent and returns clientSecret. */
  createPaymentUrl?: string;
  /**
   * PayPal Orders API: create order (returns { provider: 'paypal', orderId }).
   * Required for real PayPal checkout.
   */
  paypalCreateOrderUrl?: string;
  /**
   * PayPal Orders API: capture approved order
   * (returns { provider: 'paypal', orderId, captureId, status? }).
   * Required for real PayPal checkout.
   */
  paypalCaptureOrderUrl?: string;
  /** Creates a Klarna-only Stripe PaymentIntent. Returns clientSecret. */
  klarnaCreatePaymentUrl?: string;
  /** Creates an Affirm-only Stripe PaymentIntent. Returns clientSecret. */
  affirmCreatePaymentUrl?: string;
  /**
   * Creates a US bank account (ACH) Stripe PaymentIntent (`us_bank_account` only).
   * Returns clientSecret. Required for real ACH in Full Checkout.
   * Does not replace createPaymentUrl (card remains card-only).
   */
  createUsBankAccountPaymentUrl?: string;
  /**
   * Creates a Cash App Pay Stripe PaymentIntent (`cashapp` only, USD, min $0.50).
   * Returns clientSecret. Required for real Cash App Pay.
   */
  cashAppPayCreatePaymentUrl?: string;
  /**
   * Creates an Afterpay/Clearpay Stripe PaymentIntent (`afterpay_clearpay` only).
   * Returns clientSecret. Required for real Afterpay. Catalog amount is authoritative.
   */
  afterpayCreatePaymentUrl?: string;
  /**
   * Creates a Zip authorize requestBody + HMAC signature (server holds Zip API secret).
   * Returns requestBody, signature, merchantReference, sdkScriptUrl. Catalog amount is authoritative.
   */
  zipCreateCheckoutUrl?: string;
  /**
   * Verifies Zip return/webhook outcome before the client reports success.
   * Server checks HMAC and/or Zip order status; catalog amount is authoritative.
   */
  zipVerifyReturnUrl?: string;
  /**
   * Optional. Deferred-fund-capture merchants only — captures a Zip order (idempotent retry).
   * Auto-capture (`capture: true` on create) does not need this URL.
   */
  zipCaptureUrl?: string;
  /**
   * Creates a Link Stripe PaymentIntent (`payment_method_types: ['link', 'card']`).
   * Returns clientSecret. Required for real Link. Catalog amount is authoritative.
   * Does not replace createPaymentUrl (card / Apple Pay remain card-only).
   */
  linkCreatePaymentUrl?: string;
  /**
   * Creates an Amazon Pay Stripe PaymentIntent (`payment_method_types: ['amazon_pay']`).
   * Returns clientSecret. Required for real Amazon Pay. Catalog amount is authoritative.
   * Does not replace createPaymentUrl (card / Apple Pay remain card-only).
   */
  amazonPayCreatePaymentUrl?: string;
  /**
   * Creates an Alipay Stripe PaymentIntent (`payment_method_types: ['alipay']`).
   * Returns clientSecret. Required for real Alipay. Catalog amount is authoritative.
   */
  alipayCreatePaymentUrl?: string;
  /**
   * Optional. Not required for the standard Stripe Payment Element + PaymentIntent flow.
   * Reserved for future provider flows that need an explicit server confirm step.
   */
  confirmPaymentUrl?: string;
}

export interface EasyPaymentsProviderConfig {
  stripe?: StripeProviderConfig;
  paypal?: PayPalProviderConfig;
  applePay?: ApplePayProviderConfig;
  googlePay?: GooglePayProviderConfig;
  klarna?: KlarnaProviderConfig;
  affirm?: AffirmProviderConfig;
  usBankAccount?: UsBankAccountProviderConfig;
  cashAppPay?: CashAppPayProviderConfig;
  afterpay?: AfterpayProviderConfig;
  venmo?: VenmoProviderConfig;
  zip?: ZipProviderConfig;
  link?: LinkProviderConfig;
  amazonPay?: AmazonPayProviderConfig;
  alipay?: AlipayProviderConfig;
}

export interface EasyPaymentsConfig {
  providers: EasyPaymentsProviderConfig;
  backend?: EasyPaymentsBackendConfig;
  /**
   * When true, every provider uses a mock adapter.
   * Mock mode never processes a real payment and must not be used in production.
   */
  enableMockMode?: boolean;
}

export const PROVIDER_DISPLAY_NAMES: Record<keyof EasyPaymentsProviderConfig, string> = {
  stripe: 'Stripe',
  paypal: 'PayPal',
  applePay: 'Apple Pay',
  googlePay: 'Google Pay',
  klarna: 'Klarna',
  affirm: 'Affirm',
  usBankAccount: 'US bank account',
  cashAppPay: 'Cash App Pay',
  afterpay: 'Afterpay',
  venmo: 'Venmo',
  zip: 'Zip',
  link: 'Link',
  amazonPay: 'Amazon Pay',
  alipay: 'Alipay',
};

export const PROVIDER_REQUIRED_FIELD_LABEL: Record<keyof EasyPaymentsProviderConfig, string> = {
  stripe: 'publishableKey missing',
  paypal: 'clientId missing',
  applePay: 'configuration missing (requires Stripe publishableKey + createPaymentUrl)',
  googlePay: 'configuration missing (requires Stripe publishableKey for gateway)',
  klarna: 'configuration missing (requires Stripe publishableKey + klarnaCreatePaymentUrl)',
  affirm: 'configuration missing (requires Stripe publishableKey + affirmCreatePaymentUrl)',
  usBankAccount:
    'configuration missing (requires Stripe publishableKey + createUsBankAccountPaymentUrl)',
  cashAppPay:
    'configuration missing (requires Stripe publishableKey + cashAppPayCreatePaymentUrl)',
  afterpay: 'configuration missing (requires Stripe publishableKey + afterpayCreatePaymentUrl)',
  venmo:
    'configuration missing (requires providers.venmo + PayPal clientId + paypal create/capture URLs)',
  zip: 'configuration missing (requires providers.zip + zipCreateCheckoutUrl + zipVerifyReturnUrl)',
  link: 'configuration missing (requires Stripe publishableKey + linkCreatePaymentUrl)',
  amazonPay:
    'configuration missing (requires Stripe publishableKey + amazonPayCreatePaymentUrl)',
  alipay: 'configuration missing (requires Stripe publishableKey + alipayCreatePaymentUrl)',
};

export type ProviderConfigStatus =
  | 'configured'
  | 'missing'
  | 'invalid'
  | 'not_requested';

export interface ProviderValidationResult {
  provider: keyof EasyPaymentsProviderConfig;
  status: ProviderConfigStatus;
  message?: string;
}
