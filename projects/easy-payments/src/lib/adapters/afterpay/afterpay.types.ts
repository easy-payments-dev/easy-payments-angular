import type { StripePaymentElementOptions } from '@stripe/stripe-js';
import { appendMetadataSessionPart } from '../../metadata/merchant-metadata';

export type AfterpayUiState =
  | 'idle'
  | 'initializing'
  | 'loading-session'
  | 'ready'
  | 'processing'
  /** Recovered PaymentIntent still processing at the provider — not an active submit. */
  | 'awaiting'
  | 'success'
  | 'error';

export interface AfterpaySessionResult {
  clientSecret: string;
  sessionId?: string;
  paymentIntentId?: string;
}

/**
 * Payment Element options for Easy Payments Afterpay (via Stripe).
 * Method availability is controlled by the PaymentIntent
 * (`payment_method_types: ['afterpay_clearpay']`). These options keep wallets off.
 * Afterpay is not supported by Stripe's Express Checkout Element.
 */
export const AFTERPAY_PAYMENT_ELEMENT_OPTIONS: StripePaymentElementOptions = {
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
 * Stable session identity for Afterpay PaymentIntent reuse.
 * Theme is intentionally excluded — appearance updates must not recreate intents.
 * Amount is excluded — the backend prices from the trusted catalog.
 */
export function buildAfterpaySessionKey(
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
