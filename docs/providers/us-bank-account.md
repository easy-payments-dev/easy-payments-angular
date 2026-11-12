# US bank account (ACH Direct Debit)

Opt-in ACH for `@easy-payments/angular` 1.3.0 — Full Checkout, Payment Buttons Only, and Headless Checkout.

## Scope

- Available only when the host opts in with `'us-bank-account'` in `[methods]` (or Headless `HeadlessSessionOptions.methods`).
- Requires `providers.usBankAccount: {}`, Stripe `publishableKey`, and `backend.createUsBankAccountPaymentUrl`.
- Reuses the same ACH adapter, create endpoint, and PaymentIntent reconciliation across all three surfaces.
- Card continues to use `createPaymentUrl` with card-only PaymentIntents.

## Merchant configuration

```ts
provideEasyPayments({
  providers: {
    stripe: { publishableKey: 'pk_test_...' },
    usBankAccount: {},
  },
  backend: {
    createUsBankAccountPaymentUrl: 'https://api.example.com/payments/us-bank-account/create',
  },
});
```

### Full Checkout

```html
<easy-payments
  [product]="product"
  [methods]="['card', 'us-bank-account']"
  (pending)="onPending($event)"
  (success)="onSuccess($event)"
  (error)="onError($event)"
/>
```

### Payment Buttons Only

Library selectors open the ACH Payment Element in the shared panel. The library Pay button inside that panel is the confirm control (same pattern as Card). Optional `[cardButtonAppearance]` restyles that ACH CTA the same way it does Card.

In merchant-owned mode (`selectorVisibility="merchant"`), call `requestPayment('us-bank-account')` from your host CTA to open the panel — do **not** also confirm from the host. Keep a single active submit control: host opens, library Pay confirms.

```html
<easy-payment-buttons
  [product]="product"
  [methods]="['card', 'us-bank-account']"
  [cardButtonAppearance]="achPayAppearance"
  (pending)="onPending($event)"
  (success)="onSuccess($event)"
  (error)="onError($event)"
/>
```

```ts
// Merchant-owned selectors: host CTA opens ACH; library Pay remains the only confirm.
buttons.requestPayment('us-bank-account');
```

While confirming, the library Pay button shows the processing indicator. A verified result closes the ACH panel and emits once: `processing` → `(pending)` (retry locked via `methodsLocked` / `requestPayment` blocked), `succeeded` → `(success)`. The host owns any pending/success messaging. Redirect returns recover the same PaymentIntent via retrieve only — never a second create/confirm.

### Headless Checkout

Mount the ACH Payment Element, then confirm with the merchant CTA. Late confirmations after `pending` are rejected — do not start another payment.

```ts
const session = headless.createSession({
  product,
  methods: ['us-bank-account'],
  checkoutInstanceId: 'checkout-123',
});
await session.initialize();
session.selectMethod('us-bank-account');
await session.mount('us-bank-account', container);
session.events.pending.subscribe((result) => {
  // status === 'processing' — await webhooks; do not retry confirm()
});
await session.confirm();
```

## Pending vs success

ACH debits often settle asynchronously.

| Stripe PaymentIntent status | Library result | Host event |
|---|---|---|
| `processing` | `PaymentResult.status === 'processing'` | `(pending)` / `events.pending` — **not** success |
| `succeeded` | `status: 'success'` | `(success)` / `events.success` — browser UX only |
| `requires_action` / `requires_confirmation` | error (`AUTHENTICATION_REQUIRED`) | `(error)` — not success |
| `canceled` | `status: 'cancelled'` | `(cancel)` |

**Do not fulfill an order from a browser `success` or `pending` event alone.** Treat `(pending)` as “customer authorized; bank is still settling.”

Customer-facing Full Checkout pending copy is intentionally non-technical (“Payment submitted” / “Your payment is being processed…”). Stripe PaymentIntent status, backend reconciliation, and webhook settlement guidance stay in this doc and in demo diagnostics — not in the shopper UI.

Buttons Only and Headless surface the same `processing` → pending mapping; hosts own outcome chrome for those modes.

## Backend confirmation (webhooks)

1. Create the PaymentIntent on your server with `payment_method_types: ['us_bank_account']` and a **catalog** amount (never trust a browser amount).
2. Listen for Stripe webhook events with a verified signature, especially:
   - `payment_intent.processing`
   - `payment_intent.succeeded`
   - `payment_intent.payment_failed`
   - `payment_intent.canceled`
3. Map your order to the PaymentIntent id from create-time metadata.
4. Mark the order paid only after a **verified** `payment_intent.succeeded` (or your capture policy for `requires_capture`).
5. On `payment_intent.payment_failed` / `canceled`, leave the order unpaid and allow a new attempt with a new PaymentIntent.

The NestJS demo endpoint `POST /api/payments/us-bank-account/create` shows catalog pricing and ACH-only PaymentIntents. It is not a production webhook handler.

## Demo mode

`MockPaymentController.setOutcome('processing')` returns a processing `PaymentResult` so Full Checkout, Buttons Only, and Headless can emit pending without Stripe. Existing `success` / `cancelled` / `failed` outcomes are unchanged.

## Known gaps

- Microdeposit / leave-page verification return recovery is tracked separately and is **not** fully claimed in this milestone.
- Financial Connections may still open Stripe-hosted UI; if Stripe requires a full-page return the library recovers via `ep_method=us-bank-account` + retrievePaymentIntent when those query params are present (Full Checkout panel, Buttons Only host-owned recover, Headless `recoverReturn()`).
