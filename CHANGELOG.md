# Changelog

## 1.2.0

Headless Checkout, Buttons Only Klarna/Affirm Direct, and merchant-owned triggers. Peer range is unchanged: `@angular/core` / `@angular/common` `>=20.3.0 <23.0.0`, `@stripe/stripe-js` `^8.0.0`.

### Experiences

- **Full Checkout** (`<easy-payments>`) keeps Payment Element confirmation for card, Klarna, and Affirm.
- **Buttons Only** (`<easy-payment-buttons>`) adds optional selector appearance, `selectorVisibility`, and `requestPayment` / `canRequestPayment`.
- **Headless** (`EasyPaymentsHeadless`) adds an injectable session for the same providers, including `recoverReturn()` for Klarna and Affirm.

### Buttons Only

- `[bnplConfirmMode]` defaults to `element` (Payment Element + Continue).
- `auto` and `direct` are opt-in Klarna/Affirm Stripe Direct confirmation. Direct is not universally available.
- Merchant-owned triggers can start **card**, **Klarna**, and **Affirm**. PayPal, Google Pay, and Apple Pay stay on official SDK buttons.
- In-page confirmation locks and redirect recovery reduce duplicate in-flight confirms. They are not a substitute for backend idempotency.

### Stripe return URLs

- `checkout.successUrl` must be a same-origin `http:` or `https:` URL, or a relative path on the current page.
- `javascript:`, `data:`, `file:`, `blob:`, protocol-relative URLs, and cross-origin destinations fail with `CONFIG_INVALID` before confirmation.

### Documentation and demo

- Demo playground covers Full Checkout, Buttons Only (including merchant-owned buttons), and Headless.
- Docs state that browser `success` is not fulfillment and that the NestJS server is a reference demo.
- Upgrading from 1.1.0: see [docs/migration-1.1-to-1.2.md](docs/migration-1.1-to-1.2.md).

### Verification limits

- Klarna and Affirm **Stripe TEST** payments returned provider success and browser success events.
- Locally signed `payment_intent.succeeded` simulations returned HTTP 200 and `SUCCEEDED`, including duplicate delivery. That is not proof Stripe delivered webhooks to the demo server.
- Live production charges, Apple Pay on a verified domain, Google Pay `PRODUCTION`, and real Stripe-to-server webhook delivery are **not** verified in this release.
- Samsung Pay is not implemented.

## 1.1.0

Localization release for Easy Payments UI chrome and provider locale hints.

### Localization

- New `[locale]` input: `'auto' | 'en' | 'es' | 'pt'` (default `'auto'`)
- Browser auto-detect maps `es-*` → Spanish, `pt-*` → Portuguese, `en-*` → English; other languages fall back to English
- Built-in dictionaries for English, Spanish, and Portuguese covering Easy Payments-owned checkout UI text
- New `[translations]` input for partial string overrides (override → locale dictionary → English)
- Amount display uses `Intl` formatting for the active locale **without converting currency** — `product.amount` and `product.currency` are unchanged (e.g. `99` + `USD` stays USD; only number/symbol layout can change)
- Provider locale hints where supported: Stripe Elements, PayPal JS SDK, and Klarna/Affirm purchase locale mapping from the effective Easy Payments locale
- Provider-owned surfaces (wallet sheets, bank UIs, etc.) may still follow their own rules and are not fully controlled by Easy Payments

### Notes

- **No currency conversion.** Localization formats money for display only.
- Published npm package remains: `@easy-payments/angular`
- Peer compatibility unchanged: `@angular/core` / `@angular/common` `>=20.3.0 <23.0.0`, `@stripe/stripe-js` `^8.0.0`

## 1.0.1

Documentation and npm discoverability patch. **No runtime or public API changes.**

- Improved npm package description for search discoverability
- Expanded package keywords (Angular, Stripe, PayPal, wallets, checkout, ecommerce)
- README search/installation polish (title, intro, install near the top)
- Removed obsolete pre-publish installation notes

Published npm package remains: `@easy-payments/angular`.

## 1.0.0

First stable public release of **Easy Payments**.

Published npm package: `@easy-payments/angular`.

### Highlights

- Angular payment library with unified `<easy-payments>` checkout
- npm package: `@easy-payments/angular`
- Peer compatibility: `@angular/core` / `@angular/common` `>=20.3.0 <23.0.0`
- Built in an Angular **22.1.5** workspace
- Consumer validation on Angular **20**, **21**, and **22**
- Payment methods: **Card**, **PayPal**, **Apple Pay**, **Google Pay**, **Klarna**, **Affirm**
- Configurable method allow-list and visual order via `methods`
- Responsive checkout with `[maxWidth]` (320–1200, default 640)
- Themes: `light` | `dark` | `system`
- Appearance: `default` | `transparent`
- Normalized `PaymentResult` / `PaymentError` events
- Angular demo playground (`projects/demo`)
- NestJS reference backend (`server/`)
- Optional project support via PayPal (`https://paypal.me/JoseVicente07`)
