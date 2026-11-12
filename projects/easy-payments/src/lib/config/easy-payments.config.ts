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
 * Full Checkout only in 1.3.0 — not offered by Buttons Only or Headless.
 */
export interface UsBankAccountProviderConfig {
  /** ISO country for ACH purchase context (default US). */
  purchaseCountry?: string;
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
