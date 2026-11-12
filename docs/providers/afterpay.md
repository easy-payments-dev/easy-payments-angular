# Afterpay (Clearpay)

Opt-in Afterpay/Clearpay for `@easy-payments/angular` — Full Checkout, Payment Buttons Only, and Headless Checkout.

Afterpay in Easy Payments is **Stripe-backed** (Afterpay/Clearpay-only PaymentIntent + Stripe Payment Element).
You do **not** configure a separate Afterpay SDK in Angular for this integration.

Verified against current Stripe docs: Payment Element + Payment Intents is supported. Easy Payments uses the Payment Element path for all three surfaces (not Express Checkout, not Buttons Direct BNPL mode).

## Eligibility (Stripe)

| Constraint | Requirement |
|------------|-------------|
| Merchant / customer | Australia, Canada, New Zealand, United Kingdom, United States (domestic) |
| Presentment currencies | USD, CAD, AUD, NZD, GBP |
| Amount limits | USD 1–4000 · CAD 1–2000 · AUD 1–4000 · NZD 1–4000 · GBP 1–1200 |
| Auth UX | Redirect to Afterpay/Clearpay (or in-element flow); return via `return_url` |
| Naming | Stripe shows **Clearpay** in the UK; Easy Payments selectors use the Afterpay lockup |

## Scope

- Available only when the host opts in with `'afterpay'` in `[methods]` (or Headless `HeadlessSessionOptions.methods`).
- Requires `providers.afterpay: {}`, Stripe `publishableKey`, and `backend.afterpayCreatePaymentUrl`.
- Disabled by default (not in Full Checkout or Buttons default method lists).
- Reuses shared Stripe redirect recovery (`ep_method=afterpay` + pending marker) like Klarna/Affirm/Cash App Pay.
- Buttons Direct BNPL mode (`bnplConfirmMode`) is **not** offered for Afterpay — always Payment Element panel.

## Merchant configuration

```ts
provideEasyPayments({
  providers: {
    stripe: { publishableKey: 'pk_test_...' },
    afterpay: {},
  },
  backend: {
    afterpayCreatePaymentUrl: 'https://api.example.com/payments/afterpay/create',
  },
});
```

### Full Checkout

```html
<easy-payments
  [product]="product"
  [methods]="['card', 'afterpay']"
  (success)="onSuccess($event)"
  (pending)="onPending($event)"
  (cancel)="onCancel($event)"
  (error)="onError($event)"
/>
```

Library-owned outcome UI after confirm / return.

### Payment Buttons Only

Library selectors open the Afterpay Payment Element in the shared panel. Outcomes are **host-owned** via events (`success` / `pending` / `cancel` / `error`). With `chrome="minimal"`, the panel does not render completion chrome.

```html
<easy-payment-buttons
  [product]="product"
  [methods]="['card', 'afterpay']"
  (success)="onSuccess($event)"
  (pending)="onPending($event)"
  (cancel)="onCancel($event)"
  (error)="onError($event)"
/>
```

```ts
// Merchant-owned selectors: host CTA opens Afterpay; library Pay confirms.
buttons.requestPayment('afterpay');
```

### Headless Checkout

Mount the Afterpay Payment Element, then confirm with the merchant CTA. Host owns confirmation UI. Redirect returns use `session.recoverReturn()` with a stable `checkoutInstanceId`.

```ts
const session = headless.createSession({
  product,
  methods: ['afterpay'],
  checkoutInstanceId: 'checkout-123',
});
await session.initialize();
session.selectMethod('afterpay');
await session.mount('afterpay', container);
await session.confirm();
// After redirect remount:
const recovered = await session.recoverReturn();
```

## Backend

Create an **Afterpay/Clearpay-only** PaymentIntent with trusted catalog pricing:

```ts
payment_method_types: ['afterpay_clearpay']
```

Return `{ provider: 'afterpay', clientSecret }`.

Enforce currency + amount limits server-side (same ranges as the Angular adapter).

Demo route: `POST /api/payments/afterpay/create`.

## Return recovery

1. Confirm stamps `ep_method=afterpay` (+ `ep_attempt`) on `return_url` and a sessionStorage pending marker.
2. Stripe redirects to Afterpay/Clearpay and back, appending `payment_intent` / `payment_intent_client_secret` / `redirect_status`.
3. Easy Payments claims ownership once, retrieves the **same** PaymentIntent (no second create/confirm), and emits a single outcome.
4. Duplicate submits while confirming are rejected by the confirmation gate.

## Testing (Stripe Test mode)

1. Enable Afterpay/Clearpay in the Stripe Dashboard (Test mode).
2. Run the Nest demo server with `STRIPE_SECRET_KEY=sk_test_...` and the Angular demo in Real / Test Providers mode.
3. Choose a catalog product in a supported currency within that currency’s min/max (e.g. USD ≥ $1 and ≤ $4000).
4. Select **Afterpay** → Pay.
5. On Stripe’s test payment page, **Approve** or **Decline**.
6. Confirm return lands on the same origin URL, the original PaymentIntent is reconciled, and success/cancel/error fires once (no duplicate).
7. Repeat from Full Checkout, Buttons Only, and Headless.

Official docs:

- [Afterpay and Clearpay payments](https://docs.stripe.com/payments/afterpay-clearpay)
- [Accept an Afterpay or Clearpay payment](https://docs.stripe.com/payments/afterpay-clearpay/accept-a-payment)

## Common problems

| Symptom | Check |
|---------|-------|
| Method missing | Not opted in; currency unsupported; amount outside limits; Afterpay not enabled in Stripe; create URL missing |
| Stuck after Pay | Return URL not same-origin; pending marker blocked; Headless missing stable `checkoutInstanceId` |
| Duplicate outcome | Already guarded — verify host is not double-subscribing or remounting confirm |
