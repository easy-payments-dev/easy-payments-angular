/**
 * LOCAL demo credentials — gitignored.
 *
 * Copy from environment.local.example.ts:
 *   cp projects/demo/src/environments/environment.local.example.ts ^
 *      projects/demo/src/environments/environment.local.ts
 *
 * Then replace YOUR_* placeholders with TEST keys only.
 * Never commit this file.
 *
 * backendBaseUrl is optional. Leave it empty to keep the absolute URLs below.
 * Set it to 'http://localhost:3001' only if the endpoint fields are relative paths.
 */
export const environment = {
  production: false,
  stripePublishableKey: 'YOUR_STRIPE_PUBLISHABLE_KEY',
  paypalClientId: 'YOUR_PAYPAL_CLIENT_ID',
  backendBaseUrl: 'http://localhost:3001',
  createPaymentUrl: '/api/payments/create',
  paypalCreateOrderUrl: '/api/payments/paypal/create',
  paypalCaptureOrderUrl: '/api/payments/paypal/capture',
  klarnaCreatePaymentUrl: '/api/payments/klarna/create',
  affirmCreatePaymentUrl: '/api/payments/affirm/create',
  catalogProductUrl: 'http://localhost:3001/api/catalog/products',
};
