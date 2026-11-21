# Link (Stripe)

Opt-in one-click checkout via Stripe’s **Express Checkout Element** official Link button.

## Status

Implemented for Full Checkout, Buttons Only, and Headless. Enable Link in the Stripe Dashboard and register **Payment Method Domains** for the checkout hostname.

Card Payment Element keeps `wallets.link: 'never'`, so enabling both `card` and `link` does **not** show Link twice.

## What you need

| Item | Where |
|------|--------|
| Stripe account + Link enabled | Dashboard → Payment methods |
| Publishable key `pk_test_…` / `pk_live_…` | `providers.stripe.publishableKey` |
| Opt-in | `providers.link: {}` + `'link'` in `methods` |
| Create PaymentIntent (`['link','card']`) | `backend.linkCreatePaymentUrl` |
| Secret key | Server only (`sk_…`) |
| HTTPS + Payment Method Domain | Dashboard → [Payment method domains](https://dashboard.stripe.com/settings/payment_method_domains) |

Stripe requires `payment_method_types: ['link', 'card']` for Link in the Express Checkout Element. The Easy Payments demo Nest route is `POST /api/payments/link/create`.

## Frontend configuration

```ts
provideEasyPayments({
  providers: {
    stripe: { publishableKey: 'pk_test_...' },
    link: {},
  },
  backend: {
    linkCreatePaymentUrl: 'https://api.example.com/payments/link/create',
  },
});

// Explicit order — Link appears only when included:
methods={['card', 'link', 'paypal']}
```

Amount is resolved from the trusted product catalog on the server (productId + quantity). Do not trust a browser amount for authorization.

## Selector label vs Stripe payment button

Library-owned selectors (Full Checkout tile and Buttons Only selector) show the official Link mark beside a text label.

| Surface | Default label | Customization |
|---------|---------------|---------------|
| Full Checkout `[selectorLabels]` | Localized `methodLink` (“Pay with Link” / ES/PT/FR) | `selectorLabels.link` |
| Buttons Only `buttonsAppearance.selectorLabels` | Same | `selectorLabels.link` |
| Headless | Merchants own chrome; use `PAYMENT_METHOD_LABELS.link`, `translations.methodLink`, or the same `resolveSelectorLabelOverride` helper | Your UI |

Blank / omitted `link` keys keep the localized default (same rules as Card / US bank account). Accessible names follow the visible selector label; the mark is decorative when the label is shown.

```ts
// Optional custom selector label (takes precedence over methodLink):
selectorLabels: { link: 'Checkout with Link' }

// Buttons Only:
buttonsAppearance: { selectorLabels: { link: 'Checkout with Link' } }
```

The **payment panel** still mounts Stripe’s Express Checkout Element Link button. That chrome stays under Stripe’s branding and text rules — `selectorLabels.link` does **not** restyle or reword the official ECE button.

## Surfaces

| Surface | Behavior |
|---------|----------|
| Full Checkout | Selectable tile (logo + label) → panel with official Link ECE button |
| Buttons Only | Selector (logo + label) → `chrome="minimal"` panel (no inline “Payment completed.”; host owns outcome UI) |
| Headless | `mount('link', el)` — buyer clicks Link; do **not** call `confirm()` |

Selector visibility uses configuration readiness (`providers.link`, Stripe publishable key, `linkCreatePaymentUrl`, valid catalog amount). ECE `ready` / `availablePaymentMethods.link` still gates whether Stripe’s button can pay inside the panel. A configured tile may stay selectable even when the panel reports that Stripe cannot provide a usable button (with Try again).

The Link ECE is created with `paymentMethods.link: 'auto'` — Stripe accepts only `auto` | `never` for Link (not `always`). Other wallets on that element are set to `never`.

## Localization

Easy Payments passes the resolved locale into Stripe Elements (`en` / `es` / `pt-BR` / `fr`). Library-owned chrome (including `methodLink` and `linkPaymentRegionAria`) is translated for EN / ES / PT / FR.

## Testing

- Stripe Test mode + [Link test guidance](https://docs.stripe.com/payments/link)
- HTTPS + registered Payment Method Domain (required for Link in Elements)
- Confirm card PE still has no Link wallet chrome when both methods are enabled
- Approve / cancel sandbox Link flows after selecting the tile

## Official docs

- [Link in the Express Checkout Element](https://docs.stripe.com/payments/link/express-checkout-element-link)
- [Accept a payment with the Express Checkout Element](https://docs.stripe.com/elements/express-checkout-element)
- [Payment Method Domains](https://docs.stripe.com/payments/payment-methods/pmd-registration)
- [Link Terms (Marks)](https://stripe.com/legal/link)
