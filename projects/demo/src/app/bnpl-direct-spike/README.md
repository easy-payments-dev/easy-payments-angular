# H6.2.4.1 — BNPL Direct Confirmation Spike

Development-only harness for manually verifying Stripe.js:

- `stripe.confirmKlarnaPayment`
- `stripe.confirmAffirmPayment`

## Open

With the demo and Nest backend running:

```text
http://localhost:4200/?ep_qa=bnpl-direct
```

## Rules

- Stripe **TEST** mode only.
- No payments on page load.
- No automatic confirmation after redirect return.
- A human operator clicks **Test Klarna Direct** / **Test Affirm Direct**.
- Do not paste real customer PII or live keys.
- Client secrets are never displayed.
- Create requests must not send reserved merchant metadata keys (for example `source`).
  Allowed demo metadata uses `orderId` / `customerReference` only.

## Removal

Delete this folder and remove the `ep_qa=bnpl-direct` wiring from `app.ts` / `app.html`.
The published `@easy-payments/angular` package does not include demo sources.
