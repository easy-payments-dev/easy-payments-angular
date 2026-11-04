# Documentation

| Guide | Description |
|-------|-------------|
| [Getting Started](./getting-started.md) | Install, Quick Start, compatibility |
| [Localization](./localization.md) | Locales (`auto` / `en` / `es` / `pt`), provider limits, overrides |
| [Configuration](./configuration.md) | Theme, appearance, width, methods, events |
| [API Reference](./api.md) | Complete public API |
| [Backend](./backend.md) | Contract + NestJS reference |
| [Demo](./demo.md) | Run the Angular playground |
| [Headless Checkout](./headless.md) | Merchant Headless session API (Card, BNPL, PayPal, wallets + redirect recovery) |
| [Payment flow](./payment-flow.md) | Checkout → processing → success / error / cancel |
| [Security](./security.md) | Frontend vs backend secrets, pricing |
| [Release branch](./release-branch.md) | `release/1.0.0`, GitHub visibility limits, protection |
| [npm README images](./npm-readme-images.md) | Absolute URLs required before npm publish |

## Provider Setup

Start here when wiring real providers:

1. [Stripe](./providers/stripe.md) — keys, Payment Method Domains, HTTPS  
2. [Apple Pay](./providers/apple-pay.md) — Stripe Express Checkout + troubleshooting  
3. [Google Pay](./providers/google-pay.md) — official button + Stripe confirm  
4. [Klarna](./providers/klarna.md) — Stripe-backed BNPL  
5. [Affirm](./providers/affirm.md) — Stripe-backed BNPL  
6. [PayPal](./providers/paypal.md) — JS SDK + Orders API  

## Screenshots

Browser viewport captures of the real demo live in [`assets/`](./assets/). Labels such as Desktop / Tablet / Mobile refer to viewport emulation, not physical device claims.
