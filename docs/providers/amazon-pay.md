# Amazon Pay (Stripe)

Opt-in wallet checkout via Stripe’s **Express Checkout Element** official Amazon Pay button.

## Status

Implemented for Full Checkout, Buttons Only, and Headless. Enable Amazon Pay in the Stripe Dashboard and register **Payment Method Domains** for the checkout hostname.

## Requirements (Stripe docs)

| Item | Detail |
|------|--------|
| Account countries | US; EMEA: AT, BE, CH, CY, DE, DK, ES, FR, GB, HU, IE, IT, LU, NL, PT, SE |
| Presentment currency | US accounts: **USD only**. EMEA: AUD, CHF, DKK, EUR, GBP, HKD, JPY, NOK, NZD, SEK, USD, ZAR |
| Customer location | Worldwide |
| Activation | Dashboard → Payment methods → enable Amazon Pay |
| Domains | Register every HTTPS host/subdomain on [Payment method domains](https://dashboard.stripe.com/settings/payment_method_domains) (sandbox and live) |
| Test mode | Sandbox Amazon account via the ECE button; test cards (e.g. Visa `…1111` success, Amex `…0005` decline) |
| Min amount | ~0.50 in supported major units |

Official Stripe integration: Express Checkout Element + Payment Intents with `payment_method_types: ['amazon_pay']`. The Easy Payments demo Nest route is `POST /api/payments/amazon-pay/create`.

## What you need

| Item | Where |
|------|--------|
| Stripe account + Amazon Pay enabled | Dashboard → Payment methods |
| Publishable key `pk_test_…` / `pk_live_…` | `providers.stripe.publishableKey` |
| Opt-in | `providers.amazonPay: {}` + `'amazon-pay'` in `methods` |
| Create PaymentIntent (`['amazon_pay']`) | `backend.amazonPayCreatePaymentUrl` |
| Secret key | Server only (`sk_…`) |
| HTTPS + Payment Method Domain | Dashboard → Payment method domains |

## Frontend configuration

```ts
provideEasyPayments({
  providers: {
    stripe: { publishableKey: 'pk_test_...' },
    amazonPay: {},
  },
  backend: {
    amazonPayCreatePaymentUrl: 'https://api.example.com/payments/amazon-pay/create',
  },
});

// Explicit order — Amazon Pay appears only when included:
methods={['card', 'amazon-pay', 'paypal']}
```

Amount is resolved from the trusted product catalog on the server (productId + quantity). Do not trust a browser amount for authorization.

## Selector label vs Stripe payment button

Library-owned selectors show the official Amazon Pay acceptance mark (bundled Markpack Black/White). The mark includes the brand name; optional text overrides use the same selector-label API as other methods.

| Surface | Default label | Customization |
|---------|---------------|---------------|
| Full Checkout `[selectorLabels]` | Localized `methodAmazonPay` | `selectorLabels.amazonPay` |
| Buttons Only `buttonsAppearance.selectorLabels` | Same | `selectorLabels.amazonPay` |
| Headless | Merchants own chrome; use `PAYMENT_METHOD_LABELS['amazon-pay']`, `translations.methodAmazonPay`, or `resolveSelectorLabelOverride` | Your UI |

```ts
selectorLabels: { amazonPay: 'Checkout with Amazon Pay' }
buttonsAppearance: { selectorLabels: { amazonPay: 'Checkout with Amazon Pay' } }
```

The **payment panel** mounts Stripe’s Express Checkout Element Amazon Pay button. That chrome stays under Amazon / Stripe branding rules — `selectorLabels.amazonPay` does **not** restyle or reword the official ECE button.

## Surfaces

| Surface | Behavior |
|---------|----------|
| Full Checkout | Selectable tile (acceptance mark) → panel with official Amazon Pay ECE button |
| Buttons Only | Selector → `chrome="minimal"` panel (no inline “Payment completed.”; host owns outcome UI; success emits once) |
| Headless | `mount('amazon-pay', el)` — buyer clicks Amazon Pay; do **not** call `confirm()` |

Selector visibility uses configuration readiness (`providers.amazonPay`, Stripe publishable key, `amazonPayCreatePaymentUrl`, valid catalog amount). ECE `ready` / `availablePaymentMethods.amazonPay` gates whether Stripe’s button can pay inside the panel.

The Amazon Pay ECE is created with `paymentMethods.amazonPay: 'auto'`; other wallets on that element are `never`.

## Localization

Easy Payments passes the resolved locale into Stripe Elements (`en` / `es` / `pt-BR` / `fr`). Library-owned chrome (including `methodAmazonPay` and `amazonPayPaymentRegionAria`) is translated for EN / ES / PT / FR. Locale changes re-localize visible errors without starting another payment.

## Testing

- Stripe Test mode + [Amazon Pay / ECE test guidance](https://docs.stripe.com/elements/express-checkout-element/accept-a-payment)
- HTTPS + registered Payment Method Domain (required for Amazon Pay in Elements)
- Approve / cancel sandbox Amazon Pay flows after selecting the method
- Coexistence: Link and Amazon Pay each use a dedicated ECE with only their wallet enabled

## Ionic / Capacitor

Angular demo covers web Full Checkout / Buttons Only / Headless configuration. Ionic smoke may include Amazon Pay for **web/Test** checks when Stripe credentials and domains are ready. **Native Capacitor Amazon Pay confirmation is not claimed as verified** in this release.

## Official docs

- [Amazon Pay payments](https://docs.stripe.com/payments/amazon-pay)
- [Accept a payment with the Express Checkout Element](https://docs.stripe.com/elements/express-checkout-element)
- [Payment Method Domains](https://docs.stripe.com/payments/payment-methods/pmd-registration)
- [Amazon Pay Payment Terms (Stripe)](https://stripe.com/legal/amazon-pay)
- [Amazon Pay marketing / marks](https://pay.amazon.com/marketingkit)
