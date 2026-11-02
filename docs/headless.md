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
| PayPal / Google Pay / Apple Pay / Klarna / Affirm mount | Not yet (later H3.x) |
| Redirect recovery | Not yet (H4) |
| Demo Headless experience | Not yet (H5) |

Card is the **first** supported Headless payment method. Do not assume other methods are mountable.

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

### Lifecycle

1. `initialize()` → `ready`
2. `selectMethod('card')` (also applied automatically by `mount('card', …)`)
3. `mount('card', container)` → creates PaymentIntent session + mounts Payment Element
4. Merchant CTA → `confirm()` → `processing`
5. Terminal: `success` | `pending` | `cancelled` | `error`
6. `handle.unmount()` and/or `session.destroy()` for cleanup

### States & events (Card)

| Transition | Events |
|------------|--------|
| confirm starts | `started` |
| PaymentIntent succeeded | `success`, state `success` |
| PaymentIntent processing | `pending`, state `pending` (do **not** retry) |
| Cancelled | `cancel`, state `cancelled` |
| Failure | `error`, state `error` (retry/remount when appropriate) |

Client secrets are **not** exposed on session signals, events, or diagnostics.

### Errors

Typed `PaymentError` cases include: invalid container, unsupported method (non-card), Card unavailable, mount failure, confirm without mount, wrong selected method, duplicate confirm, concurrent Stripe confirmation (page gate), destroyed session, backend failure.

### Multi-instance

Each Headless session uses its own Stripe Element owner id (the session `id`). Sibling sessions can mount independently. At most one Stripe confirmation may run on the page at a time (existing confirmation gate).

### Security

- Publishable key only in the browser
- No raw card data in Easy Payments
- Official Stripe Payment Element only
- Backend must re-price / authorize; webhooks remain authoritative for fulfillment

## Session foundation (H2+)

```typescript
const session = headless.createSession({
  product: { id: 'sku_1', name: 'Plan', amount: 20, currency: 'USD' },
  methods: ['card', 'paypal'], // paypal not mountable yet
  checkoutInstanceId: 'account-checkout',
});

await session.initialize();
session.availableMethods(); // readiness projection
await session.destroy();
```

Apple Pay may still report `readiness: 'loading'` until an Express Checkout Element can mount in a later milestone.

## Not supported yet

- `mount('paypal' | 'google-pay' | 'apple-pay' | 'klarna' | 'affirm', …)`
- Headless demo mode in the playground
- BNPL redirect recovery ownership for Headless hosts

Full Checkout and Buttons Only are unchanged; Headless is additive.
