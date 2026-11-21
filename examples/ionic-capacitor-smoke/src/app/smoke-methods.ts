/**
 * Default smoke-app method list. Zip is experimental (Sandbox E2E pending) and
 * is omitted here; include `'zip'` explicitly to exercise the existing opt-in path.
 */
export const SMOKE_METHODS = [
  'card',
  'paypal',
  'apple-pay',
  'google-pay',
  'klarna',
  'affirm',
  'venmo',
  'us-bank-account',
  'cash-app-pay',
  'afterpay',
] as const;
