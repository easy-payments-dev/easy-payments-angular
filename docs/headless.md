# Headless Checkout — Merchant Integration Guide

Package: **`@easy-payments/angular`**

Headless Checkout is the third Easy Payments integration experience:

| Experience | API | Who owns layout |
|------------|-----|-----------------|
| **Full Checkout** | `<easy-payments>` | Easy Payments (product summary, method tiles, optional outcome screens) |
| **Buttons Only** | `<easy-payment-buttons>` | Merchant owns product/price UI; Easy Payments owns a compact button strip |
| **Headless Checkout** | `EasyPaymentsHeadless` + `HeadlessCheckoutSession` | Merchant owns **all** UI; Easy Payments mounts official provider controls into merchant containers |

This guide matches the **exported** public API. Do not import internal paths under `lib/adapters`, `lib/headless/headless-checkout-session`, or recovery helpers.

## A. Overview

Use Headless when you need full layout control (custom method lists, multi-step wizards, SPA shells) while still using the same adapters, backend contracts, and Stripe redirect recovery as Full Checkout / Buttons Only.

**Supported methods:** `card`, `klarna`, `affirm`, `paypal`, `google-pay`, `apple-pay`.

| Method | Merchant pays via | Official control |
|--------|-------------------|------------------|
| `card` / `klarna` / `affirm` | `session.confirm()` after mount | Stripe Payment Element |
| `paypal` | Buyer clicks PayPal Buttons | PayPal JS SDK Buttons |
| `google-pay` | Buyer clicks Google Pay button | Google Pay JS SDK |
| `apple-pay` | Buyer authorizes Apple Pay | Stripe Express Checkout Element |

`session.confirm()` **rejects** for PayPal, Google Pay, and Apple Pay (`CONFIG_INVALID`).

## B. Installation and configuration

Install and provide Easy Payments the same way as Full Checkout (see [getting-started.md](./getting-started.md) and [configuration.md](./configuration.md)):

```typescript
import { provideEasyPayments } from '@easy-payments/angular';

export const appConfig = {
  providers: [
    provideEasyPayments({
      providers: {
        stripe: { publishableKey: 'pk_test_…' }, // never sk_
        paypal: { clientId: '…' }, // never client secret
        googlePay: { environment: 'TEST', merchantName: 'Acme' },
        applePay: { merchantName: 'Acme', countryCode: 'US' },
        klarna: { /* Stripe-backed BNPL flags as documented */ },
        affirm: { /* Stripe-backed BNPL flags as documented */ },
      },
      backend: {
        createPaymentUrl: '/api/payments/create',
        klarnaCreatePaymentUrl: '/api/payments/klarna/create',
        affirmCreatePaymentUrl: '/api/payments/affirm/create',
        paypalCreateOrderUrl: '/api/payments/paypal/create-order',
        paypalCaptureOrderUrl: '/api/payments/paypal/capture-order',
      },
    }),
  ],
};
```

Backend endpoints remain authoritative for amounts, catalog validation, capture, and fulfillment. Publishable Stripe keys and PayPal **client ids** may appear in Angular; **secret keys must not**.

## C. Minimal Angular example

```typescript
import { Component, ElementRef, OnDestroy, inject, viewChild } from '@angular/core';
import {
  EasyPaymentsHeadless,
  type HeadlessCheckoutSession,
  type HeadlessMountHandle,
} from '@easy-payments/angular';

@Component({
  selector: 'app-checkout',
  template: `
    <div #cardHost></div>
    <button type="button" (click)="pay()" [disabled]="busy">Pay</button>
  `,
})
export class CheckoutComponent implements OnDestroy {
  private readonly headless = inject(EasyPaymentsHeadless);
  private readonly cardHost = viewChild.required<ElementRef<HTMLElement>>('cardHost');

  private session: HeadlessCheckoutSession | null = null;
  private handle: HeadlessMountHandle | null = null;
  busy = false;

  async ngOnInit(): Promise<void> {
    const session = this.headless.createSession({
      product: { id: 'sku_1', name: 'Plan', amount: 20, currency: 'USD' },
      methods: ['card', 'klarna', 'affirm', 'paypal', 'google-pay', 'apple-pay'],
      checkoutInstanceId: 'merchant-checkout-id', // required for Klarna/Affirm redirects
      theme: 'light',
      locale: 'en',
    });
    this.session = session;

    session.events.started.subscribe(() => {
      this.busy = true;
    });
    session.events.success.subscribe(() => {
      this.busy = false;
      // UX only — verify on backend / webhooks before fulfilling
    });
    session.events.pending.subscribe(() => {
      this.busy = false;
      // processing — do not retry; await backend
    });
    session.events.cancel.subscribe(() => {
      this.busy = false;
    });
    session.events.error.subscribe(() => {
      this.busy = false;
    });

    await session.initialize();
    // Signals: session.state(), session.availableMethods(), session.selectedMethod(),
    // session.lastError(), session.lastResult()

    session.selectMethod('card');
    this.handle = await session.mount('card', this.cardHost().nativeElement);
  }

  async pay(): Promise<void> {
    await this.session?.confirm();
  }

  async ngOnDestroy(): Promise<void> {
    await this.handle?.unmount();
    await this.session?.destroy();
  }
}
```

### Session API (exported)

```typescript
session.initialize(): Promise<void>
session.refreshAvailability(): Promise<readonly HeadlessMethodStatus[]>
session.selectMethod(method: PaymentMethod | null): void
session.mount(method, container: HTMLElement): Promise<HeadlessMountHandle>
session.confirm(): Promise<void>                 // card | klarna | affirm only
session.recoverReturn(): Promise<PaymentResult | null>  // klarna | affirm after redirect
session.destroy(): Promise<void>

// Signals
session.state / selectedMethod / availableMethods / lastError / lastResult

// Observables
session.events.started | methodChange | pending | success | cancel | error
```

`checkoutInstanceId` must match `^[a-zA-Z0-9_.:-]{1,64}$` when provided and must be unique among **live** Headless sessions.

## D. Provider-specific notes

### Stripe Card

- Mounts the official Stripe **Payment Element**.
- Merchant CTA → `session.confirm()`.
- Requires Stripe publishable key + `backend.createPaymentUrl`.
- Client secrets stay inside the adapter session — not on Headless signals/events.

### Klarna / Affirm

- Stripe Payment Element via existing Klarna/Affirm adapters.
- Merchant CTA → `session.confirm()`.
- Often **redirect**; use a **stable** `checkoutInstanceId` (see §E).
- Backend: `klarnaCreatePaymentUrl` / `affirmCreatePaymentUrl`.
- Eligibility (currency / Affirm minimums) matches Full Checkout.

### PayPal

- Official PayPal Buttons SDK (`mount('paypal', container)`).
- Backend create order + capture; **approval alone is not success**.
- Do **not** call `confirm()`.

### Google Pay

- Official Google Pay button; user gesture required.
- Tokenizes to Stripe gateway; processor result is authoritative.
- Do **not** call `confirm()`.
- `environment: 'TEST'` tokens are not live charges.

### Apple Pay

- Stripe Express Checkout Element (`applePay: 'always'`).
- Availability comes from Stripe ECE `ready` — not user-agent sniffing.
- Domain verification in Stripe Dashboard is required for production.
- Do **not** call `confirm()`.

## E. Redirect recovery (Klarna / Affirm)

Before redirect, mount + confirm as usual. The library:

1. Writes a Headless-only pending marker in **tab-scoped** `sessionStorage` (`hostKind: 'headless'`, method, product id, attempt id, `checkoutInstanceId`, timestamp; **24-hour TTL**; **no secrets**).
2. Stamps `ep_method` / `ep_attempt` on the return URL.

After a full-page return, recreate the session with the **same** `checkoutInstanceId`, `initialize()`, then `recoverReturn()`:

```typescript
// Before redirect
const session = headless.createSession({
  product,
  methods: ['klarna', 'affirm'],
  checkout: { successUrl: 'https://merchant.example/checkout/return' },
  checkoutInstanceId: 'merchant-checkout-id',
});
await session.initialize();
await session.mount('klarna', klarnaHost);
await session.confirm();

// After return (new JS context — same stable id)
const session = headless.createSession({
  product,
  methods: ['klarna', 'affirm'],
  checkoutInstanceId: 'merchant-checkout-id',
});
await session.initialize();

session.events.success.subscribe((result) => {
  /* still verify on backend / webhooks */
});
session.events.pending.subscribe(() => {
  /* Stripe processing — do not retry payment */
});
session.events.error.subscribe((err) => {
  // AUTHENTICATION_REQUIRED = still needs customer action
  // NETWORK_ERROR / SDK_LOAD_FAILED = safe to call recoverReturn() again
});

const result = await session.recoverReturn();
// PaymentResult when this session owns the return; null when unrelated / absent
```

Recovery **retrieves** the PaymentIntent only — no remount, no `confirm()`, no new PaymentIntent.

Ownership is fail-closed: wrong host kind, wrong instance id, wrong attempt, wrong method, wrong product, malformed/expired markers, and Full Checkout / Buttons Only hosts **cannot** claim Headless markers (and the reverse).

Browser storage is **correlation data**, not payment authorization. `redirect_status` is never treated as success proof (only `failed` short-circuits before retrieve).

## F. Payment results

| Outcome | Session state | Event | Meaning |
|---------|---------------|-------|---------|
| Stripe `succeeded` | `success` | `success` | Processor reported success — still verify backend/webhooks before fulfill |
| Stripe `requires_capture` | `success` | `success` | **Authorization only** — `metadata.authorizationOnly === true` and `metadata.stripeStatus === 'requires_capture'`. Not proof of captured funds |
| Stripe `processing` | `pending` | `pending` | Not completed; do not retry; await backend |
| Buyer cancel / PI `canceled` | `cancelled` | `cancel` | Not success |
| `requires_action` / `requires_confirmation` | `error` | `error` | `AUTHENTICATION_REQUIRED` — not ordinary pending |
| Verification / network failure | `error` | `error` | See §E retries for transient codes |
| Unrelated return | unchanged | none | `recoverReturn()` → `null` |

Never treat a frontend `success` event as sole permission to ship or unlock digital goods.

## G. Security

- Backend validates product ids and amounts; client amounts are not authoritative.
- Stripe secret keys and PayPal client secrets never belong in Angular.
- PayPal success requires backend **capture**, not buyer approval alone.
- Google Pay / Apple Pay success requires processor confirmation, not wallet UI alone.
- Pending markers store no client secrets; PaymentIntent client secrets may appear briefly in Stripe return URLs (Stripe redirect design) and are cleared after consume.
- Sensitive tokens are not logged by Headless signals/events.
- Merchant fulfillment remains **backend/webhook-authoritative**.

## H. Lifecycle

```
idle → initializing → ready
ready → processing → success | pending | cancelled | error
destroy → destroyed
```

Rules:

- Safe repeated `initialize()` / `destroy()` / `handle.unmount()`.
- While `processing` or `pending` (including recovery), `mount` / `selectMethod` / `confirm` / a second recovery are rejected.
- Switching methods tears down the previous mount for **that session only**.
- Destroy unregisters the Stripe return host and releases the session id from the Headless registry.
- Multiple Headless sessions may coexist when ids differ; duplicate live `checkoutInstanceId` values are rejected.

## I. Troubleshooting

| Symptom | Likely cause |
|---------|----------------|
| `createSession` throws on id | Invalid or duplicate live `checkoutInstanceId` |
| Method `available: false` | Provider config, currency, Affirm minimum, wallet eligibility |
| `mount` rejects Apple Pay | ECE `ready` says unavailable / domain not verified |
| `confirm()` rejects PayPal/GPay/Apple Pay | Expected — use official buttons |
| `recoverReturn()` → `null` | Wrong/missing stable id, expired marker, already consumed, or unrelated return |
| `AUTHENTICATION_REQUIRED` after return | PI still needs customer action — not a verification retry |
| Transient `NETWORK_ERROR` / `SDK_LOAD_FAILED` | Call `recoverReturn()` again; marker preserved |
| Two checkouts fight over a return | Distinct stable ids; Headless vs Full Checkout markers are isolated |

## J. Production checklist

Merchant responsibilities (library cannot complete these alone):

1. Configure live Stripe / PayPal / Google Pay / Apple Pay credentials on the **backend**.
2. Keep secret keys off the client; rotate publishable keys appropriately.
3. Implement webhook (or server retrieve) fulfillment — do not fulfill from Headless events alone.
4. Supply a **stable** `checkoutInstanceId` for Klarna/Affirm across redirects.
5. Verify Apple Pay domains in the Stripe Dashboard.
6. Validate Google Pay `PRODUCTION` merchant id on real devices.
7. Run Stripe TEST Klarna/Affirm redirect → return → `recoverReturn()` and confirm Dashboard PI status matches; refresh once with no duplicate fulfillment side effects.
8. Run PayPal Sandbox create/capture end-to-end.
9. Confirm multi-instance pages do not share one checkout id across competing hosts.
10. Treat `requires_capture` / `authorizationOnly` as authorization until your backend captures.

## Status

| Area | Status |
|------|--------|
| Session create / initialize / destroy | Supported |
| Method readiness + selection | Supported |
| Card / Klarna / Affirm / PayPal / Google Pay / Apple Pay | Supported |
| Headless BNPL pending ownership + `recoverReturn` | Supported |
| Recovery lifecycle / retry safety | Supported |
| Security + docs + regression audit (H4.5) | Supported |
| Demo Headless playground | Not yet (H5) |

Full Checkout and Buttons Only remain unchanged; Headless is additive.

Mocked unit tests and local builds do **not** prove live payment production readiness. Complete §J with real Stripe TEST / PayPal Sandbox / wallet devices before claiming live verification.
