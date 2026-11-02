# Headless Checkout (v1.2.0 — in progress)

Headless Checkout is the third Easy Payments integration experience:

1. **Full Checkout** — `<easy-payments>`
2. **Buttons Only** — `<easy-payment-buttons>`
3. **Headless Checkout** — public Angular session API (`EasyPaymentsHeadless`)

This document describes the **H2 foundation** only.

## Current status (H2)

Supported:

- Create an independently owned checkout session
- Initialize provider adapters via the existing orchestrator
- Project per-session method readiness / availability
- Select a payment method (session-local; does not start payment)
- Destroy a session safely (idempotent)

**Not supported yet:**

- Mounting official provider UI (Stripe Payment Element, PayPal Buttons, wallets) — **H3**
- Confirming or capturing payments — **H3**
- Redirect recovery for Klarna / Affirm — **H4**
- Demo Headless experience — **H5**

Do not treat H2 as a complete Headless payment integration.

## Quick start (H2)

```typescript
import { inject } from '@angular/core';
import {
  EasyPaymentsHeadless,
  type HeadlessCheckoutSession,
} from '@easy-payments/angular';

const headless = inject(EasyPaymentsHeadless);

const session: HeadlessCheckoutSession = headless.createSession({
  product: { id: 'sku_1', name: 'Plan', amount: 20, currency: 'USD' },
  methods: ['card', 'paypal', 'apple-pay'],
  checkoutInstanceId: 'account-checkout', // optional; unique among live sessions
});

await session.initialize();

// Reactive readiness (Angular Signal)
session.availableMethods(); // HeadlessMethodStatus[]

session.selectMethod('card');
session.events.methodChange.subscribe((event) => {
  // selection only — no payment
});

await session.destroy();
```

## Notes

- `lastResult` remains `null` in H2 (no payment execution).
- Lifecycle Observables `started` / `pending` / `success` / `cancel` are declared for future use and are **not** emitted in H2.
- `error` may emit when `initialize()` fails.
- Apple Pay may report `readiness: 'loading'` until an Express Checkout Element can mount in H3 — H2 does not mark it permanently unavailable for that reason.
- Full Checkout and Buttons Only are unchanged; Headless is additive.
