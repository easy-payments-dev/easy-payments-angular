# Klarna

Klarna in Easy Payments is **Stripe-backed** (Klarna-only PaymentIntent + Stripe Payment Element).  
You do **not** configure a separate Klarna Web SDK / Klarna API secret in Angular for this integration.

**Direct confirmation:** Stripe’s Direct API was validated in a demo-only spike. The library adapter now exposes an **internal** `KlarnaAdapter.confirmDirectPayment()` capability (`stripe.confirmKlarnaPayment`, no Payment Element). It is **not** called by Full Checkout, Buttons Only, or Headless yet. Orchestration (Intent create, redirect markers, Buttons Only click path) remains for a later milestone. `evaluateBnplDirectReadiness` / `BnplConfirmMode` describe planned Buttons Only policy — see [api.md](../api.md#checkoutoptions). Backend/webhooks remain authoritative for fulfillment.

## What you need

- Stripe account with Klarna enabled  
- Stripe publishable + secret keys  
- `providers.klarna` (+ Stripe)  
- `backend.klarnaCreatePaymentUrl`  

## Frontend configuration

```ts
providers: {
  stripe: { publishableKey: 'pk_test_...' },
  klarna: {
    purchaseCountry: 'US', // optional ISO country for purchase context
    // locale: 'es-US',   // optional explicit Stripe preferred_locale override
  },
},
backend: {
  klarnaCreatePaymentUrl: '/api/payments/klarna/create',
}
```

If `klarna.locale` is omitted, Easy Payments maps `[locale]` + `purchaseCountry` into Stripe’s Klarna `preferred_locale` (for example `locale="es"` + `US` → `es-US`).

## Backend configuration

Your backend creates a **Klarna-only** PaymentIntent with trusted catalog pricing and may forward `preferredLocale`:

```ts
payment_method_types: ['klarna'],
payment_method_options: {
  klarna: { preferred_locale: 'es-US' }, // when provided
}
```

Return `{ provider: 'klarna', clientSecret }`.

Demo route: `POST /api/payments/klarna/create`.

## Dashboard / provider setup

1. Enable Klarna in Stripe Dashboard (Test/Live).  
2. Understand currency / country eligibility for Klarna in your market.  
3. Register Payment Method Domains when Stripe requires them for your setup.

Official docs:

- [Accept a Klarna payment (Stripe)](https://docs.stripe.com/payments/klarna/accept-a-payment)  
- [Payment Method Domains](https://docs.stripe.com/payments/payment-methods/pmd-registration)

## Localization

| UI | Controllable? |
|----|---------------|
| Easy Payments chrome | Yes |
| Stripe Payment Element around Klarna | Yes — Elements `locale` |
| Klarna-hosted modal / redirect | Best-effort via Stripe `preferred_locale`; invalid language+country combos are ignored by Stripe |

## Testing

- Use Stripe Test mode + Klarna test identities from Stripe docs  
- Expect redirects / modals; Easy Payments recovers return URLs via Stripe redirect helpers  
- Demo locale selection should survive reload / redirect (demo app persistence)

## Common problems

| Symptom | Check |
|---------|-------|
| English Klarna page with Spanish Easy Payments UI | preferred_locale not accepted for billing/purchase country; Elements locale alone does not control Klarna-hosted UI |
| Method missing | Klarna not enabled, currency/country/amount ineligible |
| Error screen shows Spanish title but English detail | Fixed in v1.1.0 completeness — customer UI uses localized error codes, not raw provider sentences |
