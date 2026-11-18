# Localization

Since **v1.1.0**, Easy Payments ships built-in UI localization for checkout chrome owned by the library. **v1.3.0** adds French (`fr`) alongside English, Spanish, and Portuguese.

Supported `[locale]` values:

| Value | Meaning |
|-------|---------|
| `auto` | Default. Detect from the browser when available. |
| `en` | English |
| `es` | Spanish |
| `pt` | Portuguese |
| `fr` | French |

```html
<easy-payments
  [product]="product"
  locale="fr"
  (success)="onSuccess($event)"
  (cancel)="onCancel($event)"
  (error)="onError($event)"
/>
```

---

## Auto detection

With `locale="auto"` (or when the input is omitted):

1. Read `navigator.languages` (then `navigator.language`) when available
2. Normalize the first usable tag:
   - `es`, `es-MX`, `es-ES`, … → **`es`**
   - `pt`, `pt-BR`, `pt-PT`, … → **`pt`**
   - `fr`, `fr-FR`, `fr-CA`, … → **`fr`**
   - `en`, `en-US`, … → **`en`**
   - anything else → **`en`**
3. On SSR / environments without `navigator`, fall back to **`en`**

---

## What Easy Payments localizes

Easy Payments-owned UI strings, including:

- Checkout title / subtitle
- Payment method labels and selection chrome
- Order summary / totals copy (not merchant product name/description)
- Processing, success, error, and cancelled screens
- Localized **normalized** error details (by `PaymentError.code`)
- Pay / continue / try-again style actions
- Method panel helper text owned by the library

English is the canonical dictionary. Spanish, Portuguese, and French implement the same key set.

Merchant-provided `product.name` / `product.description` are **never** auto-translated.

Technical `PaymentError.message` strings may remain English for developer diagnostics. Customer-facing checkout uses localized copy derived from the error **code**, not the raw provider sentence.

---

## Provider locale mapping

Easy Payments maps the effective locale into **official** provider options where supported:

| Surface | Mapping | What it affects |
|---------|---------|-----------------|
| Stripe Elements / Payment Element / Express Checkout | `en` → `en`, `es` → `es`, `pt` → `pt-BR`, `fr` → `fr` | Stripe-owned Elements chrome |
| Google Pay official button | `en` / `es` / `pt` / `fr` → `buttonLocale` | Google Pay **button** text only |
| PayPal JS SDK | `en` → `en_US`, `es` → `es_ES`, `pt` → `pt_BR`, `fr` → `fr_FR` | PayPal Buttons UI (SDK reload on change) |
| Klarna (Stripe) | `payment_method_options.klarna.preferred_locale` e.g. `es-US`, `fr-FR` | Klarna-hosted page **when Stripe accepts** that language+country pair (French for FR/BE/CA/CH/LU; otherwise English for that country) |
| Affirm (Stripe) | `payment_method_options.affirm.preferred_locale` e.g. `en_US`, `fr_CA` | Affirm page languages officially supported for the market (`fr_CA` when locale is French and purchase country is CA; US stays English) |

Optional merchant overrides:

- `providers.klarna.locale` / `providers.affirm.locale` — if set, used as the Stripe preferred locale instead of the auto mapping from `[locale]`.

### What Easy Payments cannot officially force

Do **not** expect Easy Payments to hack provider iframes, wallet sheets, or undocumented APIs.

| Surface | Behavior |
|---------|----------|
| Apple Pay system wallet sheet | Follows Apple / device / Wallet language. Stripe Elements locale may affect ECE **button** chrome, not the OS sheet. |
| Google Pay payment sheet | Follows Google account / browser / OS language. `buttonLocale` does not control the sheet. |
| Bank / issuer 3-D Secure | Issuer-owned. |
| Klarna / Affirm hosted UI | Controlled only via Stripe’s official preferred_locale (and validated against country). Unsupported combos fall back to Stripe/Klarna/Affirm defaults. |
| Provider trademarks | Left as brand names (PayPal, Apple Pay, …). |

---

## Custom translation overrides

Use `[translations]` with a **partial** object. Resolution order per key:

1. Your override
2. Dictionary for the effective locale (`en` / `es` / `pt` / `fr`)
3. English fallback

```ts
import type { EasyPaymentsTranslationOverrides } from '@easy-payments/angular';

readonly translations: EasyPaymentsTranslationOverrides = {
  successTitle: 'Commande confirmée !',
  successContinue: 'Retour à la boutique',
  payWithCard: 'Payer par carte',
};
```

---

## Currency formatting (no conversion)

Checkout amounts are formatted with `Intl.NumberFormat` using the active locale for **display only**.

- `product.amount` is **not** changed
- `product.currency` is **not** converted
- There is **no** FX / currency conversion in Easy Payments

Reminder: `amount` uses **major currency units** (`99` = $99.00 USD), not cents.

---

## Related

- [Getting Started](./getting-started.md)
- [Provider Setup](./providers/stripe.md) (and sibling provider guides)
- [API Reference](./api.md)
- [CHANGELOG](../CHANGELOG.md)
