import type { PaymentMethod } from '@easy-payments/angular';

/**
 * Official PayPal / Google Pay / Apple Pay mounts render actionable provider
 * controls whose clicks start payment. H5.2 defers those mounts until H5.3.
 *
 * Stripe Card / Klarna / Affirm mount Payment Element only; confirm() stays H5.3.
 */
export function isHeadlessDemoMountDeferred(method: PaymentMethod): boolean {
  return method === 'paypal' || method === 'google-pay' || method === 'apple-pay';
}

export function isHeadlessDemoStripeElementMethod(method: PaymentMethod): boolean {
  return method === 'card' || method === 'klarna' || method === 'affirm';
}
