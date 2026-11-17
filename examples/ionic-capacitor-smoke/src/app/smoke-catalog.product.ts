/**
 * Ionic smoke checkout product — must match Nest `premium-plan` catalog pricing.
 * Server remains authoritative for Stripe PaymentIntents and PayPal Orders.
 */
export const SMOKE_PRODUCT = {
  id: 'premium-plan',
  name: 'Premium Plan',
  description: 'Ionic Capacitor smoke product',
  amount: 99,
  currency: 'USD',
  quantity: 1,
} as const;

/** Nest catalog unit amount for `premium-plan` (major units). */
export const SMOKE_CATALOG_UNIT_AMOUNT = 99;
export const SMOKE_CATALOG_CURRENCY = 'USD';
