# Security

## Frontend-safe

Safe in Angular / browser config when intended by the provider:

- Stripe **publishable** key (`pk_test_...` / `pk_live_...`)
- PayPal **Client ID**
- Public merchant display names / Google Pay TEST merchant defaults
- Backend **HTTPS URLs** you own

Card number, CVC, and expiry stay inside **Stripe Elements** (provider-hosted fields). Easy Payments does **not** claim automatic PCI compliance — you must follow Stripe’s and your own compliance obligations.

## Never put in Angular

- Stripe **secret** key (`sk_test_...` / `sk_live_...`)
- Stripe **webhook signing** secret (`whsec_...`)
- PayPal **Client Secret**
- PayPal **webhook id** used for signature verification
- Private keys / certificates
- Access tokens / passwords
- Any backend-only credential

## Pricing security

Frontend `product.amount` is for display / request hints.

Your backend must validate or derive:

- product identity
- unit amount
- currency
- quantity
- discounts (if any)

before creating or capturing a charge.

PayPal, Klarna, and Affirm create routes in the reference backend **reject client amounts** and price from the server catalog. Demo Stripe create may accept a bounded playground `amount` — **remove that pattern in production**.

## Mock mode

`enableMockMode: true` never processes real money. Do not enable in production.

## Diagnostics

`EasyPaymentsDiagnosticsService.snapshot()` and its `diagnostics` signal are safe to inspect and log. Method messages are fixed strings. Snapshots do not include Stripe secret keys, PayPal client secrets, PaymentIntent client secrets, authorization headers, access tokens, raw provider responses, or customer payment data. An invalid backend URL is not copied into the snapshot.

## Payment events

`started` carries the checkout method, provider, and the current product amount and currency. It does not carry secrets or provider responses. `success` and `cancel` keep the existing `PaymentResult` fields. Prefer `transactionId` or `sessionId` over free-form messages. Prefer `PaymentError.code` over `PaymentError.message` when logging failures. Payment events are not diagnostics: a provider that is not ready does not emit `started` or `cancel`.

## Merchant metadata

`PaymentProduct.metadata` is an optional flat string map. The browser value is untrusted. It must not change the amount, currency, catalog price, product id, payment status, credentials, capture behavior, customer ownership, or backend URL.

The Angular library and the reference NestJS server both reject more than 10 entries, keys outside 1–40 characters, values outside 1–500 characters, empty keys, nested values, reserved keys, and values that look like secret keys or card numbers. Errors use a fixed message and do not include the raw value. The server validates again even when the browser already did.

Server-owned PaymentIntent fields are applied after the merchant map. PayPal receives only `orderId`, mapped to `custom_id`. That reference is not proof the order belongs to the current user.

Do not put card data, passwords, tokens, or other personal data in metadata. Diagnostics snapshots and payment lifecycle events do not include this map. `PaymentResult.metadata` is a separate provider-result field and is unchanged.

## Webhooks

The reference NestJS server can verify Stripe and PayPal webhooks (`POST /api/webhooks/stripe`, `POST /api/webhooks/paypal`). Signatures (or PayPal’s verify API) run **before** any status update. Unverified payloads are rejected. Raw webhook bodies and signing secrets are not written to logs.

PayPal `PAYPAL-CERT-URL` is allowlisted to `api.paypal.com` / `api.sandbox.paypal.com` over HTTPS only. The Nest server does **not** fetch that URL; it is passed to PayPal’s official verification API. Stripe uses the Nest `rawBody` buffer with a 300-second signature tolerance.

Angular checkout events (`started`, `success`, `cancel`, `error`) are UX signals only. Do **not** fulfill orders from them alone. Prefer verified webhooks (or server-side retrieval of PaymentIntent / capture status) as the source of truth.

Stripe `checkout.successUrl` must stay on the current page origin. Relative paths are allowed. Cross-origin URLs and non-http(s) schemes are rejected with `CONFIG_INVALID` before confirmation, so `payment_intent_client_secret` is not sent to another origin.

Samsung Pay is not a supported method.

The demo payment-status map is in-memory: not durable, not shared across instances, and not exactly-once across restarts. Production needs a persistent idempotent store. Merchant metadata / PayPal `custom_id` on webhook resources is descriptive — never proof of ownership. The NestJS app is a reference demo, not a production fulfillment system.
