# easy-payments Stripe / PayPal demo server

Minimal NestJS backend for **Stripe TEST MODE** and **PayPal Sandbox** end-to-end testing with the Angular `easy-payments` library.

## Setup

```bash
cd server
cp .env.example .env
# Edit .env and set STRIPE_SECRET_KEY=sk_test_...
# Optional webhooks: STRIPE_WEBHOOK_SECRET, PAYPAL_WEBHOOK_ID
npm install
npm run start:dev
```

Listens on `PORT` (default **3001**). Payment endpoints:

- `POST http://localhost:3001/api/payments/create`
- `POST http://localhost:3001/api/payments/paypal/create`
- `POST http://localhost:3001/api/payments/paypal/capture`

Webhook reference (optional):

- `POST http://localhost:3001/api/webhooks/stripe`
- `POST http://localhost:3001/api/webhooks/paypal`
- `GET http://localhost:3001/api/webhooks/status/stripe/:paymentIntentId`

Local Stripe forwarding: `stripe listen --forward-to localhost:3001/api/webhooks/stripe`

Never put `sk_test_...`, `sk_live_...`, `whsec_...`, or PayPal client secrets in the Angular app.

The webhook status store is **in-memory and development-only**. See [`docs/backend.md`](../docs/backend.md#webhooks-reference).
