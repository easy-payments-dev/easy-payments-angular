# Headless Checkout (v1.2.0 — in progress)

Headless Checkout is the third Easy Payments integration experience:

1. **Full Checkout** — `<easy-payments>`
2. **Buttons Only** — `<easy-payment-buttons>`
3. **Headless Checkout** — public Angular session API (`EasyPaymentsHeadless`)

## Current status

| Area | Status |
|------|--------|
| Session create / initialize / destroy | **Supported (H2)** |
| Method readiness + selection | **Supported (H2)** |
| Stripe **Card** mount + confirm | **Supported (H3.1)** |
| **Klarna** + **Affirm** mount + confirm | **Supported (H3.2)** — see redirect limitation |
| PayPal / Google Pay / Apple Pay mount | Not yet (later H3.x) |
| BNPL / Stripe redirect recovery for Headless | Not yet (**H4**) |
| Demo Headless experience | Not yet (H5) |

**Card, Klarna, and Affirm** are the supported Headless payment methods. PayPal and wallets are not mountable yet.

## Shared mount / confirm API

```typescript
await session.mount('card' | 'klarna' | 'affirm', container);
session.selectMethod(/* same method — also applied by mount */);
await session.confirm(); // merchant-owned button
const handle = /* from mount */;
await handle.unmount(); // idempotent
await session.destroy();
```

Do not use separate `confirmKlarna()` / `confirmAffirm()` APIs — route through `confirm()` and `selectedMethod()`.

## Stripe Card (H3.1)

Merchants own layout and the confirm button. Easy Payments mounts the **official Stripe Payment Element** into a merchant-provided container and confirms through the existing `StripeCardAdapter`.

### Requirements

- `provideEasyPayments` with a Stripe **publishable** key and `backend.createPaymentUrl`
- A merchant-owned `HTMLElement` container (visible in the DOM)
- Backend that creates a PaymentIntent and returns `clientSecret` (never put secret keys in Angular)
- Fulfillment via **webhooks / server retrieve** — Headless `success` is a UX signal, not sole proof of payment

### Example

```typescript
import { inject, ElementRef } from '@angular/core';
import {
  EasyPaymentsHeadless,
  type HeadlessCheckoutSession,
  type HeadlessMountHandle,
} from '@easy-payments/angular';

const headless = inject(EasyPaymentsHeadless);
const mountHost = inject(ElementRef<HTMLElement>); // your container

const session: HeadlessCheckoutSession = headless.createSession({
  product: { id: 'sku_1', name: 'Plan', amount: 20, currency: 'USD' },
  methods: ['card'],
  checkoutInstanceId: 'account-checkout',
  theme: 'light',
  locale: 'en',
});

await session.initialize();
session.selectMethod('card');

const handle: HeadlessMountHandle = await session.mount(
  'card',
  mountHost.nativeElement,
);

session.events.started.subscribe(() => { /* lock UI */ });
session.events.success.subscribe((result) => { /* show receipt; still verify on backend */ });
session.events.pending.subscribe((result) => { /* await webhooks; do not retry */ });
session.events.cancel.subscribe(() => { /* buyer cancelled */ });
session.events.error.subscribe((err) => { /* show error; may remount/retry */ });

// Merchant-owned button:
async function onPayClick() {
  await session.confirm();
}

// Later:
await handle.unmount(); // idempotent; does not destroy the session
await session.destroy();  // unmounts + releases session id
```

## Klarna & Affirm (H3.2)

Both use the **existing** Stripe-backed adapters (`KlarnaAdapter` / `AffirmAdapter`) and the official Stripe Payment Element. Easy Payments does **not** collect BNPL credentials or render custom BNPL forms.

### Requirements

| Method | Config | Backend | Eligibility notes |
|--------|--------|---------|-------------------|
| Klarna | `providers.klarna` + Stripe publishable key | `backend.klarnaCreatePaymentUrl` | Supported presentment currencies (e.g. USD, EUR, GBP, …) |
| Affirm | `providers.affirm` + Stripe publishable key | `backend.affirmCreatePaymentUrl` | USD/CAD; minimum presentment total (~$35) |

Availability is the same as Full Checkout / Buttons Only — ineligible carts stay `available: false`.

### Example

```typescript
const session = headless.createSession({
  product: { id: 'sku_1', name: 'Plan', amount: 99, currency: 'USD' },
  methods: ['card', 'klarna', 'affirm'],
  checkout: { successUrl: 'https://merchant.example/checkout/return' },
  checkoutInstanceId: 'account-checkout',
});

await session.initialize();

// Klarna
const klarnaHost = document.getElementById('klarna-slot')!;
await session.mount('klarna', klarnaHost);
await session.confirm(); // merchant CTA

// Or switch to Affirm (unmounts prior Stripe Element for this session)
const affirmHost = document.getElementById('affirm-slot')!;
await session.mount('affirm', affirmHost);
await session.confirm();
```

### Redirect limitation (H4)

Klarna and Affirm often **redirect** the buyer to an external authorization flow.

H3.2 preserves adapter `return_url` stamping (`ep_method=klarna|affirm` and an attempt id) so a future Headless recovery path can identify the method.

H3.2 does **not**:

- Write Full Checkout / Buttons Only redirect ownership markers (`hostKind: 'checkout' | 'buttons'`)
- Resume a Headless session after a full-page redirect
- Treat “browser came back from redirect” as verified payment success

**Backend webhooks / PaymentIntent retrieve remain authoritative.**

Until **H4**, merchants should:

1. Prefer verifying fulfillment on the server after any BNPL attempt
2. Treat Headless `success` / `pending` as UX only
3. Expect that a hard redirect away from the page ends the in-memory Headless session — remount/recreate after return is a merchant + H4 concern

Minimal H4 dependency: Headless-aware Stripe return ownership (`hostKind: 'headless'` or equivalent) wired through `StripeRedirectRecoveryService` / `CheckoutHostContext`, without letting Full Checkout or Buttons Only claim Headless returns.

### Lifecycle (Card / Klarna / Affirm)

1. `initialize()` → `ready`
2. `selectMethod(...)` (also applied automatically by `mount`)
3. `mount(method, container)` → PaymentIntent session + Payment Element
4. Merchant CTA → `confirm()` → `processing`
5. Terminal: `success` | `pending` | `cancelled` | `error`
6. `handle.unmount()` and/or `session.destroy()` for cleanup

If confirmation still requires customer authentication / redirect without a same-page result, Headless moves to **`pending`** (not `success`) and documents the H4 gap — never invent a false success.

### States & events

| Transition | Events |
|------------|--------|
| confirm starts | `started` |
| PaymentIntent succeeded / requires_capture | `success`, state `success` |
| PaymentIntent processing or auth still required | `pending`, state `pending` (do **not** retry casually) |
| Cancelled | `cancel`, state `cancelled` |
| Failure | `error`, state `error` (retry/remount when appropriate) |

Client secrets are **not** exposed on session signals, events, or diagnostics.

### Errors

Typed `PaymentError` cases include: invalid container, unsupported method (PayPal/wallets), method unavailable / ineligible BNPL, mount failure, confirm without mount, wrong selected method, duplicate confirm, concurrent Stripe confirmation (page gate), destroyed session, backend failure, confirmation failure, cancellation.

### Multi-instance

Each Headless session uses its own Stripe Element owner id (the session `id`). Sibling sessions can mount independently. Switching Card ↔ Klarna ↔ Affirm within one session unmounts the previous Element for that owner. At most one Stripe confirmation may run on the page at a time (existing confirmation gate).

### Security

- Publishable key only in the browser
- No raw card / BNPL secrets in Easy Payments
- Official Stripe Payment Element only
- Backend must re-price / authorize; webhooks remain authoritative for fulfillment

## Session foundation (H2+)

```typescript
const session = headless.createSession({
  product: { id: 'sku_1', name: 'Plan', amount: 20, currency: 'USD' },
  methods: ['card', 'klarna', 'paypal'], // paypal not mountable yet
  checkoutInstanceId: 'account-checkout',
});

await session.initialize();
session.availableMethods(); // readiness projection
await session.destroy();
```

Apple Pay may still report `readiness: 'loading'` until an Express Checkout Element can mount in a later milestone.

## Not supported yet

- `mount('paypal' | 'google-pay' | 'apple-pay', …)`
- Headless demo mode in the playground
- Complete Headless BNPL redirect recovery after leave-page authorization (**H4**)

Full Checkout and Buttons Only are unchanged; Headless is additive.
