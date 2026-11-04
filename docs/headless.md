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
| **Klarna** + **Affirm** mount + confirm | **Supported (H3.2)** — stable `checkoutInstanceId` required for redirect confirm |
| **PayPal** official Buttons | **Supported (H3.3)** — no `confirm()` |
| **Google Pay** official button | **Supported (H3.4)** — no `confirm()` |
| **Apple Pay** Express Checkout | **Supported (H3.5)** — no `confirm()` |
| Headless BNPL pending ownership markers | **Supported (H4.2)** |
| Public Headless BNPL return recovery (`recoverReturn`) | **Supported (H4.3)** — Klarna / Affirm |
| Recovery lifecycle / status hardening | **Supported (H4.4)** |
| Demo Headless experience | Not yet (H5) |

**Card, Klarna, Affirm, PayPal, Google Pay, and Apple Pay** are the supported Headless payment methods.

## Shared mount API

```typescript
await session.mount('card' | 'klarna' | 'affirm' | 'paypal' | 'google-pay' | 'apple-pay', container);
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
| `apple-pay` | Stripe Express Checkout Element Apple Pay control. **`session.confirm()` rejects.** |

Do not use separate `confirmKlarna()` / `confirmPayPal()` / `confirmGooglePay()` / `confirmApplePay()` APIs.

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

### Redirect ownership (H4.2) and recovery (H4.3 / H4.4)

Klarna and Affirm often **redirect** the buyer. Use a **stable merchant `checkoutInstanceId`** that you recreate after reload (auto-generated session ids cannot own redirects).

**Before redirect** — mount + confirm as usual. The library writes a Headless-only pending marker (`hostKind: 'headless'`) in tab-scoped `sessionStorage` (method, product, attempt id, instance id, timestamp; **24-hour** TTL; no secrets) and stamps `ep_method` / `ep_attempt` on the return URL.

**After redirect** — recreate the session with the **same** `checkoutInstanceId`, `initialize()`, then call `recoverReturn()` (no Payment Element remount, no `confirm()`, no new PaymentIntent):

```typescript
// Before redirect
const session = headless.createSession({
  product,
  methods: ['klarna', 'affirm'],
  checkout: { successUrl: 'https://merchant.example/checkout/return' },
  checkoutInstanceId: 'account-checkout',
});
await session.initialize();
await session.mount('klarna', klarnaHost);
await session.confirm();

// After full-page return (new JS context)
const session = headless.createSession({
  product,
  methods: ['klarna', 'affirm'],
  checkoutInstanceId: 'account-checkout', // same stable id
});
await session.initialize();

session.events.started.subscribe(() => { /* recovery attempt began */ });
session.events.success.subscribe((result) => { /* verify on backend / webhooks */ });
session.events.pending.subscribe((result) => { /* Stripe processing — do not retry */ });
session.events.cancel.subscribe(() => { /* buyer cancelled */ });
session.events.error.subscribe((err) => {
  // AUTHENTICATION_REQUIRED = still needs customer action (not ordinary pending)
  // NETWORK_ERROR / SDK_LOAD_FAILED = verification retry may be safe via recoverReturn() again
});

const result = await session.recoverReturn();
// result: PaymentResult when this session owns the return; null when unrelated / absent
```

**Lifecycle (H4.4)**

- Recovery: `ready` → `processing` (+ `started`) → one terminal `success` | `pending` | `cancelled` | `error`.
- While `processing` or `pending`, `mount` / `selectMethod` / `confirm` / a second recovery are rejected — do not start another payment.
- `succeeded` → success. `processing` → pending. `requires_capture` → success **with** `metadata.stripeStatus = 'requires_capture'` / `authorizationOnly` (not proof of captured funds). `requires_action` / `requires_confirmation` → typed `AUTHENTICATION_REQUIRED` error (not success, not ordinary pending).
- Unrelated / missing returns → `null`, no payment events.
- Duplicate `recoverReturn()` after a definitive outcome is idempotent. Concurrent callers share one promise.
- **Transient verification** (`NETWORK_ERROR` / `SDK_LOAD_FAILED`): marker + URL are preserved; call `recoverReturn()` again to re-retrieve (never reconfirm). Bounded internal retrieve retries apply. Definitive outcomes clear marker/URL.
- Browser **Refresh** / **Back**: recreate the session and call `recoverReturn()` again. Already-consumed returns yield `null` (or the settled result on a duplicate call in the same instance).
- Full Checkout / Buttons Only cannot claim Headless markers (and the reverse).
- **Fulfillment remains backend/webhook-authoritative.** `redirect_status` / `ep_*` are not payment proof.
- Manual Stripe TEST checklist: Klarna/Affirm redirect in test mode → return URL → recreate session → `recoverReturn()` → match Dashboard PI status; refresh once with no duplicate fulfillment side effects; simulate offline retrieve and confirm a verification retry does not create a second PaymentIntent.

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

## Apple Pay (H3.5)

Apple Pay Headless mounts Stripe’s **Express Checkout Element** configured for Apple Pay only (`applePay: 'always'`, other wallets `never`) through the existing `ApplePayAdapter`. Canonical method id: **`apple-pay`**.

### Why `confirm()` is not used

Apple Pay requires a real user gesture on the official wallet control. Calling `session.confirm()` for `apple-pay` rejects with `CONFIG_INVALID`. Mount the control and let the buyer authorize.

### Architecture (Express Checkout → Stripe)

1. `mount('apple-pay', container)` → load Stripe.js → mount ECE into the merchant container
2. ECE `ready` decides eligibility (`availablePaymentMethods.applePay`)
3. If unavailable, Headless rejects the mount (no fake usable button)
4. Buyer authorizes in the Apple Pay sheet
5. Adapter creates a PaymentIntent and `confirmPayment` with `redirect: 'if_required'`
6. Headless emits `success` | `pending` | `cancel` | `error` from the **processor** result — never from wallet authorization alone
7. `unmount` / `destroy` tears down **this session’s** ECE mount only

### Requirements

- `providers.applePay` (e.g. `merchantName`, `countryCode`)
- Stripe **publishable** key
- `backend.createPaymentUrl`
- Stripe Dashboard Apple Pay domain verification for your merchant domain(s)
- Eligible browser/device or Apple Pay on the Web cross-device flow (Stripe-decided — not UA sniffing)

Never put Stripe secret keys in Angular. Domain verification cannot be completed from unit tests alone.

### Example

```typescript
const session = headless.createSession({
  product: { id: 'sku_1', name: 'Plan', amount: 20, currency: 'USD' },
  methods: ['apple-pay', 'card'],
  checkoutInstanceId: 'account-checkout',
});

await session.initialize();
// availableMethods() may show apple-pay readiness "loading" until mount discovers ECE ready.

const applePayHost = document.getElementById('apple-pay-slot')!;
const handle = await session.mount('apple-pay', applePayHost);

session.events.started.subscribe(() => { /* wallet confirm began */ });
session.events.success.subscribe((result) => { /* Stripe confirmed; still verify on backend */ });
session.events.pending.subscribe(() => { /* processing — do not auto-retry */ });
session.events.cancel.subscribe(() => { /* buyer cancelled */ });
session.events.error.subscribe((err) => { /* show error; control may remain for retry */ });

// Do NOT call session.confirm() for Apple Pay — it rejects with CONFIG_INVALID.

await handle.unmount();
await session.destroy();
```

### Events & state

| Phase | State | Event |
|-------|-------|--------|
| Buyer authorize begins | `processing` | `started` |
| Stripe confirms succeeded | `success` | `success` |
| Stripe status `processing` | `pending` | `pending` |
| Buyer cancel | `cancelled` → `ready` | `cancel` |
| Auth / Stripe / SDK failure | `error` → `ready` | `error` |

### Eligibility & domain verification

Before ECE mounts, Headless may report `readiness: 'loading'` (not a false “unsupported”). After `mount('apple-pay')`, Stripe’s `ready` event is authoritative. Missing Apple Pay config or a definitive unavailable/error readiness rejects mount.

Apple Pay on the Web requires your domain to be registered in the Stripe Dashboard. Localhost and mocked tests do **not** prove domain verification or real-device wallet eligibility.

### Multi-session

Each Headless session uses an ownership-scoped ECE mount id from `ApplePayAdapter.createMountId` / `mountExpressCheckout`. Confirmation is gated per mount (`apple-pay:${mountId}`). Destroying session A must not unmount session B.

### Manual testing checklist

1. Safari / eligible Apple Pay surface with verified domain (or Stripe test setup)
2. Mount official ECE Apple Pay control — not a custom imitation
3. Complete payment; verify PaymentIntent on the backend
4. Cancel sheet → `cancel` → control remains for retry
5. Two Headless sessions — isolate unmount/destroy
6. Switch Apple Pay ↔ Card / PayPal / Google Pay / BNPL

## Lifecycle (Card / Klarna / Affirm)

1. `initialize()` → `ready`
2. `selectMethod(...)` (also applied automatically by `mount`)
3. `mount(method, container)` → PaymentIntent session + Payment Element
4. Merchant CTA → `confirm()` → `processing`
5. Terminal: `success` | `pending` | `cancelled` | `error`
6. `handle.unmount()` and/or `session.destroy()` for cleanup

Client secrets are **not** exposed on session signals, events, or diagnostics.

## Errors

Typed `PaymentError` cases include: invalid container, method not configured on session, method unavailable, mount/render failure, SDK load failure, confirm without mount, wrong selected method, **`confirm()` for PayPal / Google Pay / Apple Pay**, duplicate confirm / in-flight create, concurrent Stripe confirmation gate, destroyed session, backend create/capture failure, buyer cancellation.

## Multi-instance

Each Headless session uses its own Stripe Element owner id, PayPal Buttons mount id, Google Pay button mount id, and Apple Pay ECE mount id (tied to the session). Sibling sessions can mount independently. Switching among Card, Klarna, Affirm, PayPal, Google Pay, and Apple Pay within one session tears down the previous mount for that session only.

## Security

- Publishable Stripe key / PayPal client id only in the browser
- No raw card data; no PayPal / Google Pay / Apple Pay secrets in Angular
- Official Stripe Payment Element / Express Checkout / PayPal Buttons / Google Pay button only
- Backend must re-price / authorize; webhooks remain authoritative for fulfillment

## Session foundation (H2+)

```typescript
const session = headless.createSession({
  product: { id: 'sku_1', name: 'Plan', amount: 20, currency: 'USD' },
  methods: ['card', 'klarna', 'paypal', 'google-pay', 'apple-pay'],
  checkoutInstanceId: 'account-checkout',
});

await session.initialize();
session.availableMethods(); // readiness projection — Apple Pay may be loading until mount
await session.destroy();
```

## Not supported yet

- Headless demo mode in the playground (**H5**)
- Comprehensive Headless docs audit (**H4.5**)

Full Checkout and Buttons Only are unchanged; Headless is additive. Live Apple Pay / Google Pay production readiness requires real-device and domain validation beyond mocked tests.
