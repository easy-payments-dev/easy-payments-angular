import type { StripePaymentElementOptions } from '@stripe/stripe-js';
import { appendMetadataSessionPart } from '../../metadata/merchant-metadata';

export type AlipayUiState =
  | 'idle'
  | 'initializing'
  | 'loading-session'
  | 'ready'
  | 'processing'
  /** Recovered PaymentIntent still processing at the provider — not an active submit. */
  | 'awaiting'
  | 'success'
  | 'error';

export interface AlipaySessionResult {
  clientSecret: string;
  sessionId?: string;
  paymentIntentId?: string;
}

/**
 * Stripe Alipay presentment currencies.
 * @see https://docs.stripe.com/payments/alipay
 */
export const ALIPAY_CURRENCIES = new Set([
  'AUD',
  'CAD',
  'CHF',
  'CNY',
  'EUR',
  'GBP',
  'HKD',
  'JPY',
  'MYR',
  'NZD',
  'SGD',
  'USD',
]);

/** Stripe Alipay minimum ~0.50 in major units for supported currencies. */
export const ALIPAY_MIN_AMOUNT = 0.5;

export function alipayAmountAllowed(currency: string, total: number): boolean {
  const code = currency.trim().toUpperCase();
  if (!ALIPAY_CURRENCIES.has(code) || !Number.isFinite(total)) {
    return false;
  }
  return total >= ALIPAY_MIN_AMOUNT && total <= 999_999.99;
}

/**
 * Payment Element options for Easy Payments Alipay (via Stripe).
 * Method availability is controlled by the PaymentIntent
 * (`payment_method_types: ['alipay']`). These options keep wallets off.
 * Alipay is not supported by Stripe's Express Checkout Element.
 */
export const ALIPAY_PAYMENT_ELEMENT_OPTIONS: StripePaymentElementOptions = {
  layout: {
    type: 'accordion',
  },
  wallets: {
    applePay: 'never',
    googlePay: 'never',
    link: 'never',
  },
};

/**
 * Stable session identity for Alipay PaymentIntent reuse.
 * Theme is intentionally excluded — appearance updates must not recreate intents.
 * Amount is excluded — the backend prices from the trusted catalog.
 */
export function buildAlipaySessionKey(
  product: {
    id: string;
    currency: string;
    quantity?: number;
    metadata?: Record<string, string>;
  },
  checkout?: { customer?: { email?: string; name?: string } } | null,
): string {
  const quantity = product.quantity ?? 1;
  const email = checkout?.customer?.email ?? '';
  const name = checkout?.customer?.name ?? '';
  return appendMetadataSessionPart(
    [product.id, quantity, product.currency, email, name].join('|'),
    product.metadata,
  );
}
