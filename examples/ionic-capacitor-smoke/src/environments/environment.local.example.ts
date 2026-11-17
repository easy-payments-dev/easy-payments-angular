/**
 * Copy to environment.local.ts (gitignored) for Capacitor / browser sandbox runs.
 * Use TEST / sandbox credentials only — never live keys.
 */
export const environment = {
  production: false,
  useMockMode: false,
  stripePublishableKey: 'pk_test_REPLACE',
  paypalClientId: 'SANDBOX_CLIENT_ID_REPLACE',
  /** Android emulator → host loopback. Browser / iOS sim may use 127.0.0.1. */
  backendBaseUrl: 'http://10.0.2.2:3001',
  createPaymentUrl: '/api/payments/create',
  paypalCreateOrderUrl: '/api/payments/paypal/create',
  paypalCaptureOrderUrl: '/api/payments/paypal/capture',
  klarnaCreatePaymentUrl: '/api/payments/klarna/create',
  affirmCreatePaymentUrl: '/api/payments/affirm/create',
  createUsBankAccountPaymentUrl: '/api/payments/us-bank-account/create',
  cashAppPayCreatePaymentUrl: '/api/payments/cash-app-pay/create',
  afterpayCreatePaymentUrl: '/api/payments/afterpay/create',
  zipCreateCheckoutUrl: '/api/payments/zip/create',
  zipVerifyReturnUrl: '/api/payments/zip/verify',
  zipCaptureUrl: '/api/payments/zip/capture',
  catalogProductUrl: '/api/catalog/products',
  /**
   * Required for Android leave-app Klarna/Affirm/Cash App/Afterpay returns.
   * Must be https on a domain you control; publish assetlinks.json and patch
   * the Android App Link intent-filter (see docs/ionic-capacitor-compatibility.md).
   */
  nativeStripeReturnUrl: 'https://www.easy-payments.dev/capacitor-return',
  /**
   * Android Sandbox Venmo Chrome fallback — temporary HTTPS tunnel to the working
   * web Venmo checkout (demo). Leave empty to hide the fallback CTA.
   */
  venmoSandboxCheckoutUrl: 'https://YOUR_FRONTEND_TUNNEL.trycloudflare.com/',
  paypalOrderStatusUrl: '/api/payments/paypal/status',
  paypalVenmoHandoffUrl: '/api/payments/paypal/venmo/handoff',
  paypalVenmoCompleteUrl: '/api/payments/paypal/venmo/complete',
};
