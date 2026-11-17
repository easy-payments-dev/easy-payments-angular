/**
 * Ionic Capacitor smoke defaults — Mock mode only.
 * Copy environment.local.example.ts → environment.local.ts for sandbox keys (gitignored).
 */
export const environment = {
  production: false,
  /**
   * When true, use provideEasyPayments({ enableMockMode: true }).
   * Sandbox (Real) mode requires environment.local.ts publishable keys + Nest on :3001.
   */
  useMockMode: true,
  stripePublishableKey: '',
  paypalClientId: '',
  /** Host machine from Android emulator is 10.0.2.2; browser uses 127.0.0.1. */
  backendBaseUrl: 'http://127.0.0.1:3001',
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
   * Native-only Stripe BNPL App Link return (absolute https).
   * Browser checkout leaves this empty and uses the current page (same-origin).
   * Example: https://smoke-return.example.com/capacitor-return
   */
  nativeStripeReturnUrl: '',
  /**
   * Android Sandbox only: HTTPS URL of the working web Venmo checkout (temporary tunnel).
   * When Venmo is ineligible in the WebView, smoke opens this in Chrome.
   */
  venmoSandboxCheckoutUrl: '',
  /** Read-only PayPal order status (App Link verification). */
  paypalOrderStatusUrl: '/api/payments/paypal/status',
  /** Nest Venmo handoff create (Orders v2 + payment_source.venmo). */
  paypalVenmoHandoffUrl: '/api/payments/paypal/venmo/handoff',
  /** Nest Venmo complete (reconcile attempt + idempotent capture). */
  paypalVenmoCompleteUrl: '/api/payments/paypal/venmo/complete',
};
