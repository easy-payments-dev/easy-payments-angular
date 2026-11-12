import type { StripePaymentElementOptions } from '@stripe/stripe-js';
import { appendMetadataSessionPart } from '../../metadata/merchant-metadata';

export type UsBankAccountUiState =
  | 'idle'
  | 'initializing'
  | 'loading-session'
  | 'ready'
  | 'processing'
  /** Verified async debit — loading exited; retry locked until a new attempt. */
  | 'pending'
  | 'success'
  | 'error';

export interface UsBankAccountSessionResult {
  clientSecret: string;
  sessionId?: string;
  paymentIntentId?: string;
}

/**
 * Payment Element options for Easy Payments ACH (US bank account via Stripe).
 * Method availability is controlled by the PaymentIntent
 * (`payment_method_types: ['us_bank_account']`). These options keep wallets off.
 */
export const US_BANK_ACCOUNT_PAYMENT_ELEMENT_OPTIONS: StripePaymentElementOptions = {
  layout: {
    type: 'tabs',
  },
  wallets: {
    applePay: 'never',
    googlePay: 'never',
    link: 'never',
  },
};

/**
 * Stable session identity for ACH PaymentIntent reuse.
 * Theme is intentionally excluded — appearance updates must not recreate intents.
 * Amount is excluded — the backend prices from the trusted catalog.
 */
export function buildUsBankAccountSessionKey(
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
