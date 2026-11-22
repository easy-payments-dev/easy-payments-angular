# Alipay (Stripe)

Opt-in Alipay for `@easy-payments/angular` — Full Checkout, Payment Buttons Only, and Headless Checkout.

Alipay in Easy Payments is **Stripe-backed** (Alipay-only PaymentIntent + Stripe Payment Element + redirect confirmation). You do **not** configure a separate Alipay SDK in Angular.

Verified against Stripe docs: Payment Element + Payment Intents is supported. Express Checkout Element does **not** support Alipay.

## Eligibility (Stripe)

| Constraint | Requirement |
|------------|-------------|
| Merchant countries | CA, US; EMEA (AT, BE, BG, CH, CY, CZ, DE, DK, EE, ES, FI, FR, GB, GI, GR, HR, HU, IE, IT, LI, LT, LU, LV, MT, NL, NO, PT, RO, SE, SI, SK); APAC (AU, HK, JP, MY, NZ, SG) |
| Customer location | China (CN) |
| Presentment currencies | AUD, CAD, CHF, CNY, EUR, GBP, HKD, JPY, MYR, NZD, SGD, USD |
| Amount | Min ~0.50 major units; max 999,999.99 USD-equivalent |
| Activation | Dashboard → Payment methods → enable Alipay |
| Auth UX | Redirect / QR to Alipay; return via `return_url` |
| Test mode | Stripe Test keys + Dashboard Alipay enabled; use Stripe’s Alipay test guidance |

## Scope

- Opt in with `'alipay'` in `[methods]` (or Headless `methods`) + `providers.alipay: {}`
- Requires Stripe `publishableKey` + `backend.alipayCreatePaymentUrl`
- Catalog amount is authoritative on the server (`payment_method_types: ['alipay']`)
- Reuses shared Stripe redirect recovery (`ep_method=alipay` + attempt-scoped pending marker) like Afterpay / Klarna / Affirm / Cash App Pay
- Buttons Only uses `chrome="minimal"` and emits success **once** for the host UI
- Headless: `mount('alipay', el)` then `confirm()`; after redirect, recreate the session and call `recoverReturn()` with a stable `checkoutInstanceId`

## Merchant configuration

```ts
provideEasyPayments({
  providers: {
    stripe: { publishableKey: 'pk_test_...' },
    alipay: {},
  },
  backend: {
    alipayCreatePaymentUrl: 'https://api.example.com/payments/alipay/create',
  },
});

methods={['card', 'alipay']}
```

Demo Nest route: `POST /api/payments/alipay/create`.

## Selector labels

| Surface | Default | Override |
|---------|---------|----------|
| Full Checkout | Localized `methodAlipay` | `selectorLabels.alipay` |
| Buttons Only | Same | `buttonsAppearance.selectorLabels.alipay` |

Library-owned selectors use an Alipay wordmark (light/dark). The Payment Element chrome stays under Stripe/Alipay branding rules.

## Buttons Only — confirm CTA customization

The library-owned **Continue to Alipay** button (`.ep-alipay__pay`) uses the same public `[cardButtonAppearance]` **styles** as Card / ACH (`--ep-card-cta-*` with `--ep-cta-*` fallbacks for hover, focus-visible, disabled, processing).

**Labels are method-specific:** `label` applies to Card (and ACH) only. Alipay uses localized `continueToMethod` (EN/ES/PT/FR) unless you set `alipayLabel`. Blank/invalid `alipayLabel` keeps the localized default. This does **not** restyle the Stripe Payment Element.

```html
<easy-payment-buttons
  [product]="product"
  [methods]="['card', 'alipay']"
  [cardButtonAppearance]="ctaAppearance"
  (success)="onSuccess($event)"
/>
```

```ts
ctaAppearance: EasyPaymentsCardButtonAppearance = {
  label: 'Complete card payment', // Card CTA only
  alipayLabel: 'Pay with Alipay', // Alipay Continue CTA only
  backgroundColor: '#1677FF',
  textColor: '#ffffff',
  fontFamily: 'inherit',
  fontSize: '15px',
  fontWeight: 650,
  borderRadius: '8px',
  padding: '0 20px',
  minHeight: '44px',
  width: '100%',
  hoverBackgroundColor: '#0958d9',
  hoverTextColor: '#ffffff',
  disabledBackgroundColor: '#94a3b8',
  disabledTextColor: '#f8fafc',
  loadingBackgroundColor: '#1e293b',
  loadingTextColor: '#f8fafc',
  focusOutlineColor: '#1677FF',
  focusOutlineWidth: '2px',
  focusOutlineOffset: '2px',
};
```

Duplicate-submit protection, redirect recovery, localized errors, and success-once events are unchanged.

## Headless — host-rendered confirm button

Headless does **not** render a library CTA. Mount Alipay, then call `session.confirm()` from your own button. Gate with `availableMethods()` readiness and `session.state()`; disable while processing.

```ts
async onPayWithAlipay(): Promise<void> {
  const entry = this.session.availableMethods().find((m) => m.method === 'alipay');
  if (!entry || entry.readiness !== 'ready' || this.session.state() !== 'ready') {
    return;
  }
  await this.session.confirm();
}
```

```html
<button
  type="button"
  class="my-alipay-pay"
  [disabled]="!canConfirmAlipay"
  (click)="onPayWithAlipay()"
>
  {{ confirming ? 'Processing…' : 'Continue with Alipay' }}
</button>
```

Style `.my-alipay-pay` entirely in the host stylesheet. After redirect, recreate the session and call `recoverReturn()` with a stable `checkoutInstanceId`.

## Localization

EN / ES / PT / FR for library-owned chrome (including the default Continue CTA). Locale is passed into Stripe Elements. Visible errors re-localize without starting another payment.

## Ionic / Capacitor

Angular demo covers web Full Checkout / Buttons / Headless configuration. **Native Capacitor Alipay redirect return is not claimed as verified** in this release — complete a Test-mode redirect return on device before claiming native support. See [ionic-capacitor-compatibility.md](../ionic-capacitor-compatibility.md).

## Official docs

- [Alipay payments](https://docs.stripe.com/payments/alipay)
- [Accept an Alipay payment](https://docs.stripe.com/payments/alipay/accept-a-payment)
