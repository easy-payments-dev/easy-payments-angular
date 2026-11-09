# Migrating from 1.1.0 to 1.2.0

Package: **`@easy-payments/angular`** (unchanged).
Peers: `@angular/core` / `@angular/common` `>=20.3.0 <23.0.0`, `@stripe/stripe-js` `^8.0.0` (unchanged).

This guide covers breaking behavioral defaults and new APIs. It does not invent unsupported features (Samsung Pay, live Apple Pay domain verification, Google Pay `PRODUCTION`, or live Stripe webhook delivery).

---

## 1. Choose an integration experience

| Experience | When to use | Entry point |
|------------|-------------|-------------|
| **Full Checkout** | Library-owned product summary + method tiles | `<easy-payments>` (same as 1.1) |
| **Buttons Only** | You already own product/price UI; compact provider strip | `<easy-payment-buttons>` |
| **Headless** | You own all layout; mount official provider controls into your containers | `EasyPaymentsHeadless` |

Full walkthroughs: [getting-started.md](./getting-started.md) · [api.md](./api.md) · [headless.md](./headless.md)

---

## 2. Buttons Only: `[bnplConfirmMode]` default

- Default is **`element`** (Payment Element + Continue) — same confirmation shape merchants already know.
- `auto` and `direct` are **opt-in** Klarna/Affirm Stripe Direct confirmation paths.
- Direct is **not** universally available. Do not assume every browser/currency/country can use it.
- `[bnplConfirmMode]` applies to **Buttons Only only**. Full Checkout and Headless keep Payment Element / existing flows.

See [api.md — BNPL confirm mode](./api.md#buttons-only-bnpl-confirm-mode).

---

## 3. Merchant-owned triggers (`requestPayment`)

On Buttons Only with `selectorVisibility="merchant"`:

- `requestPayment` / `canRequestPayment` can start **card**, **Klarna**, and **Affirm**.
- **PayPal**, **Google Pay**, and **Apple Pay** stay on their official SDK buttons (do not call `requestPayment` for them).
- In-page confirmation locks and redirect recovery reduce duplicate in-flight confirms. They are **not** a substitute for backend idempotency.

---

## 4. Headless export

New public API:

- `EasyPaymentsHeadless` → `createSession(...)` → `initialize()` → mount / `confirm` / `recoverReturn`
- Klarna and Affirm redirects require a stable `checkoutInstanceId`
- Call `initialize()` before mount / confirm / `recoverReturn()` on return pages that may receive Stripe redirect query params

Do not import internal adapter or recovery paths. Guide: [headless.md](./headless.md).

---

## 5. Stripe `checkout.successUrl` rules

`checkout.successUrl` must be:

- a same-origin `http:` or `https:` URL, or
- a relative path resolved against the current page

`javascript:`, `data:`, `file:`, `blob:`, protocol-relative URLs, and **cross-origin** destinations fail with `CONFIG_INVALID` **before** confirmation.

---

## 6. Fulfillment ownership (unchanged, still critical)

- Browser `success` / `started` events are **UX signals only**.
- Your backend owns durable idempotency, capture, and fulfillment (webhooks / reconciliation).
- The NestJS app under `server/` is a **reference demo**, not a production backend.

See [security.md](./security.md) and [backend.md](./backend.md).

---

## 7. Compatibility checklist

1. Upgrade to `@easy-payments/angular@1.2.0` (peers already satisfied if you were on 1.1.x).
2. If you add Buttons Only Direct, set `[bnplConfirmMode]` explicitly and test Klarna/Affirm in Stripe **TEST**.
3. If you add merchant triggers, wire `requestPayment` only for card / Klarna / Affirm.
4. If you add Headless, set `checkoutInstanceId`, call `initialize()`, then `recoverReturn()` on return routes.
5. Re-validate `checkout.successUrl` against the same-origin rules above.
6. Keep fulfillment on the backend — do not ship on browser `success` alone.

Changelog summary: [CHANGELOG.md](../CHANGELOG.md) (`1.2.0`).
