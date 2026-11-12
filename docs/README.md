# Documentation

| Guide | Description |
|-------|-------------|
| [Getting Started](./getting-started.md) | Install, Quick Starts (Full Checkout · Buttons Only · Headless), compatibility |
| [Migration 1.1 → 1.2](./migration-1.1-to-1.2.md) | Upgrading from 1.1.0 to 1.2.0 |
| [Localization](./localization.md) | Locales (`auto` / `en` / `es` / `pt`), provider limits, overrides |
| [Configuration](./configuration.md) | Theme, appearance, width, methods, events |
| [API Reference](./api.md) | Complete public API (including Buttons Only) |
| [Headless Checkout](./headless.md) | Merchant Headless session API + redirect recovery |
| [Backend](./backend.md) | Contract + NestJS reference |
| [Demo](./demo.md) | Run the Angular playground |
| [Payment flow](./payment-flow.md) | Checkout → processing → success / error / cancel |
| [Security](./security.md) | Frontend vs backend secrets, pricing |
| [Release branch](./release-branch.md) | `release/1.0.0`, GitHub visibility limits, protection |
| [npm README images](./npm-readme-images.md) | Absolute URLs required before npm publish |

## Integration experiences

| Experience | Entry | Docs |
|------------|-------|------|
| **Full Checkout** | `<easy-payments>` | [Getting Started](./getting-started.md) |
| **Buttons Only** | `<easy-payment-buttons>` | [Getting Started](./getting-started.md#payment-buttons-only-event-driven) · [API](./api.md#component-easy-payment-buttons) |
| **Headless** | `EasyPaymentsHeadless` | [Getting Started](./getting-started.md#headless-quick-start) · [Headless guide](./headless.md) |

## Provider Setup

Start here when wiring real providers:

1. [Stripe](./providers/stripe.md) — keys, Payment Method Domains, HTTPS  
2. [Apple Pay](./providers/apple-pay.md) — Stripe Express Checkout + troubleshooting  
3. [Google Pay](./providers/google-pay.md) — official button + Stripe confirm  
4. [Klarna](./providers/klarna.md) — Stripe-backed BNPL  
5. [Affirm](./providers/affirm.md) — Stripe-backed BNPL  
6. [US bank account (ACH)](./providers/us-bank-account.md) — opt-in Direct Debit (FC / Buttons / Headless)
7. [Cash App Pay](./providers/cash-app-pay.md) — opt-in Stripe wallet (FC / Buttons / Headless)
8. [PayPal](./providers/paypal.md) — JS SDK + Orders API

## Screenshots

Browser viewport captures of the real demo live in [`assets/`](./assets/). Labels such as Desktop / Tablet / Mobile refer to viewport emulation, not physical device claims.
