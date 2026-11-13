# PayPal

PayPal in Easy Payments uses the **PayPal JavaScript SDK** in the browser and the **Orders v2 API** on your backend.

## What you need

| Item | Where |
|------|-------|
| PayPal Developer account | [developer.paypal.com](https://developer.paypal.com/) |
| App in Apps & Credentials | [Applications](https://developer.paypal.com/dashboard/applications/) |
| Client ID | **SAFE FOR FRONTEND** (Sandbox vs Live differ) |
| Client secret | **SERVER ONLY** |
| Backend create-order + capture-order endpoints | Your server |

Never expose the PayPal client secret in Angular.

## Frontend configuration

```ts
providers: {
  paypal: {
    clientId: 'YOUR_PAYPAL_CLIENT_ID',
    currency: 'USD',
    intent: 'capture',
  },
},
backend: {
  paypalCreateOrderUrl: '/api/payments/paypal/create',
  paypalCaptureOrderUrl: '/api/payments/paypal/capture',
}
```

## Backend configuration

1. Create an order with trusted catalog pricing (Orders API).  
2. Return `{ provider: 'paypal', orderId }`.  
3. After buyer approval, capture the order server-side.  
4. Return `{ provider: 'paypal', orderId, captureId, status? }`.

Demo routes: create + capture under `/api/payments/paypal/*` (see [backend.md](../backend.md)).

## Dashboard / provider setup

1. Create/sign in at [PayPal Developer](https://developer.paypal.com/).  
2. Create an app under [Apps & Credentials](https://developer.paypal.com/dashboard/applications/).  
3. Use **Sandbox** credentials for testing; **Live** credentials for production.  
4. Keep Sandbox and Live Client IDs separate.

Official docs:

- [JavaScript SDK](https://developer.paypal.com/sdk/js/)  
- [Orders API v2](https://developer.paypal.com/docs/api/orders/v2/)  
- [Sandbox](https://developer.paypal.com/tools/sandbox/)

## Localization

Easy Payments loads the PayPal JS SDK with:

| Easy Payments locale | PayPal SDK `locale` |
|----------------------|---------------------|
| `en` | `en_US` |
| `es` | `es_ES` |
| `pt` | `pt_BR` |

Runtime locale changes unload/reload the SDK script for the new locale (no duplicate conflicting scripts).

## Venmo

Venmo is a **separate opt-in** method (`providers.venmo` + `'venmo'` in methods). When configured, Easy Payments loads the shared PayPal JS SDK with `enable-funding=venmo` and reuses the same Orders create/capture endpoints. See [venmo.md](./venmo.md).

## Testing

1. Use Sandbox Client ID.  
2. Pay with a Sandbox buyer account from the PayPal Sandbox tools.  
3. Confirm create + capture succeed against your backend.

## Production checklist

- [ ] Switch to Live Client ID (frontend) + Live secret (backend only)  
- [ ] Live create/capture endpoints  
- [ ] Trusted server-side pricing  
- [ ] HTTPS  

## Common problems

| Symptom | Check |
|---------|-------|
| Buttons missing | Client ID, currency, SDK load errors, backend URLs |
| Locale stuck after switching | Easy Payments should remount Buttons after SDK reload — verify `[locale]` changed |
| Secret in browser bundle | Move Client Secret to server immediately |
