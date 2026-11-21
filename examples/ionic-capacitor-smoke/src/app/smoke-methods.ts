/**
 * Default smoke-app method list. Zip is experimental (Sandbox E2E pending) and
 * is omitted here; include `'zip'` explicitly to exercise the existing opt-in path.
 * Link is included for web/Test-mode ECE checks; native Capacitor Link confirmation
 * is not claimed as verified — see docs/ionic-capacitor-compatibility.md.
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
  'link',
] as const;
