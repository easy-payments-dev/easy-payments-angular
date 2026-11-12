# Cash App Pay

Opt-in Cash App Pay for `@easy-payments/angular` 1.3.0 — Full Checkout, Payment Buttons Only, and Headless Checkout.

Cash App Pay in Easy Payments is **Stripe-backed** (Cash App–only PaymentIntent + Stripe Payment Element).
You do **not** configure a separate Cash App SDK in Angular for this integration.

Verified against current Stripe docs: Payment Element + Payment Intents is supported. Stripe does **not** support Cash App Pay in the Express Checkout Element. Easy Payments uses the Payment Element path for all three surfaces (not Express Checkout, not Buttons Direct BNPL mode).

## Eligibility (Stripe)

| Constraint | Requirement |
|------------|-------------|
| Merchant account | US (not US territories) |
| Customer | US |
| Presentment currency | USD |
| Minimum amount | $0.50 |
| Auth UX | Mobile redirect to Cash App; desktop QR via Payment Element |
| Auth window | About 10 minutes; expired intents return to `requires_payment_method` |

## Scope

- Available only when the host opts in with `'cash-app-pay'` in `[methods]` (or Headless `HeadlessSessionOptions.methods`).
- Requires `providers.cashAppPay: {}`, Stripe `publishableKey`, and `backend.cashAppPayCreatePaymentUrl`.
- Disabled by default (not in Full Checkout or Buttons default method lists).
- Reuses shared Stripe redirect recovery (`ep_method=cash-app-pay` + pending marker) like Klarna/Affirm.
- Buttons Direct BNPL mode (`bnplConfirmMode` / `confirmCashappPayment`) is **not** offered in this release — Cash App Pay always uses the Payment Element panel.

## Merchant configuration

```ts
provideEasyPayments({
  providers: {
    stripe: { publishableKey: 'pk_test_...' },
    cashAppPay: {},
  },
  backend: {
    cashAppPayCreatePaymentUrl: 'https://api.example.com/payments/cash-app-pay/create',
  },
});
```

### Full Checkout

```html
<easy-payments
  [product]="product"
  [methods]="['card', 'cash-app-pay']"
  (success)="onSuccess($event)"
  (pending)="onPending($event)"
  (cancel)="onCancel($event)"
  (error)="onError($event)"
/>
```

Library-owned outcome UI after confirm / return.

### Payment Buttons Only

Library selectors open the Cash App Pay Payment Element in the shared panel. Outcomes are **host-owned** via events (`success` / `pending` / `cancel` / `error`). With `chrome="minimal"`, the panel does not render completion chrome.

```html
<easy-payment-buttons
  [product]="product"
  [methods]="['card', 'cash-app-pay']"
  (success)="onSuccess($event)"
  (pending)="onPending($event)"
  (cancel)="onCancel($event)"
  (error)="onError($event)"
/>
```

```ts
// Merchant-owned selectors: host CTA opens Cash App Pay; library Pay confirms.
buttons.requestPayment('cash-app-pay');
```

### Headless Checkout

Mount the Cash App Pay Payment Element, then confirm with the merchant CTA. Host owns confirmation UI. Redirect returns use `session.recoverReturn()` with a stable `checkoutInstanceId`.

```ts
const session = headless.createSession({
  product,
  methods: ['cash-app-pay'],
  checkoutInstanceId: 'checkout-123',
});
await session.initialize();
session.selectMethod('cash-app-pay');
await session.mount('cash-app-pay', container);
await session.confirm();
// After redirect remount:
const recovered = await session.recoverReturn();
```

## Backend

Create a **Cash App–only** PaymentIntent with trusted catalog pricing:

```ts
payment_method_types: ['cashapp']
```

Return `{ provider: 'cashAppPay', clientSecret }`.

Demo route: `POST /api/payments/cash-app-pay/create`.

## Return recovery

1. Confirm stamps `ep_method=cash-app-pay` (+ `ep_attempt`) on `return_url` and a sessionStorage pending marker.
2. Stripe redirects (mobile) or completes after QR auth (desktop), appending `payment_intent` / `payment_intent_client_secret` / `redirect_status`.
3. Easy Payments claims ownership once, retrieves the **same** PaymentIntent (no second create/confirm), and emits a single outcome.
4. Duplicate submits while confirming are rejected by the confirmation gate.

## Testing (Stripe Test mode)

1. Enable Cash App Pay in the Stripe Dashboard (Test mode).
2. Run the Nest demo server with `STRIPE_SECRET_KEY=sk_test_...` and the Angular demo in Real / Test Providers mode.
3. Choose a USD catalog product ≥ $0.50.
4. Select **Cash App Pay** → Pay.
5. On Stripe’s test payment page, **Approve** or **Decline**.
6. Confirm return lands on the same origin URL, the original PaymentIntent is reconciled, and success/cancel/error fires once (no duplicate).
7. Repeat from Full Checkout, Buttons Only, and Headless.

Official docs:

- [Cash App Pay](https://docs.stripe.com/payments/cash-app-pay)
- [Accept a Cash App Pay payment](https://docs.stripe.com/payments/cash-app-pay/accept-a-payment)

## Common problems

| Symptom | Check |
|---------|-------|
| Method missing | Not opted in; currency not USD; amount &lt; $0.50; Cash App Pay not enabled in Stripe; create URL missing |
| Stuck after Pay | Return URL not same-origin; pending marker blocked; Headless missing stable `checkoutInstanceId` |
| Duplicate outcome | Already guarded — verify host is not double-subscribing or remounting confirm |
