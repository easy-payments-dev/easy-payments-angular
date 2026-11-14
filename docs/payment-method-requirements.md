# Payment method requirements

Setup requirements for every payment method exposed by `@easy-payments/angular` on this branch.

**Surfaces:** Full Checkout (`<easy-payments>`), Payment Buttons Only (`<easy-payment-buttons>`), Headless (`EasyPaymentsHeadless`).

**Unavailable UX:** Full Checkout and Buttons Only **hide** methods that fail availability (they are not shown as disabled tiles). Headless lists them with `readiness` / `diagnosticCode`. Use `EasyPaymentsDiagnosticsService` for developer-facing codes — never show diagnostic detail to buyers.

**Mock:** `enableMockMode: true` uses mock adapters for every method. No provider secrets required. Never enable in production.

| Method | Provider | Full | Buttons | Headless | Detailed guide |
|--------|----------|:----:|:-------:|:--------:|----------------|
| `card` | Stripe | Yes | Yes | Yes | [stripe.md](./providers/stripe.md) |
| `apple-pay` | Stripe Express Checkout | Yes | Yes | Yes | [apple-pay.md](./providers/apple-pay.md) |
| `google-pay` | Stripe + Google Pay | Yes | Yes | Yes | [google-pay.md](./providers/google-pay.md) |
| `paypal` | PayPal JS SDK + Orders | Yes | Yes | Yes | [paypal.md](./providers/paypal.md) |
| `venmo` | PayPal JS SDK (Venmo funding) | Opt-in | Opt-in | Opt-in | [venmo.md](./providers/venmo.md) |
| `klarna` | Stripe BNPL | Opt-in | Yes\* | Opt-in | [klarna.md](./providers/klarna.md) |
| `affirm` | Stripe BNPL | Opt-in | Yes\* | Opt-in | [affirm.md](./providers/affirm.md) |
| `us-bank-account` | Stripe ACH | Opt-in | Opt-in | Opt-in | [us-bank-account.md](./providers/us-bank-account.md) |
| `cash-app-pay` | Stripe Cash App Pay | Opt-in | Opt-in | Opt-in | [cash-app-pay.md](./providers/cash-app-pay.md) |
| `afterpay` | Stripe Afterpay/Clearpay | Opt-in | Opt-in | Opt-in | [afterpay.md](./providers/afterpay.md) |
| `zip` | Zip US Gateway + JS SDK | Opt-in | Opt-in | Opt-in | [zip.md](./providers/zip.md) |

\* Klarna and Affirm appear in the Buttons Only **default** `[methods]` list; they still need Stripe + their create URLs to become available.

---

## Card (`card`)

| | |
|--|--|
| **Provider** | Stripe Payment Element |
| **Modes** | Full Checkout · Buttons Only · Headless (`mount` + `confirm()`) |
| **Merchant** | [Stripe account](https://dashboard.stripe.com/); enable Cards in Dashboard → Payment methods |
| **Public (Angular)** | `providers.stripe.publishableKey` (`pk_test_` / `pk_live_`) |
| **Server-only** | `STRIPE_SECRET_KEY`, optional `STRIPE_WEBHOOK_SECRET` |
| **Backend** | `backend.createPaymentUrl` → `{ provider: 'stripe', clientSecret }` |
| **Constraints** | Browser for Elements; production HTTPS recommended |
| **Mock / sandbox / prod** | Mock via `enableMockMode`. Test: `pk_test_` + `sk_test_`. Live: `pk_live_` + `sk_live_` + webhooks for fulfillment |
| **Unavailable** | Hidden when key/URL missing; diagnostics `PROVIDER_MISCONFIGURED` / `CONFIG_*` |
| **Guide** | [providers/stripe.md](./providers/stripe.md) |

```ts
provideEasyPayments({
  providers: { stripe: { publishableKey: 'pk_test_...' } },
  backend: { createPaymentUrl: 'https://api.example.com/payments/create' },
});
```

---

## Apple Pay (`apple-pay`)

| | |
|--|--|
| **Provider** | Stripe Express Checkout Element (no Apple Merchant ID in Angular) |
| **Modes** | Full · Buttons · Headless (`wallet-button`) |
| **Merchant** | Stripe account; enable Apple Pay; register **Payment Method Domains** for the checkout hostname |
| **Public** | `providers.applePay: {}` (optional `merchantName`, `countryCode`) + Stripe `publishableKey` |
| **Server-only** | Same Stripe secret via `createPaymentUrl` |
| **Backend** | `backend.createPaymentUrl` (shared with card) |
| **Constraints** | HTTPS; Apple device / Safari / Wallet with a card; availability only when Stripe ECE reports Apple Pay ready. No user-agent sniffing in the library |
| **Mock / sandbox / prod** | Mock adapter in mock mode. Test Stripe + domain registration. Live: `pk_live_` + production domains |
| **Unavailable** | Hidden (or loading while checking); diagnostics `PROVIDER_UNAVAILABLE` / `PROVIDER_AVAILABILITY_PENDING` |
| **Guide** | [providers/apple-pay.md](./providers/apple-pay.md) · [Stripe PMD](https://docs.stripe.com/payments/payment-methods/pmd-registration) |

---

## Google Pay (`google-pay`)

| | |
|--|--|
| **Provider** | Google Pay button + Stripe confirm |
| **Modes** | Full · Buttons · Headless |
| **Merchant** | Stripe + [Google Pay & Wallet Console](https://pay.google.com/business/console) for PRODUCTION `merchantId` |
| **Public** | `providers.googlePay` (`environment?`, `merchantId?`, `merchantName?`, `countryCode?`) + Stripe `publishableKey` |
| **Server-only** | Stripe secret via `createPaymentUrl` |
| **Backend** | `backend.createPaymentUrl` |
| **Constraints** | HTTPS; supported browser / Google account; PRODUCTION requires `merchantId`. TEST uses Google’s documented test merchant id |
| **Mock / sandbox / prod** | `environment: 'TEST'` vs `'PRODUCTION'`. TEST tokens are not chargeable |
| **Unavailable** | Hidden; diagnostics `PROVIDER_UNAVAILABLE` |
| **Guide** | [providers/google-pay.md](./providers/google-pay.md) |

```ts
providers: {
  stripe: { publishableKey: 'pk_test_...' },
  googlePay: { environment: 'TEST', merchantName: 'Example Store', countryCode: 'US' },
},
```

---

## PayPal (`paypal`)

| | |
|--|--|
| **Provider** | PayPal JS SDK Buttons + Orders v2 |
| **Modes** | Full · Buttons · Headless (`paypal-buttons`; **no** `confirm()`) |
| **Merchant** | [PayPal Developer Dashboard](https://developer.paypal.com/dashboard/) app; enable checkout |
| **Public** | `providers.paypal.clientId` (+ optional `currency`, `intent`) |
| **Server-only** | `PAYPAL_CLIENT_SECRET`, `PAYPAL_MODE`, optional `PAYPAL_WEBHOOK_ID` |
| **Backend** | `paypalCreateOrderUrl`, `paypalCaptureOrderUrl` |
| **Constraints** | Client ID + both URLs; currency via PayPal config |
| **Mock / sandbox / prod** | Sandbox vs Live Client IDs; `PAYPAL_MODE=sandbox\|live`; webhooks for settlement |
| **Unavailable** | Hidden; `PROVIDER_MISCONFIGURED` |
| **Guide** | [providers/paypal.md](./providers/paypal.md) |

---

## Venmo (`venmo`) — opt-in

| | |
|--|--|
| **Provider** | PayPal JS SDK (`enable-funding=venmo` + Venmo Buttons). **Same Orders URLs as PayPal** — no separate Venmo Nest routes |
| **Modes** | Full · Buttons · Headless (opt-in; not in defaults) |
| **Merchant** | PayPal account with **Venmo enabled** on the app |
| **Public** | `providers.venmo: {}` or `{ sandboxBuyerCountry: 'US' }` + PayPal `clientId` |
| **Server-only** | Same PayPal secrets as PayPal |
| **Backend** | `paypalCreateOrderUrl`, `paypalCaptureOrderUrl` |
| **Constraints** | **US buyers / USD**; `Buttons().isEligible()`; never set `sandboxBuyerCountry` in production |
| **Mock / sandbox / prod** | Mock without PayPal secrets. Sandbox: web login (desktop QR not sandbox-testable). Live: remove `sandboxBuyerCountry` |
| **Unavailable** | Hidden; `PROVIDER_MISCONFIGURED`. Button may also hide after mount if ineligible |
| **Guide** | [providers/venmo.md](./providers/venmo.md) · [PayPal Venmo integrate](https://developer.paypal.com/docs/checkout/pay-with-venmo/integrate/) |

---

## Klarna (`klarna`)

| | |
|--|--|
| **Provider** | Stripe Payment Element (`klarna`) |
| **Modes** | Full (opt-in) · Buttons (in default list) · Headless (`confirm()`) |
| **Merchant** | Stripe; enable Klarna in Dashboard; register Payment Method Domains |
| **Public** | `providers.klarna` (`purchaseCountry?`, `locale?`) + Stripe `publishableKey` |
| **Server-only** | Stripe secret (no Klarna API key in Angular) |
| **Backend** | `backend.klarnaCreatePaymentUrl` |
| **Constraints** | Currencies `USD\|EUR\|GBP\|CAD\|AUD\|SEK\|NOK\|DKK`; amount > 0. Buttons Direct BNPL may need billing address |
| **Mock / sandbox / prod** | Stripe Test Klarna; redirect return recovery |
| **Unavailable** | Hidden; `PROVIDER_MISCONFIGURED` |
| **Guide** | [providers/klarna.md](./providers/klarna.md) |

---

## Affirm (`affirm`)

| | |
|--|--|
| **Provider** | Stripe Payment Element (`affirm`) |
| **Modes** | Full (opt-in) · Buttons (in default list) · Headless |
| **Merchant** | Stripe; enable Affirm; Payment Method Domains |
| **Public** | `providers.affirm` + Stripe `publishableKey` |
| **Server-only** | Stripe secret |
| **Backend** | `backend.affirmCreatePaymentUrl` |
| **Constraints** | `USD\|CAD`; library enforces total ≥ **$35** (issuer eligibility may be stricter) |
| **Mock / sandbox / prod** | Stripe Test Affirm; redirect recovery |
| **Unavailable** | Hidden; `PROVIDER_MISCONFIGURED` |
| **Guide** | [providers/affirm.md](./providers/affirm.md) |

---

## US bank account / ACH (`us-bank-account`) — opt-in

| | |
|--|--|
| **Provider** | Stripe Payment Element (`us_bank_account`) |
| **Modes** | Full · Buttons · Headless — opt-in |
| **Merchant** | Stripe; enable ACH Direct Debit |
| **Public** | `providers.usBankAccount: {}` (+ optional `purchaseCountry`) + Stripe `publishableKey` |
| **Server-only** | Stripe secret + webhook secret (ACH often settles asynchronously) |
| **Backend** | `backend.createUsBankAccountPaymentUrl` (**separate** from card `createPaymentUrl`) |
| **Constraints** | **USD** only; amount > 0. Outcomes may be `processing` / pending — fulfill via webhooks |
| **Mock / sandbox / prod** | Mock can force processing. Microdeposit leave-page recovery has known gaps — see guide |
| **Unavailable** | Hidden; `PROVIDER_MISCONFIGURED` |
| **Guide** | [providers/us-bank-account.md](./providers/us-bank-account.md) |

---

## Cash App Pay (`cash-app-pay`) — opt-in

| | |
|--|--|
| **Provider** | Stripe Payment Element (`cashapp`) — **not** Express Checkout |
| **Modes** | Full · Buttons · Headless — opt-in |
| **Merchant** | Stripe; enable Cash App Pay (US) |
| **Public** | `providers.cashAppPay: {}` + Stripe `publishableKey` |
| **Server-only** | Stripe secret |
| **Backend** | `backend.cashAppPayCreatePaymentUrl` |
| **Constraints** | US business / US customers; **USD**; total ≥ **$0.50** ([Stripe Cash App Pay](https://docs.stripe.com/payments/cash-app-pay)) |
| **Mock / sandbox / prod** | Stripe Test Approve/Decline; redirect `ep_method=cash-app-pay` |
| **Unavailable** | Hidden; `PROVIDER_MISCONFIGURED` |
| **Guide** | [providers/cash-app-pay.md](./providers/cash-app-pay.md) |

---

## Afterpay / Clearpay (`afterpay`) — opt-in

| | |
|--|--|
| **Provider** | Stripe Payment Element (`afterpay_clearpay`) — **not** Zip |
| **Modes** | Full · Buttons · Headless — opt-in |
| **Merchant** | Stripe; enable Afterpay/Clearpay for your country |
| **Public** | `providers.afterpay: {}` + Stripe `publishableKey` |
| **Server-only** | Stripe secret |
| **Backend** | `backend.afterpayCreatePaymentUrl` |
| **Constraints** | Markets AU/CA/NZ/GB/US; currencies AUD/CAD/NZD/GBP/USD; amount limits (e.g. USD ~1–4000). UK brand shows as Clearpay in Stripe PE |
| **Mock / sandbox / prod** | Stripe Test Afterpay |
| **Unavailable** | Hidden; `PROVIDER_MISCONFIGURED` |
| **Guide** | [providers/afterpay.md](./providers/afterpay.md) · [Stripe Afterpay](https://docs.stripe.com/payments/afterpay-clearpay) |

---

## Zip US (`zip`) — opt-in

| | |
|--|--|
| **Provider** | **Zip US Gateway API** + JS SDK (`window.quadpay.apiCheckout`) — independent of Stripe/PayPal |
| **Modes** | Full · Buttons · Headless (`zip-checkout`; **no** `confirm()`) — opt-in, disabled by default |
| **Merchant** | Zip for Business account; sandbox + production credentials from Merchant Portal → Settings ([Introduction](https://docs.us.zip.co/docs/introduction)) |
| **Public** | `providers.zip: {}` + `zipCreateCheckoutUrl` + `zipVerifyReturnUrl` (optional `zipCaptureUrl` for deferred capture) |
| **Server-only** | `ZIP_MERCHANT_ID`, `ZIP_API_SECRET`, `ZIP_MODE`, `ZIP_CALLBACK_URL` — never in Angular |
| **Constraints** | **United States / USD**; total ≥ $0.01; sync `openCheckout` on user click after prefetch |
| **Mock / sandbox / prod** | Mock (`enableMockMode`) needs **no** Zip secrets. Demo server without `ZIP_*` returns `mock: true` — Real mode refuses that response. Sandbox CDN `cdn.sand.us.zip.co`; live needs Zip certification ([Go Live](https://developers.zip.co/v2/docs/go-live)) |
| **Unavailable** | Hidden when opt-in/URLs missing (same availability filter as other methods). If create fails due to missing merchant secrets, buyers see localized **“Zip is unavailable. Choose another payment method.”**; technical detail stays in `PaymentError.message` + `warnProviderDiagnostic` / diagnostics |
| **Guide** | [providers/zip.md](./providers/zip.md) · [API Implementation](https://docs.us.zip.co/docs/api-implementation) · [JS SDK](https://docs.us.zip.co/docs/api-javascript-sdk) |

```ts
provideEasyPayments({
  providers: { zip: {} },
  backend: {
    zipCreateCheckoutUrl: 'https://api.example.com/payments/zip/create',
    zipVerifyReturnUrl: 'https://api.example.com/payments/zip/verify',
  },
});
```

```bash
# server/.env — from Zip Merchant Portal → Settings
ZIP_MERCHANT_ID=...
ZIP_API_SECRET=...
ZIP_MODE=sandbox
ZIP_CALLBACK_URL=https://your-public-api.example/api/webhooks/zip
```

---

## Diagnosing unavailable methods

1. Confirm the method is listed in `[methods]` / Headless `methods`.
2. Confirm the matching `providers.*` object and backend URL(s).
3. Inspect `EasyPaymentsDiagnosticsService.snapshot()` / `method(id)` for fixed codes (`PROVIDER_MISCONFIGURED`, `PROVIDER_UNAVAILABLE`, `CONFIG_MISSING`, …).
4. In development, watch the console for `[Easy Payments] …` warnings (one per provider+code; secrets redacted).
5. After fixing config: `configService.replace(...)` → `orchestrator.reinitialize()` → `refreshAvailability(...)`.

Provider isolation: a misconfigured Stripe method does not disable PayPal or Zip, and vice versa.

---

## Official docs verification notes

| Provider docs used | Verified in this pass |
|--------------------|------------------------|
| Stripe Payment Method Domains, ECE, Cash App, Afterpay | Against Stripe docs links in provider guides |
| PayPal Venmo integrate / test | Against PayPal developer docs |
| Zip US Gateway, JS SDK, Postman (Merchant ID + API secret in Portal Settings), Introduction | Against [docs.us.zip.co](https://docs.us.zip.co/docs/introduction) |
| Zip production certification checklist | Against Zip Go Live docs; **live Zip Sandbox E2E still pending merchant credentials** in this workspace |
