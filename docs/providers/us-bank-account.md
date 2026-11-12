# US bank account (ACH Direct Debit)

Opt-in ACH for **Full Checkout** in `@easy-payments/angular` 1.3.0.

## Scope

- Available only when the host passes `'us-bank-account'` in `<easy-payments [methods]>`.
- Requires `providers.usBankAccount: {}`, Stripe `publishableKey`, and `backend.createUsBankAccountPaymentUrl`.
- **Not** offered by Buttons Only or Headless in this release.
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

```html
<easy-payments
  [product]="product"
  [methods]="['card', 'us-bank-account']"
  (pending)="onPending($event)"
  (success)="onSuccess($event)"
  (error)="onError($event)"
/>
```

## Pending vs success

ACH debits often settle asynchronously.

| Stripe PaymentIntent status | Library result | Host event |
|---|---|---|
| `processing` | `PaymentResult.status === 'processing'` | `(pending)` — **not** success |
| `succeeded` | `status: 'success'` | `(success)` — browser UX only |
| `requires_action` / `requires_confirmation` | error (`AUTHENTICATION_REQUIRED`) | `(error)` — not success |
| `canceled` | `status: 'cancelled'` | `(cancel)` |

**Do not fulfill an order from a browser `success` or `pending` event alone.** Treat `(pending)` as “customer authorized; bank is still settling.”

Customer-facing Full Checkout pending copy is intentionally non-technical (“Payment submitted” / “Your payment is being processed…”). Stripe PaymentIntent status, backend reconciliation, and webhook settlement guidance stay in this doc and in demo diagnostics — not in the shopper UI.

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

`MockPaymentController.setOutcome('processing')` returns a processing `PaymentResult` so Full Checkout can show the pending screen without Stripe. Existing `success` / `cancelled` / `failed` outcomes are unchanged.

## Known gaps

- Microdeposit / leave-page verification return recovery is **not** claimed in this milestone.
- Financial Connections may still open Stripe-hosted UI; if Stripe requires a full-page return the library does not recover via `ep_method` today.
- Buttons Only and Headless ACH are deferred.
