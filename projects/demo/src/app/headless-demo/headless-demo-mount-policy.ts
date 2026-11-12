import type { PaymentMethod } from '@easy-payments/angular';

/**
 * Stripe Card / Klarna / Affirm / US bank account / Cash App Pay use Payment Element + merchant `session.confirm()`.
 */
export function isHeadlessDemoStripeElementMethod(method: PaymentMethod): boolean {
  return (
    method === 'card' ||
    method === 'klarna' ||
    method === 'affirm' ||
    method === 'us-bank-account' ||
    method === 'cash-app-pay'
  );
}

/**
 * PayPal / Google Pay / Apple Pay mount official SDK controls that start payment
 * on buyer click. Do not call `session.confirm()` for these methods.
 */
export function isHeadlessDemoOfficialButtonMethod(method: PaymentMethod): boolean {
  return method === 'paypal' || method === 'google-pay' || method === 'apple-pay';
}

/** @deprecated H5.3 mounts all official methods; kept for test compatibility. */
export function isHeadlessDemoMountDeferred(_method: PaymentMethod): boolean {
  return false;
}

/** Transient recovery verification failures that are safe to retry with recoverReturn(). */
export function isHeadlessDemoRecoveryRetryable(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const code = 'code' in error ? String((error as { code?: unknown }).code ?? '') : '';
  return code === 'NETWORK_ERROR' || code === 'SDK_LOAD_FAILED';
}
