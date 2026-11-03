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
| **PayPal** official Buttons | **Supported (H3.3)** — no `confirm()` |
| **Google Pay** official button | **Supported (H3.4)** — no `confirm()` |
| Apple Pay mount | Not yet (later H3.x) |
| BNPL / Stripe redirect recovery for Headless | Not yet (**H4**) |
| Demo Headless experience | Not yet (H5) |

**Card, Klarna, Affirm, PayPal, and Google Pay** are the supported Headless payment methods. Apple Pay is not mountable yet.

## Shared mount API

```typescript
await session.mount('card' | 'klarna' | 'affirm' | 'paypal' | 'google-pay', container);
session.selectMethod(/* same method — also applied by mount */);
const handle = /* from mount */;
await handle.unmount(); // idempotent
await session.destroy();
```

### Confirm vs Buttons

| Method | How the buyer pays |
|--------|--------------------|
| `card` / `klarna` / `affirm` | Merchant button → `session.confirm()` |
| `paypal` | Official PayPal Buttons (SDK). **`session.confirm()` rejects.** |
| `google-pay` | Official Google Pay button (SDK). **`session.confirm()` rejects.** |

Do not use separate `confirmKlarna()` / `confirmPayPal()` / `confirmGooglePay()` APIs.

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

const klarnaHost = document.getElementById('klarna-slot')!;
await session.mount('klarna', klarnaHost);
await session.confirm(); // merchant CTA
```

### Redirect limitation (H4)

Klarna and Affirm often **redirect** the buyer. H3.2 stamps `ep_method` on return URLs but does **not** resume Headless after a full-page redirect and does not write Full Checkout / Buttons Only ownership markers. Backend webhooks remain authoritative. Full Headless BNPL return recovery is **H4**.

## PayPal (H3.3)

PayPal Headless mounts the **official PayPal JavaScript SDK Buttons** through the existing `PayPalAdapter`. The SDK owns the button and buyer approval UI. Easy Payments never synthesizes approval or capture in the browser.

### Requirements

- `providers.paypal.clientId` (PayPal **client id** only — never a secret)
- `backend.paypalCreateOrderUrl` and `backend.paypalCaptureOrderUrl`
- A merchant-owned `HTMLElement` container
- Sandbox / live credentials configured on your backend (not in Angular)

### Example

```typescript
const session = headless.createSession({
  product: { id: 'sku_1', name: 'Plan', amount: 20, currency: 'USD' },
  methods: ['paypal', 'card'],
  checkoutInstanceId: 'account-checkout',
});

await session.initialize();

const paypalHost = document.getElementById('paypal-slot')!;
const handle = await session.mount('paypal', paypalHost);

session.events.started.subscribe(() => { /* createOrder started */ });
session.events.success.subscribe((result) => { /* capture completed; still verify on backend */ });
session.events.pending.subscribe(() => { /* ambiguous/pending capture — do not auto-retry */ });
session.events.cancel.subscribe(() => { /* buyer cancelled PayPal */ });
session.events.error.subscribe((err) => { /* show error; Buttons may remain for retry */ });

// Do NOT call session.confirm() for PayPal — it rejects with CONFIG_INVALID.
// The buyer clicks the official PayPal Button rendered into paypalHost.

await handle.unmount();
await session.destroy();
```

### Lifecycle

1. `mount('paypal', container)` → load SDK → `renderButtons` into merchant container
2. Buyer clicks official PayPal Button
3. SDK `createOrder` → backend creates order (catalog/pricing authoritative)
4. Buyer approves or cancels in PayPal
5. SDK `onApprove` → backend **capture** (success requires capture result, not approve alone)
6. Headless emits `success` | `pending` | `cancel` | `error`
7. `unmount` / `destroy` closes **this session’s** Buttons only

### Events & state

| Phase | State | Event |
|-------|-------|--------|
| createOrder begins | `processing` | `started` |
| Capture completed | `success` | `success` |
| Capture pending / ambiguous | `pending` | `pending` (do **not** auto-retry) |
| Buyer cancel | `cancelled` → `ready` | `cancel` |
| Create/capture/SDK failure | `error` → `ready` (Buttons still mounted) | `error` |

Cancellation is not treated as a generic payment failure.

### Multi-session

Each Headless session uses a stable owner id (`session.id`) for PayPal order-create guards and a Buttons mount id from `PayPalAdapter.renderButtons`. Destroying or unmounting one session must not close another session’s Buttons.

### Sandbox testing

Use PayPal Sandbox client ids and backend create/capture endpoints against Sandbox. Mocked unit tests do **not** prove live Sandbox funding eligibility or SDK rendering.

## Google Pay (H3.4)

Google Pay Headless mounts the **official Google Pay button** through the existing `GooglePayAdapter` and Google Pay JS SDK (`pay.js`). The buyer must click that button — Easy Payments never fakes Google Pay authorization and never starts the payment sheet from `session.confirm()`.

### Why `confirm()` is not used

Browsers and Google Pay require a **user gesture** on the official button. Calling `session.confirm()` for `google-pay` rejects with `CONFIG_INVALID`. Mount the button and let the buyer click it.

### Architecture (Google Pay → Stripe gateway)

1. `mount('google-pay', container)` → load SDK (lazy) → `renderOfficialButton` into the merchant container
2. Buyer clicks the official Google Pay button
3. Adapter opens the Google Pay sheet (`loadPaymentData`) and receives a **gateway token** for Stripe
4. Backend creates a Stripe PaymentIntent (`createPaymentUrl`) — catalog/pricing remain server-authoritative
5. Adapter confirms with Stripe (`createPaymentMethod` + `confirmCardPayment`)
6. Headless emits `success` | `pending` | `cancel` | `error` from the **processor** result — never from Google payment data alone
7. `unmount` / `destroy` removes **this session’s** button mount only

### Requirements

- `providers.googlePay` (`environment`, `merchantName`; PRODUCTION also needs `merchantId`)
- Stripe **publishable** key (`providers.stripe.publishableKey`) for gateway tokenization
- `backend.createPaymentUrl` (same Stripe create endpoint used by Full Checkout Google Pay)
- A merchant-owned `HTMLElement` container
- Eligible browser/device (Chrome / supported Google Pay surfaces; `isReadyToPay`)

Never put Stripe secret keys or Google merchant secrets in Angular.

### Example

```typescript
const session = headless.createSession({
  product: { id: 'sku_1', name: 'Plan', amount: 20, currency: 'USD' },
  methods: ['google-pay', 'card'],
  checkoutInstanceId: 'account-checkout',
});

await session.initialize();

const googlePayHost = document.getElementById('google-pay-slot')!;
const handle = await session.mount('google-pay', googlePayHost);

session.events.started.subscribe(() => { /* sheet / confirm started */ });
session.events.success.subscribe((result) => { /* Stripe confirmed; still verify on backend */ });
session.events.pending.subscribe(() => { /* processing / uncertain — do not auto-retry */ });
session.events.cancel.subscribe(() => { /* buyer closed the sheet */ });
session.events.error.subscribe((err) => { /* show error; button may remain for retry */ });

// Do NOT call session.confirm() for Google Pay — it rejects with CONFIG_INVALID.
// The buyer clicks the official Google Pay button rendered into googlePayHost.

await handle.unmount();
await session.destroy();
```

### Events & state

| Phase | State | Event |
|-------|-------|--------|
| Buyer click → payment starts | `processing` | `started` |
| Stripe confirms succeeded | `success` | `success` |
| Stripe status `processing` / uncertain | `pending` | `pending` (do **not** auto-retry) |
| Buyer cancels sheet | `cancelled` → `ready` | `cancel` |
| Auth / Stripe / SDK failure | `error` → `ready` (button still mounted) | `error` |

### TEST vs PRODUCTION

| Mode | Notes |
|------|--------|
| `environment: 'TEST'` | Google Pay test tokens are **not chargeable** end-to-end like live cards. Useful for sheet/UI and integration wiring. Do not claim production readiness from TEST alone. |
| `environment: 'PRODUCTION'` | Requires a real Google Pay `merchantId` and live Stripe keys. Must be validated on real devices/browsers. |

Mocked unit tests do **not** prove real Google Pay device eligibility, funding, or live charging.

### Eligibility & browsers

Availability uses the same `GooglePayAdapter.isAvailable` / `isReadyToPay` path as Full Checkout and Buttons Only. Unsupported browsers, missing config, or ineligible devices keep `available: false` and reject `mount()`.

### Multi-session

Each Headless session uses a stable owner id (`session.id`) for the Stripe confirmation gate (`google-pay:${ownerId}`) and an ownership-scoped button mount id from `GooglePayAdapter.renderOfficialButton`. Destroying or unmounting session A must not clear session B’s button. Stale clicks after unmount/remount/destroy are ignored.

### Manual testing checklist

1. Eligible Chrome profile with Google Pay TEST/PRODUCTION as configured
2. Mount official button; confirm branding is Google’s, not a custom imitation
3. Complete a payment and verify Stripe PaymentIntent status on the backend
4. Cancel the sheet → `cancel` → button remains for retry
5. Two Headless sessions on one page — unmount one, pay with the other
6. Switch Google Pay ↔ Card / PayPal / BNPL — mounts tear down correctly

## Lifecycle (Card / Klarna / Affirm)

1. `initialize()` → `ready`
2. `selectMethod(...)` (also applied automatically by `mount`)
3. `mount(method, container)` → PaymentIntent session + Payment Element
4. Merchant CTA → `confirm()` → `processing`
5. Terminal: `success` | `pending` | `cancelled` | `error`
6. `handle.unmount()` and/or `session.destroy()` for cleanup

Client secrets are **not** exposed on session signals, events, or diagnostics.

## Errors

Typed `PaymentError` cases include: invalid container, unsupported method (Apple Pay), method unavailable, mount/render failure, SDK load failure, confirm without mount, wrong selected method, **`confirm()` for PayPal or Google Pay**, duplicate confirm / in-flight create, concurrent Stripe confirmation gate, destroyed session, backend create/capture failure, buyer cancellation.

## Multi-instance

Each Headless session uses its own Stripe Element owner id, PayPal Buttons mount id, and Google Pay button mount id (tied to the session `id`). Sibling sessions can mount independently. Switching Card ↔ Klarna ↔ Affirm ↔ PayPal ↔ Google Pay within one session tears down the previous mount for that session only.

## Security

- Publishable Stripe key / PayPal client id only in the browser
- No raw card data; no PayPal / Google Pay secrets in Angular
- Official Stripe Payment Element / PayPal Buttons / Google Pay button only
- Backend must re-price / authorize; webhooks remain authoritative for fulfillment

## Session foundation (H2+)

```typescript
const session = headless.createSession({
  product: { id: 'sku_1', name: 'Plan', amount: 20, currency: 'USD' },
  methods: ['card', 'klarna', 'paypal', 'google-pay'],
  checkoutInstanceId: 'account-checkout',
});

await session.initialize();
session.availableMethods(); // readiness projection
await session.destroy();
```

Apple Pay may still report `readiness: 'loading'` until an Express Checkout Element can mount in a later milestone.

## Not supported yet

- `mount('apple-pay', …)`
- Headless demo mode in the playground
- Complete Headless BNPL redirect recovery after leave-page authorization (**H4**)

Full Checkout and Buttons Only are unchanged; Headless is additive. Live Google Pay production readiness requires real-device validation beyond mocked tests.
