# Zip (US)

Opt-in Zip US for `@easy-payments/angular` — Full Checkout, Payment Buttons Only, and Headless Checkout.

Zip uses the **Zip US Gateway API** plus the **JS SDK** (`window.quadpay.apiCheckout.openCheckout`). It is **not** Stripe Afterpay / Clearpay.

Verified against current US merchant docs:

- [Introduction](https://docs.us.zip.co/docs/introduction) (account + Merchant Portal credentials)
- [API Integration](https://docs.us.zip.co/docs/api-integration)
- [API Implementation](https://docs.us.zip.co/docs/api-implementation) (authorize, capture, HMAC, webhooks, return query)
- [API Javascript SDK](https://docs.us.zip.co/docs/api-javascript-sdk)
- [Postman Guide](https://docs.us.zip.co/docs/postman-guide) (`merchant_id` / `client_secret` under Portal Settings)
- [Testing & QA](https://docs.us.zip.co/docs/testing)
- Go-live / certification: complete sandbox QA, provide Zip a test-site link, then receive production keys ([Go Live](https://developers.zip.co/v2/docs/go-live))

Also see the cross-method matrix: [Payment method requirements](../payment-method-requirements.md#zip-us-zip--opt-in).

## Supported checkout flow

1. Server builds the authorize `requestBody` with catalog amount + `merchantReference`, signs it with HMAC-SHA256 (Base64) using the Zip API secret (`X-QP-Signature`).
2. Client loads sandbox or production `zip.js`, then calls `openCheckout(requestBody, signature)` **synchronously on click** (body is prefetched so popup blockers do not fire).
3. Buyer completes Zip checkout (modal / popup). SDK `onComplete` / `onClose` / `onError` fire; Zip also redirects to confirm/cancel URLs with signed query params and POSTs a webhook to `callbackUrl`.
4. Client calls the merchant `zipVerifyReturnUrl` before reporting success. Server verifies signature / pending order and prevents duplicate outcome events (`alreadyReported`).
5. Default create uses `capture: true` (auto-capture). Deferred-fund-capture merchants may call `zipCaptureUrl` (`/orders/{id}/capture?sync=true`); capture is retry-safe (`alreadyCaptured`).

CDN scripts:

| Env | Script |
|-----|--------|
| Sandbox | `https://cdn.sand.us.zip.co/v1/zip.js` |
| Production | `https://cdn.us.zip.co/v1/zip.js` |

Gateway bases: `https://gateway.sand.us.zip.co/` / `https://gateway.us.zip.co/`.

## Branding & Buttons Only

| Surface | Brand treatment |
|---------|-----------------|
| Full Checkout selector | Official Zip wordmark (`zip.co/assets/fearless/logos/zip/…`). Accessible name **Zip**. |
| Buttons Only / Headless | Shared library selector + Zip CTA. Appearance (`borderRadius` / height CSS vars) preserved on the library-owned button. |

## Eligibility

| Constraint | Requirement |
|------------|-------------|
| Market | United States |
| Currency | USD |
| Opt-in | `providers.zip: {}` + `zipCreateCheckoutUrl` + `zipVerifyReturnUrl` |
| Default | **Disabled** (not in default method lists) |

## Server credentials (`ZIP_*`)

Obtain sandbox (and later production) credentials from the **Zip Merchant Portal → Settings**. Zip provides separate credentials per environment. If you need an account, sign up at Zip for Business or contact Partner Support (`partners@us.zip.co`) — see [Introduction](https://docs.us.zip.co/docs/introduction).

| Variable | Where it lives | Purpose |
|----------|----------------|---------|
| `ZIP_MERCHANT_ID` | `server/.env` only | Merchant GUID Zip includes in authorize bodies (`merchantId`) |
| `ZIP_API_SECRET` | `server/.env` only | Shared secret for HMAC-SHA256 (`X-QP-Signature`) on authorize, return query, and webhooks |
| `ZIP_MODE` | `server/.env` | `sandbox` (default) or `live` — selects gateway + CDN |
| `ZIP_CALLBACK_URL` | `server/.env` | Public HTTPS URL Zip POSTs order webhooks to (e.g. `https://…/api/webhooks/zip`). Required when `capture: true` |

**Never** put `ZIP_API_SECRET` (or any Zip secret) in Angular, environment.ts used by the browser, or git-committed files.

Configure the demo Nest reference:

1. Copy `server/.env.example` → `server/.env`.
2. Uncomment and set `ZIP_MERCHANT_ID`, `ZIP_API_SECRET`, and `ZIP_CALLBACK_URL`.
3. Keep `ZIP_MODE=sandbox` until certification.
4. Restart `npm run start:dev` in `server/`.
5. Expose the webhook with a tunnel (ngrok, Cloudflare Tunnel, etc.) so Zip can reach `ZIP_CALLBACK_URL`.

When these variables are **omitted**, the demo server still returns a signed create payload with `mock: true`. That path is for local API tests only — **Real mode in Angular rejects `mock: true`** and treats it as missing merchant configuration.

## Merchant configuration (Angular)

```ts
provideEasyPayments({
  providers: {
    zip: {},
  },
  backend: {
    zipCreateCheckoutUrl: 'https://api.example.com/payments/zip/create',
    zipVerifyReturnUrl: 'https://api.example.com/payments/zip/verify',
    // Optional — DFC / pay-on-ship only
    zipCaptureUrl: 'https://api.example.com/payments/zip/capture',
  },
});
```

Public vs secret:

| Layer | Values |
|-------|--------|
| Angular (public) | `providers.zip: {}`, backend URL strings |
| Server only | `ZIP_MERCHANT_ID`, `ZIP_API_SECRET`, `ZIP_MODE`, `ZIP_CALLBACK_URL` |

### Full Checkout / Buttons Only / Headless

Include `'zip'` in `[methods]` (or Headless `methods`). Outcomes use `method: 'zip'`, `provider: 'zip'`. Do **not** call `session.confirm()` for Zip — the mounted Zip button starts checkout.

## Mode support

| Mode | Supported | Notes |
|------|-----------|-------|
| Full Checkout | Yes | Prefetch + sync `openCheckout` |
| Buttons Only | Yes | Selector + minimal chrome panel; host owns outcomes |
| Headless | Yes | `mount('zip', el)` renders Pay with Zip; no `confirm()` |

## Mock, sandbox, and production

| Mode | Secrets | Behavior |
|------|---------|----------|
| **Mock** (`enableMockMode: true`) | None | `ZipMockAdapter` / mock panel; completes without Zip credentials or CDN |
| **Real without `ZIP_*`** | Missing | Create returns `mock: true` → library throws `CONFIG_MISSING`. Buyer sees localized “Zip is unavailable…”. Developers get the technical message via `PaymentError` + diagnostics |
| **Sandbox** | Sandbox Merchant ID + API secret + public callback | Live Zip popup via `cdn.sand.us.zip.co`; use [Testing & QA](https://docs.us.zip.co/docs/testing) data |
| **Production** | Live credentials after Zip certification | `ZIP_MODE=live` + `cdn.us.zip.co` |

### How to test (once you have sandbox credentials)

1. **Approval** — Start Zip in demo Real mode, complete checkout with sandbox test data (US mobile, SMS OTP, SSN `123-45-6789`, card `4242 4242 4242 4242`, CVC `222`, future expiry). Confirm `zipVerifyReturnUrl` succeeds once and the UI reports success (not twice).
2. **Cancellation** — Open Zip and close / cancel. Confirm cancel outcome, spinner clears, and a second attempt can start.
3. **Duplicate webhook** — Replay the same Zip webhook POST to `/api/webhooks/zip`. Confirm the server ignores the duplicate (`alreadyReported` / idempotent) and the client does not emit a second success.
4. **Optional DFC** — Authorize with `capture: false` and retry `zipCaptureUrl` safely.

## Missing configuration: buyers vs developers

| Audience | What they see |
|----------|----------------|
| **Buyer** | Localized: “Zip is unavailable. Choose another payment method.” (`zipUnavailable`) |
| **Developer** | Full `PaymentError.message` (e.g. set `ZIP_MERCHANT_ID` / `ZIP_API_SECRET`), `warnProviderDiagnostic` in dev console, `EasyPaymentsDiagnosticsService` |

When Zip is not opted in or backend URLs are missing, availability hides Zip like any other unavailable method (Full Checkout / Buttons Only filter; Headless reports readiness). Prefer omitting `'zip'` from `[methods]` until secrets are configured.

## Sandbox test data (docs)

Use a US mobile number, SMS OTP, SSN `123-45-6789`, card `4242 4242 4242 4242`, CVC `222`, future expiry. See [Testing & QA](https://docs.us.zip.co/docs/testing).

## Verification status (this workspace)

| Area | Status |
|------|--------|
| Docs: flow, HMAC, auto-capture vs DFC capture, webhook + return query, sandbox CDN, certification checklist | Verified from public Zip US docs |
| Server create / verify / capture / webhook HMAC + duplicate guards | Covered with **mock signing** when `ZIP_*` secrets are absent |
| Angular adapter: prepare → sync open → verify → hang regression (cancel retry) · mock completion without credentials | Unit tests passed |
| Buyer setup-failure copy vs developer diagnostics | Implemented (`zipUnavailable` + `warnProviderDiagnostic`) |
| **Live Zip Sandbox** (popup / OTP / Merchant Portal order) | **Pending** — needs merchant sandbox `ZIP_MERCHANT_ID` + `ZIP_API_SECRET` |

## E2E steps that still need merchant access

1. Obtain sandbox `ZIP_MERCHANT_ID` + `ZIP_API_SECRET` from Zip (Merchant Portal / partners@us.zip.co).
2. Set `ZIP_CALLBACK_URL` to a publicly reachable `/api/webhooks/zip` (tunnel).
3. Run demo Real mode with `providers.zip` + Zip backend URLs.
4. Complete approval with sandbox test data; confirm verify + webhook mark the order succeeded once.
5. Cancel / close popup; confirm cancel outcome (no success).
6. Replay webhook; confirm duplicate is ignored.
7. For DFC merchants: authorize with `capture: false` (custom) and retry `zipCaptureUrl`.
8. After sandbox QA, send Zip a test-site link for **production certification**, then switch CDN/gateway + live secrets.
