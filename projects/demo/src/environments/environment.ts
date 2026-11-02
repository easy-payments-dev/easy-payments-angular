/**
 * Demo environment — DO NOT put Stripe or PayPal secrets here.
 *
 * For Real / Test Providers mode:
 * 1. Replace placeholders with your TEST publishable / Client ID values.
 * 2. Keep backend URLs pointing at the NestJS demo server (or your API).
 * 3. Put secrets only in server/.env (see server/.env.example).
 *
 * Leave placeholders to use Demo/Mock mode only.
 */
export const environment = {
  production: false,
  /** Frontend-safe Stripe publishable key only (pk_test_... / pk_live_...). */
  stripePublishableKey: 'YOUR_STRIPE_PUBLISHABLE_KEY',
  /** Frontend-safe PayPal Client ID only. */
  paypalClientId: 'YOUR_PAYPAL_CLIENT_ID',
  /**
   * Optional origin for relative endpoint paths.
   * Leave empty to use the absolute URLs below unchanged.
   *
   * Local Angular proxy: '' and paths such as '/api/payments/create'.
   * NestJS on another port: 'http://localhost:3001' and paths such as '/api/payments/create'.
   * Production API: 'https://api.example.com' and paths such as '/api/payments/create'.
   */
  backendBaseUrl: '',
  createPaymentUrl: 'http://localhost:3001/api/payments/create',
  paypalCreateOrderUrl: 'http://localhost:3001/api/payments/paypal/create',
  paypalCaptureOrderUrl: 'http://localhost:3001/api/payments/paypal/capture',
  klarnaCreatePaymentUrl: 'http://localhost:3001/api/payments/klarna/create',
  affirmCreatePaymentUrl: 'http://localhost:3001/api/payments/affirm/create',
  catalogProductUrl: 'http://localhost:3001/api/catalog/products',
};
