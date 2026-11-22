# Changelog

## Unreleased (1.3.0)

### Stripe Link (opt-in)

- Dedicated `'link'` method via Stripe **Express Checkout Element** (official Link button)
- Explicit opt-in: `providers.link: {}` + `'link'` in `methods` + Stripe `publishableKey` + `backend.linkCreatePaymentUrl`
- Server creates PaymentIntent with `payment_method_types: ['link', 'card']` (Stripe requires both); catalog amount is authoritative
- Card Payment Element keeps `wallets.link: 'never'` so Link is not duplicated when both card and Link are enabled
- Available in Full Checkout, Buttons Only, and Headless (wallet-button; no `confirm()`)
- EN / ES / PT / FR library copy; locale passed to Stripe Elements
- Angular demo includes Link; Ionic smoke includes Link for web/Test checks — native Capacitor Link confirmation not claimed as verified

### Amazon Pay (opt-in)

- Dedicated `'amazon-pay'` method via Stripe **Express Checkout Element** (official Amazon Pay button)
- Explicit opt-in: `providers.amazonPay: {}` + `'amazon-pay'` in `methods` + Stripe `publishableKey` + `backend.amazonPayCreatePaymentUrl`
- Server creates PaymentIntent with `payment_method_types: ['amazon_pay']`; catalog amount is authoritative
- Official Amazon Pay acceptance marks on library-owned selectors; ECE button stays under Amazon/Stripe branding rules
- Available in Full Checkout, Buttons Only (success emits once), and Headless (wallet-button; no `confirm()`)
- EN / ES / PT / FR library copy; locale passed to Stripe Elements; errors re-localize without restarting payment
- Requires Dashboard Amazon Pay activation + Payment Method Domains; US presentment USD (EMEA currencies per Stripe)
- Angular demo includes Amazon Pay; Ionic/Capacitor native confirmation not claimed as verified

### Alipay (opt-in)

- Dedicated `'alipay'` method via Stripe **Payment Element** + redirect confirmation (not Express Checkout)
- Explicit opt-in: `providers.alipay: {}` + `'alipay'` in `methods` + Stripe `publishableKey` + `backend.alipayCreatePaymentUrl`
- Server creates PaymentIntent with `payment_method_types: ['alipay']`; catalog amount is authoritative
- Shared Stripe redirect recovery (`ep_method=alipay` + attempt-scoped pending marker); success only after Stripe status
- Official Alipay wordmark on library-owned selectors (light/dark); Payment Element stays under Stripe/Alipay branding
- Available in Full Checkout, Buttons Only (success emits once), and Headless (`mount` + `confirm` / `recoverReturn`)
- EN / ES / PT / FR library copy; locale passed to Stripe Elements
- Requires Dashboard Alipay activation; presentment currencies per Stripe (AUD, CAD, CHF, CNY, EUR, GBP, HKD, JPY, MYR, NZD, SGD, USD)
- Angular demo includes Alipay; Ionic/Capacitor native redirect return not claimed as verified

### Zip (experimental)

- Zip US Gateway + JS SDK remains available as an **explicit opt-in** (`methods` includes `'zip'` + `providers.zip` + Zip backend URLs)
- Zip is **not** in Full Checkout or Buttons Only default `[methods]`, Headless has no implicit methods, and Angular / Ionic demos omit Zip from their selectors
- Marked **experimental**: approval, cancellation, return, and capture require end-to-end Sandbox validation (merchant credentials pending)
- Adapter, Nest reference endpoints, and error handling are unchanged for developers who opt in

### Localization

- Added French (`fr`) to `[locale]` / Headless `locale` (`auto` \| `en` \| `es` \| `pt` \| `fr`)
- Browser auto-detect maps `fr-*` → French; default remains `auto` with English fallback for unsupported tags
- Built-in French dictionary for Easy Payments-owned UI (same keys as English)
- Provider locale hints: Stripe Elements `fr`, PayPal `fr_FR`, Google Pay `buttonLocale=fr`, Klarna `fr-{country}` where supported, Affirm `fr_CA` for Canada

## 1.2.1

Documentation and package metadata release announcing the official website. **No runtime or public API changes.**

- Official website: [https://www.easy-payments.dev](https://www.easy-payments.dev)
- Package `homepage` now points to the official site
- README links for Documentation, Playground, and Contact

Published npm package remains: `@easy-payments/angular`.

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
