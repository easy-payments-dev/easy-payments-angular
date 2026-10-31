# Backend Requirements & API Contract

Easy Payments is a **frontend** Angular library. Sensitive operations require **your** backend.

You do **not** need NestJS. Any stack works if it implements the HTTP contract below.

---

## Why a backend is required

| Responsibility | Where |
|----------------|-------|
| Stripe secret key / PayPal Client Secret | Backend only |
| Trusted product price / currency / quantity | Backend |
| Create PaymentIntent / PayPal order | Backend |
| Capture PayPal order | Backend |
| Klarna / Affirm PaymentIntent create | Backend |
| Webhooks & reconciliation (production) | Backend |

The Angular app may send `productId` + `quantity` (+ display amount for some Stripe flows). **Production backends must not trust browser amounts** as the final charge authority.

---

## Reference NestJS backend

Path: [`server/`](../server)

- Example integration used by the demo
- **Not** required for consumers
- **Not** automatically production-ready

Before production, review: trusted pricing, auth, rate limits, HTTPS, live credentials, webhooks, logging, and validation.

---

## Endpoints (reference demo)

Base URL in local demo: `http://localhost:3001`

### Stripe card / wallets (PaymentIntent)

`POST /api/payments/create` → **201**

Request (validated by Nest DTO):

```json
{
  "provider": "stripe",
  "productId": "premium-plan",
  "quantity": 1,
  "currency": "USD",
  "amount": 99,
  "description": "optional",
  "metadata": {
    "orderId": "ORDER-12345",
    "customerReference": "CUSTOMER-789"
  }
}
```

`metadata` is optional. The reference server accepts at most 10 string entries, keys of at most 40 characters, and values of at most 500 characters. Reserved keys such as `amount`, `currency`, `productId`, `quantity`, and `source` are rejected. Invalid metadata returns a fixed error and is not truncated or attached to Stripe.

The PaymentIntent amount and currency still come from the catalog (or the bounded demo `amount` field). Trusted metadata (`productId`, `quantity`, `source`, `unitAmount`, `catalogUnitAmount`) is written after the merchant map.

Response shape expected by the library:

```json
{
  "provider": "stripe",
  "clientSecret": "pi_..._secret_...",
  "sessionId": "optional",
  "paymentIntentId": "optional"
}
```

Security: uses `STRIPE_SECRET_KEY`. Demo may honour `amount` within bounds for playground testing; production must price from catalog.

---

### PayPal create order

`POST /api/payments/paypal/create` → **201**

Request:

```json
{
  "provider": "paypal",
  "productId": "premium-plan",
  "quantity": 1,
  "currency": "USD",
  "orderReference": "ORDER-12345"
}
```

> Client-supplied charge amounts are **not** accepted on this route. A metadata map is also rejected by the DTO whitelist.

`orderReference` is optional. It is the merchant `orderId` and is stored as PayPal `custom_id` (maximum 127 characters). Other metadata keys are not sent. `invoice_id` is not set. When `orderReference` is omitted, `custom_id` stays the catalog product id.

Response:

```json
{
  "provider": "paypal",
  "orderId": "..."
}
```

### PayPal capture

`POST /api/payments/paypal/capture` → **200**

Request:

```json
{ "orderId": "..." }
```

Response:

```json
{
  "provider": "paypal",
  "orderId": "...",
  "captureId": "...",
  "status": "COMPLETED"
}
```

Uses PayPal Client ID + Client Secret server-side (`PAYPAL_MODE=sandbox|live`).

---

### Klarna (Stripe-backed)

`POST /api/payments/klarna/create` → **201**

Request:

```json
{
  "provider": "klarna",
  "productId": "premium-plan",
  "quantity": 1,
  "currency": "USD",
  "metadata": { "orderId": "ORDER-12345" }
}
```

Amount is resolved **server-side** from the catalog (no trusted client amount). Optional `metadata` uses the same string-map rules as the card PaymentIntent and is stored on that Klarna PaymentIntent. Browser metadata cannot replace `productId`, `paymentMethod`, or `trustedUnitAmount`.

Response:

```json
{
  "provider": "klarna",
  "clientSecret": "...",
  "paymentIntentId": "optional",
  "sessionId": "optional"
}
```

---

### Affirm (Stripe-backed)

`POST /api/payments/affirm/create` → **201**

Same shape as Klarna with `"provider": "affirm"`. Catalog-priced. Optional metadata is stored on the Affirm PaymentIntent with the same validation. Affirm eligibility / minimums may hide the method in the UI (library applies ~$35 minimum presentment).

---

### Catalog (demo helper)

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/catalog/products` | List trusted demo products |
| `GET` | `/api/catalog/products/:productId` | One product |

Not required for production merchants that already have a catalog API.

---

## Frontend `backend` config mapping

| `EasyPaymentsBackendConfig` field | Demo path |
|-----------------------------------|-----------|
| `createPaymentUrl` | `/api/payments/create` |
| `paypalCreateOrderUrl` | `/api/payments/paypal/create` |
| `paypalCaptureOrderUrl` | `/api/payments/paypal/capture` |
| `klarnaCreatePaymentUrl` | `/api/payments/klarna/create` |
| `affirmCreatePaymentUrl` | `/api/payments/affirm/create` |
| `baseUrl` | Optional. Prefixes relative endpoints only. |

### `backend.baseUrl`

Use `baseUrl` when every relative endpoint shares one origin. Omit it to keep today's behavior: each endpoint is requested exactly as configured.

```ts
backend: {
  baseUrl: 'https://api.example.com',
  createPaymentUrl: '/api/payments/create',
  paypalCreateOrderUrl: '/api/payments/paypal/create',
  paypalCaptureOrderUrl: '/api/payments/paypal/capture',
  klarnaCreatePaymentUrl: '/api/payments/klarna/create',
  affirmCreatePaymentUrl: '/api/payments/affirm/create',
}
```

That calls `https://api.example.com/api/payments/create`. A trailing slash on `baseUrl` is ignored. An endpoint without a leading slash is joined the same way. A path prefix is kept: `baseUrl: 'https://api.example.com/v1'` plus `/payments/create` becomes `https://api.example.com/v1/payments/create`. Query strings and fragments on the endpoint are preserved and are not encoded again.

An absolute `http:` or `https:` endpoint is an override and is not prefixed:

```ts
createPaymentUrl: 'https://payments.other-provider.com/create'
```

`javascript:`, `data:`, and protocol-relative URLs (`//example.com/...`) are rejected. One invalid endpoint does not disable an unrelated provider. An omitted `baseUrl` does not warn.

**Local proxy.** Leave `baseUrl` unset and use relative paths such as `/api/payments/create`. The Angular dev server proxy forwards them.

**Separate local API.** `baseUrl: 'http://localhost:3001'` with the same relative paths. The API must allow the Angular origin in CORS.

**Production.** `baseUrl: 'https://api.example.com'` (HTTPS). Secret keys and PayPal client secrets stay on that server, never in Angular.

---

## Webhooks (reference)

The NestJS demo server includes **optional** verified webhook receivers. They are independent of the Angular library. Frontend `success` / `started` events are **not** authoritative for fulfillment — use verified webhooks (or your own reconciliation) before shipping goods or unlocking entitlements.

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/webhooks/stripe` | Stripe-signed PaymentIntent events |
| `POST` | `/api/webhooks/paypal` | PayPal-verified capture / order events |
| `GET` | `/api/webhooks/status/:provider/:paymentId` | Local inspection of derived status (in-memory) |

### Stripe

1. Set `STRIPE_WEBHOOK_SECRET=whsec_...` (Dashboard → Developers → Webhooks, or `stripe listen --forward-to localhost:3001/api/webhooks/stripe`).
2. The handler verifies `Stripe-Signature` against the **exact raw body** (`NestFactory` `rawBody: true`). Missing secret → **503**. Invalid signature → **400**.
3. Supported reference events: `payment_intent.succeeded`, `payment_intent.payment_failed`, `payment_intent.processing`, `payment_intent.canceled`. Other types are acknowledged without changing status.
4. Local CLI: `stripe listen --forward-to localhost:3001/api/webhooks/stripe` then trigger a test PaymentIntent.

### PayPal

1. Create a Sandbox webhook in the PayPal developer dashboard pointing at your public HTTPS URL (or a tunnel) for `POST /api/webhooks/paypal`.
2. Set `PAYPAL_WEBHOOK_ID` to that webhook’s id. Missing id → **503**.
3. The handler requires PayPal transmission headers, allowlists `PAYPAL-CERT-URL` to `https://api.paypal.com` or `https://api.sandbox.paypal.com` only (no userinfo, no non-443 ports, no `*.paypal.com` wildcards), then calls `POST /v1/notifications/verify-webhook-signature` with server credentials. **This backend never downloads the certificate URL**; PayPal’s verify API consumes it. Verification must return `verification_status: SUCCESS`.
4. Capture events: `PAYMENT.CAPTURE.COMPLETED` → `SUCCEEDED`, `DENIED` → `FAILED`, `PENDING` → `PROCESSING`, `REFUNDED` → `REFUNDED`.
5. `CHECKOUT.ORDER.APPROVED` is recorded as `PENDING` only (order approval ≠ captured payment).

### In-memory status store

Verified events update a **process-local** `PaymentStatusStore`:

- States: `PENDING`, `PROCESSING`, `SUCCEEDED`, `FAILED`, `CANCELED`, `REFUNDED`
- Deduped by provider event id (at-most-once side effects **per process**)
- `SUCCEEDED` is not downgraded by delayed `PROCESSING` / failure events; `REFUNDED` may follow `SUCCEEDED`
- **Not durable**, **not multi-instance safe**, **not exactly-once** across restarts

Replace this store with a durable database (and idempotent consumer) before production. Webhook HTTP 200 means the event was accepted for reference processing — not that business fulfillment succeeded.

### Environment

```env
STRIPE_SECRET_KEY=YOUR_STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET=YOUR_STRIPE_WEBHOOK_SECRET
PAYPAL_CLIENT_ID=YOUR_PAYPAL_CLIENT_ID
PAYPAL_CLIENT_SECRET=YOUR_PAYPAL_CLIENT_SECRET
PAYPAL_MODE=sandbox
PAYPAL_WEBHOOK_ID=YOUR_PAYPAL_WEBHOOK_ID
PORT=3000
FRONTEND_ORIGIN=http://localhost:4200
```

Webhook secrets are optional for server startup. Payment create/capture keep working without them. Verification is never skipped when a webhook request arrives without configuration.

## Server env (demo)

See [`server/.env.example`](../server/.env.example) for the full placeholder list (including optional webhook variables above).

Never commit real `.env` files.
