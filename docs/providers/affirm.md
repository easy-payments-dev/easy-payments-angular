# Affirm

Affirm in Easy Payments is **Stripe-backed** (Affirm-only PaymentIntent + Stripe Payment Element).  
You do **not** configure Affirm’s direct JS SDK secrets in Angular for this integration.

**Direct confirmation:** Stripe’s Direct API was validated in a demo-only spike. Production Full Checkout, Buttons Only, and Headless still use Payment Element. Exported `evaluateBnplDirectReadiness` / `BnplConfirmMode` describe the planned Buttons Only policy only — see [api.md](../api.md#checkoutoptions).

## What you need

- Stripe account with Affirm enabled  
- Stripe publishable + secret keys  
- `providers.affirm` (+ Stripe)  
- `backend.affirmCreatePaymentUrl`  

## Frontend configuration

```ts
providers: {
  stripe: { publishableKey: 'pk_test_...' },
  affirm: {
    purchaseCountry: 'US', // optional
    // locale: 'en_US',    // optional explicit Stripe Affirm preferred_locale
  },
},
backend: {
  affirmCreatePaymentUrl: '/api/payments/affirm/create',
}
```

## Backend configuration

Create an Affirm-only PaymentIntent with trusted catalog pricing. Optional:

```ts
payment_method_options: {
  affirm: { preferred_locale: 'en_US' },
}
```

Return `{ provider: 'affirm', clientSecret }`.

Demo route: `POST /api/payments/affirm/create`.

Affirm presentment typically supports USD/CAD with amount bounds (about $35–$30,000 in Stripe’s Affirm docs). The demo server enforces those bounds.

## Dashboard / provider setup

1. Enable Affirm in Stripe Dashboard.  
2. Confirm your business country / financing package.  
3. Register domains when Stripe requires them.

Official docs:

- [Stripe Affirm](https://docs.stripe.com/payments/affirm)  
- [PaymentIntents Affirm options](https://docs.stripe.com/api/payment_intents/create#create_payment_intent-payment_method_options-affirm)

## Localization

| UI | Controllable? |
|----|---------------|
| Easy Payments chrome | Yes |
| Stripe Payment Element | Yes — Elements `locale` |
| Affirm authorization page | Limited — Affirm’s documented page languages for US/CA are primarily English (and French for Canada). Easy Payments does **not** invent unsupported Affirm locales for `es` / `pt`. |

## Testing

- Stripe Test mode  
- Amounts within Affirm eligibility  
- Redirect return recovery via Stripe helpers  

## Common problems

| Symptom | Check |
|---------|-------|
| Affirm unavailable | Amount too low/high, currency not USD/CAD, Affirm not enabled |
| Spanish Easy Payments UI but English Affirm page | Expected for US Affirm page languages unless Affirm/Stripe supports another locale for your market |
