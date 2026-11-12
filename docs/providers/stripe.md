# Stripe

Card, Apple Pay, Google Pay, Klarna, Affirm, US bank account (ACH), and Cash App Pay in Easy Payments all use **Stripe** on the provider side (PayPal is separate).

## What you need

| Item | Where it lives |
|------|----------------|
| Stripe account | [dashboard.stripe.com](https://dashboard.stripe.com/) |
| Publishable key `pk_test_…` / `pk_live_…` | **SAFE FOR FRONTEND** |
| Secret key `sk_test_…` / `sk_live_…` | **SERVER ONLY** |
| Backend create-PaymentIntent endpoint | Your server (`backend.createPaymentUrl`) |

Never put `sk_*` keys in Angular / browser code.

## Frontend configuration

```ts
providers: {
  stripe: { publishableKey: 'pk_test_...' },
},
backend: {
  createPaymentUrl: 'https://api.example.com/api/payments/create',
}
```

## Backend configuration

Your backend must:

1. Authenticate with the Stripe **secret** key  
2. Create a PaymentIntent with **trusted** catalog pricing (never trust browser amount for authorization)  
3. Return `{ provider: 'stripe', clientSecret }`

Demo reference: `POST /api/payments/create` (see [backend.md](../backend.md)).

## Dashboard / provider setup

1. Create or sign in to a Stripe account.  
2. Use **Test mode** for development (`pk_test_` / `sk_test_`).  
3. Enable the payment methods you need under Stripe Dashboard → Payment methods.  
4. Register **Payment Method Domains** for wallet / Express Checkout methods (critical for Apple Pay appearance).

### Payment Method Domains (important)

Stripe requires registering the **hostname that displays checkout** for certain payment methods (Apple Pay, Google Pay, Klarna, Link, PayPal via Stripe, etc.).

Register the domain, not a full path:

- ✅ `checkout.example.com`  
- ❌ `https://checkout.example.com/path`

For local HTTPS tunnels (e.g. Cloudflare Quick Tunnel), register the **public frontend hostname**:

- ✅ `some-random-name.trycloudflare.com`  
- ❌ Do **not** register the backend API tunnel hostname just because it exists  

Temporary tunnels generate a **new hostname** when restarted — re-register when it changes. Production hostnames must also be registered.

Official docs:

- [Payment Method Domains](https://docs.stripe.com/payments/payment-methods/pmd-registration)  
- [Express Checkout Element](https://docs.stripe.com/elements/express-checkout-element)  
- [Accept a payment with Express Checkout](https://docs.stripe.com/elements/express-checkout-element/accept-a-payment)  
- [Stripe Elements locales](https://docs.stripe.com/js/appendix/supported_locales)

## Localization

Easy Payments passes the resolved locale into Stripe Elements (`en` / `es` / `pt-BR`). That localizes Stripe Elements chrome. Wallet sheets and issuer UIs may still follow device / bank language — see [localization.md](../localization.md).

## Testing

- Use Stripe Test mode and [test cards](https://docs.stripe.com/testing)  
- Serve the checkout over **HTTPS** for wallet testing  
- Confirm the exact frontend hostname is registered  

## Production checklist

- [ ] Switch to `pk_live_` / `sk_live_`  
- [ ] Trusted server-side pricing  
- [ ] HTTPS everywhere  
- [ ] Payment Method Domains registered for production hostnames  
- [ ] Webhooks for final settlement (recommended)  

## Common problems

| Symptom | Check |
|---------|-------|
| Apple Pay never appears | HTTPS, Safari/device, Wallet, PMD registration, test vs live keys |
| Wallets work on prod but not tunnel | Tunnel hostname changed / not registered |
| Secret key errors in browser | You leaked `sk_` into Angular — move it server-side |

## Related methods

| Method | Extra frontend config | Extra backend URL |
|--------|----------------------|-------------------|
| Card | `stripe.publishableKey` | `createPaymentUrl` |
| Apple Pay | `applePay: {}` (+ Stripe publishable key) | `createPaymentUrl` — empty `{}` = no extra Apple Pay frontend credentials; Stripe/domain/device setup still required |
| Google Pay | `googlePay` (+ Stripe) | `createPaymentUrl` |
| Klarna | `klarna` (+ Stripe) | `klarnaCreatePaymentUrl` |
| Affirm | `affirm` (+ Stripe) | `affirmCreatePaymentUrl` |
| US bank account | `usBankAccount` (+ Stripe) | `createUsBankAccountPaymentUrl` |
| Cash App Pay | `cashAppPay` (+ Stripe) | `cashAppPayCreatePaymentUrl` |
