# Easy Payments for Angular

Angular payments and checkout library for Stripe, PayPal, Apple Pay, Google Pay, Klarna, and Affirm.

`@easy-payments/angular` provides a unified Angular payment component for card payments, digital wallets, PayPal, Klarna, and Affirm with one consistent API — including built-in UI localization for English, Spanish, and Portuguese.

**[Official website](https://www.easy-payments.dev)** · [Documentation](https://www.easy-payments.dev/docs/angular/1.2.0/getting-started) · [Playground](https://www.easy-payments.dev/playground) · [Contact](https://www.easy-payments.dev/contact)

```bash
npm install @easy-payments/angular @stripe/stripe-js
```

![Version 1.2.1](https://img.shields.io/badge/version-1.2.1-0A7EA4)
![Angular 20.3+ · 21 · 22](https://img.shields.io/badge/Angular-≥20.3%20·%2021%20·%2022-DD0031)
![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)

| | |
|---|---|
| **Version** | 1.2.1 |
| **Framework** | Angular |
| **Compatibility** | Angular **20.3+**, **21**, **22** (`>=20.3.0 <23.0.0`) |
| **Workspace** | Built with Angular **22.1.5** |
| **Methods** | Card · PayPal · Apple Pay · Google Pay · Klarna · Affirm |
| **Locales** | `auto` · `en` · `es` · `pt` |

<p align="center">
  <img src="https://raw.githubusercontent.com/easy-payments-dev/easy-payments-angular/v1.0.0/docs/assets/easy-payments-desktop.png" alt="Easy Payments checkout — desktop viewport" width="640" />
</p>

<p align="center">
  <a href="https://github.com/easy-payments-dev/easy-payments-angular/blob/master/docs/getting-started.md">Getting Started</a> ·
  <a href="https://github.com/easy-payments-dev/easy-payments-angular/blob/master/docs/migration-1.1-to-1.2.md">1.1 → 1.2</a> ·
  <a href="https://github.com/easy-payments-dev/easy-payments-angular/blob/master/docs/headless.md">Headless</a> ·
  <a href="https://github.com/easy-payments-dev/easy-payments-angular/blob/master/docs/localization.md">Localization</a> ·
  <a href="https://github.com/easy-payments-dev/easy-payments-angular/blob/master/docs/providers/stripe.md">Provider Setup</a> ·
  <a href="https://github.com/easy-payments-dev/easy-payments-angular/blob/master/docs/api.md">API</a> ·
  <a href="https://github.com/easy-payments-dev/easy-payments-angular/blob/master/docs/payment-flow.md">Payment flow</a> ·
  <a href="https://github.com/easy-payments-dev/easy-payments-angular/blob/master/docs/configuration.md">Configuration</a> ·
  <a href="https://github.com/easy-payments-dev/easy-payments-angular/tree/master/projects/demo">Demo source</a> ·
  <a href="https://github.com/easy-payments-dev/easy-payments-angular/issues">Issues</a>
</p>

---

## Angular Compatibility

| Easy Payments | Angular |
|---------------|---------|
| **1.2.x** | `>=20.3.0 <23.0.0` |
| **1.1.x** | `>=20.3.0 <23.0.0` |
| **1.0.x** | `>=20.3.0 <23.0.0` |

- **Workspace / build:** Angular **22.1.5**
- **Consumer peers:** `>=20.3.0 <23.0.0`

v1.2.x keeps the same peer range. It does **not** support Angular 19, Angular 23+, or non-Angular frameworks. Packed consumer installs on Angular 20, 21, and 22 were verified for 1.0, 1.1, and **1.2.0** (mock-mode smoke; no live payments).

---

## Preview

Screenshots are **real captures** of the local demo using browser viewport emulation (not physical device claims).

<table>
  <tr>
    <td align="center" width="50%">
      <strong>Desktop</strong><br />
      <img src="https://raw.githubusercontent.com/easy-payments-dev/easy-payments-angular/v1.0.0/docs/assets/easy-payments-desktop.png" alt="Desktop viewport" width="420" />
    </td>
    <td align="center" width="50%">
      <strong>Mobile</strong><br />
      <img src="https://raw.githubusercontent.com/easy-payments-dev/easy-payments-angular/v1.0.0/docs/assets/easy-payments-mobile.png" alt="Mobile viewport" width="220" />
    </td>
  </tr>
  <tr>
    <td align="center">
      <strong>Tablet</strong><br />
      <img src="https://raw.githubusercontent.com/easy-payments-dev/easy-payments-angular/v1.0.0/docs/assets/easy-payments-tablet.png" alt="Tablet viewport" width="360" />
    </td>
    <td align="center">
      <strong>iPad viewport</strong><br />
      <img src="https://raw.githubusercontent.com/easy-payments-dev/easy-payments-angular/v1.0.0/docs/assets/easy-payments-ipad.png" alt="iPad viewport" width="360" />
    </td>
  </tr>
  <tr>
    <td align="center">
      <strong>Light</strong><br />
      <img src="https://raw.githubusercontent.com/easy-payments-dev/easy-payments-angular/v1.0.0/docs/assets/easy-payments-light.png" alt="Light theme" width="360" />
    </td>
    <td align="center">
      <strong>Dark</strong><br />
      <img src="https://raw.githubusercontent.com/easy-payments-dev/easy-payments-angular/v1.0.0/docs/assets/easy-payments-dark.png" alt="Dark theme" width="360" />
    </td>
  </tr>
  <tr>
    <td align="center">
      <strong>Default appearance</strong><br />
      <img src="https://raw.githubusercontent.com/easy-payments-dev/easy-payments-angular/v1.0.0/docs/assets/easy-payments-default.png" alt="Default appearance" width="360" />
    </td>
    <td align="center">
      <strong>Transparent appearance</strong><br />
      <img src="https://raw.githubusercontent.com/easy-payments-dev/easy-payments-angular/v1.0.0/docs/assets/easy-payments-transparent.png" alt="Transparent appearance" width="360" />
    </td>
  </tr>
  <tr>
    <td align="center">
      <strong>Success</strong><br />
      <img src="https://raw.githubusercontent.com/easy-payments-dev/easy-payments-angular/v1.0.0/docs/assets/easy-payments-success.png" alt="Success confirmation" width="360" />
    </td>
    <td align="center">
      <strong>Custom method order</strong><br />
      <img src="https://raw.githubusercontent.com/easy-payments-dev/easy-payments-angular/v1.0.0/docs/assets/easy-payments-method-order.png" alt="Custom payment method order" width="360" />
    </td>
  </tr>
</table>

<p align="center">
  <strong>Laptop</strong><br />
  <img src="https://raw.githubusercontent.com/easy-payments-dev/easy-payments-angular/v1.0.0/docs/assets/easy-payments-laptop.png" alt="Laptop viewport" width="480" />
</p>

> **npm note:** Screenshot `src` values use immutable absolute URLs on the `v1.0.0` tag (`raw.githubusercontent.com/.../v1.0.0/docs/assets/...`) so images render on npm after publish. See [docs/npm-readme-images.md](https://github.com/easy-payments-dev/easy-payments-angular/blob/master/docs/npm-readme-images.md).

---

## Payment Experience

Customers move through a consistent journey even when providers differ mid-flow:

**Checkout → Provider interaction → Processing → Success**

Alternate outcomes: **Processing → Error**, or **Provider flow → Cancelled**.

<table>
  <tr>
    <td align="center" width="50%">
      <strong>Processing</strong><br />
      <img src="https://raw.githubusercontent.com/easy-payments-dev/easy-payments-angular/v1.0.0/docs/assets/easy-payments-processing.png" alt="Processing payment" width="360" />
    </td>
    <td align="center" width="50%">
      <strong>Success</strong><br />
      <img src="https://raw.githubusercontent.com/easy-payments-dev/easy-payments-angular/v1.0.0/docs/assets/easy-payments-success.png" alt="Payment successful" width="360" />
    </td>
  </tr>
  <tr>
    <td align="center">
      <strong>Error</strong><br />
      <img src="https://raw.githubusercontent.com/easy-payments-dev/easy-payments-angular/v1.0.0/docs/assets/easy-payments-error.png" alt="Payment failed" width="360" />
    </td>
    <td align="center">
      <strong>Cancelled</strong><br />
      <img src="https://raw.githubusercontent.com/easy-payments-dev/easy-payments-angular/v1.0.0/docs/assets/easy-payments-cancelled.png" alt="Payment cancelled" width="360" />
    </td>
  </tr>
</table>

Full states (redirects, `successBehavior`, events): **[docs/payment-flow.md](https://github.com/easy-payments-dev/easy-payments-angular/blob/master/docs/payment-flow.md)**

---

## What Easy Payments is / is not

**Is:** Angular payment integration library · unified checkout UI · provider abstraction · normalized events/errors · built-in UI localization  

**Is not:** a payment processor · bank · merchant of record · Stripe/PayPal replacement · trusted pricing backend · a currency converter · Samsung Pay

Money settles to **your** Stripe / PayPal (and related) merchant accounts.

---

## Installation

```bash
npm install @easy-payments/angular @stripe/stripe-js
```

> Package name: **`@easy-payments/angular`**.

Peers:

- `@angular/core` / `@angular/common` `>=20.3.0 <23.0.0`
- `@stripe/stripe-js` `^8.0.0`

---

## Angular Quick Start

Standalone Angular only (`ApplicationConfig` + component `imports`). No NgModules.

### 1. Install

```bash
npm install @easy-payments/angular @stripe/stripe-js
```

### 2. `app.config.ts` — provide Easy Payments

```ts
// Angular application-level configuration type.
import { ApplicationConfig } from '@angular/core';

// Registers Angular HttpClient.
// Easy Payments uses HTTP to communicate with the merchant backend.
import { provideHttpClient } from '@angular/common/http';

// Main Easy Payments provider.
// This configures payment providers and backend endpoints globally.
import { provideEasyPayments } from '@easy-payments/angular';

// Angular application configuration.
export const appConfig: ApplicationConfig = {
  providers: [
    // Makes Angular HttpClient available to Easy Payments and the application.
    provideHttpClient(),

    // Configures Easy Payments globally.
    provideEasyPayments({
      providers: {
        // Stripe browser configuration.
        // Use your Stripe PUBLISHABLE key here (pk_test_... or pk_live_...).
        // Never put a Stripe secret key (sk_...) in Angular/browser code.
        stripe: {
          publishableKey: 'pk_test_...',
        },

        // PayPal browser configuration.
        // The Client ID is obtained from the PayPal Developer Dashboard.
        // The PayPal Client Secret must remain on your backend.
        paypal: {
          clientId: 'YOUR_PAYPAL_CLIENT_ID',

          // Currency used by the PayPal checkout.
          currency: 'USD',

          // 'capture' means the PayPal order is captured after approval.
          // 'authorize' is also supported by the config type when you need authorize-only.
          intent: 'capture',
        },

        // Apple Pay is handled through the existing Stripe Express Checkout Element integration.
        // applePay: {} does NOT mean "Apple Pay needs no setup."
        // It means: enable Apple Pay in Easy Payments; there are currently no additional
        // Apple Pay-specific frontend credentials required here (no Apple Merchant ID /
        // certificates in Angular). It still uses stripe.publishableKey + createPaymentUrl.
        // HTTPS, a compatible Apple Pay device/Wallet, and Stripe Payment Method Domain
        // registration are still required. See docs/providers/apple-pay.md.
        applePay: {},

        // Google Pay configuration (official Google Pay Web button + Stripe confirm).
        // TEST is for development/testing.
        // PRODUCTION requires additional Google Pay merchant setup (e.g. merchantId).
        googlePay: {
          environment: 'TEST',
        },

        // Klarna is integrated through Stripe (not a separate Klarna SDK in Angular).
        // purchaseCountry helps determine purchase context / eligibility.
        klarna: {
          purchaseCountry: 'US',
        },

        // Affirm is integrated through Stripe (not a separate Affirm SDK in Angular).
        // purchaseCountry is used for Affirm eligibility/configuration.
        affirm: {
          purchaseCountry: 'US',
        },
      },

      // Backend endpoints owned by YOUR application/server.
      // Easy Payments calls these endpoints from the frontend.
      // Secret provider credentials remain on the server.
      // Optional baseUrl prefixes relative paths only. Omit it to use the URLs below as written.
      // Local NestJS: baseUrl: 'http://localhost:3000'
      // Production:   baseUrl: 'https://api.example.com'
      backend: {
        // baseUrl: 'https://api.example.com',
        // Creates the Stripe PaymentIntent used by card / Apple Pay / Google Pay flows.
        createPaymentUrl: '/api/payments/create',

        // Creates a PayPal order on the merchant backend.
        paypalCreateOrderUrl: '/api/payments/paypal/create',

        // Captures an approved PayPal order on the merchant backend.
        paypalCaptureOrderUrl: '/api/payments/paypal/capture',

        // Creates the Klarna-only Stripe PaymentIntent on the merchant backend.
        klarnaCreatePaymentUrl: '/api/payments/klarna/create',

        // Creates the Affirm-only Stripe PaymentIntent on the merchant backend.
        affirmCreatePaymentUrl: '/api/payments/affirm/create',
      },

      // Optional demo/development mode.
      // Uncomment only when intentionally testing without real provider transactions.
      // Never enable mock mode in production.
      // enableMockMode: true,
    }),
  ],
};
```

`EasyPaymentsConfig` shape:

| Field | Notes |
|-------|--------|
| `providers.stripe?` | `{ publishableKey }` — publishable key only |
| `providers.paypal?` | `{ clientId, currency?, intent? }` — Client ID only in Angular |
| `providers.applePay?` | `{}` enables Apple Pay via **existing Stripe** config; optional `merchantName` / `countryCode`. Not “zero setup” — HTTPS, Wallet, and Stripe Payment Method Domains still required |
| `providers.googlePay?` | `{ merchantId?, merchantName?, environment?, countryCode? }` |
| `providers.klarna?` | `{ purchaseCountry?, locale? }` — Stripe-backed |
| `providers.affirm?` | `{ purchaseCountry?, locale? }` — Stripe-backed |
| `backend?` | Optional `baseUrl` plus `createPaymentUrl?`, `paypalCreateOrderUrl?`, `paypalCaptureOrderUrl?`, `klarnaCreatePaymentUrl?`, `affirmCreatePaymentUrl?` |
| `enableMockMode?` | When `true`, all providers use mocks (never in production) |

Never put Stripe secret keys or PayPal Client Secrets in Angular.

`backend.baseUrl` is optional. When it is omitted, each endpoint is requested exactly as you wrote it. When it is set, relative paths are joined to that origin:

```ts
backend: {
  baseUrl: 'https://api.example.com',
  createPaymentUrl: '/api/payments/create',
}
```

A trailing slash on `baseUrl` does not matter. `https://api.example.com/v1` plus `/payments/create` stays under `/v1`. An absolute `https://...` endpoint is not prefixed. For a local Angular proxy, omit `baseUrl` and use `/api/...`. For the demo NestJS server, use `baseUrl: 'http://localhost:3000'` with those relative paths, and allow the Angular origin in CORS. Production APIs should be HTTPS. `javascript:`, `data:`, and `//host/...` URLs are rejected without taking down unrelated providers.

### 3. `app.component.ts` — product + handlers

```ts
import { Component } from '@angular/core';
import {
  EasyPaymentsComponent,
  PaymentError,
  PaymentMethod,
  PaymentProduct,
  PaymentResult,
} from '@easy-payments/angular';

@Component({
  selector: 'app-root',
  imports: [EasyPaymentsComponent],
  templateUrl: './app.component.html',
})
export class AppComponent {
  readonly product: PaymentProduct = {
    id: 'premium-plan',
    name: 'Premium Plan',
    description: 'One year subscription',
    amount: 99, // major units: 99 = $99.00 USD (not cents)
    currency: 'USD',
    quantity: 1,
  };

  readonly methods: PaymentMethod[] = [
    'card',
    'paypal',
    'apple-pay',
    'google-pay',
    'klarna',
    'affirm',
  ];

  onSuccess(result: PaymentResult): void {
    console.log('paid', result);
  }

  onCancel(result: PaymentResult): void {
    console.log('cancelled', result);
  }

  onError(error: PaymentError): void {
    console.error(error.code, error.message);
  }

  onContinue(result: PaymentResult): void {
    console.log('continue after confirmation', result);
  }
}
```

`PaymentProduct`: `id`, `name`, `amount`, `currency` required; optional `quantity`, `description`, `imageUrl`, `metadata`.

`metadata` is an optional flat string map (`orderId`, `customerReference`, and similar). At most 10 entries, keys up to 40 characters, values up to 500 characters. It does not change the charged amount. PayPal receives only `orderId` as `custom_id`. Card, Apple Pay, Google Pay, Klarna, and Affirm store the validated map on the Stripe PaymentIntent. Do not put secrets or personal data in metadata. See [docs/api.md](https://github.com/easy-payments-dev/easy-payments-angular/blob/master/docs/api.md#merchant-metadata).

**Amount is major currency units** (dollars, not cents). Example: `amount: 99` with `currency: 'USD'` means **$99.00**.

### 4. `app.component.html` — render `<easy-payments>`

```html
<easy-payments
  [product]="product"
  [methods]="methods"
  theme="system"
  appearance="default"
  [maxWidth]="640"
  locale="auto"
  (success)="onSuccess($event)"
  (cancel)="onCancel($event)"
  (error)="onError($event)"
  (successContinue)="onContinue($event)"
/>
```

Outputs are **`success`**, **`cancel`**, **`error`**, and **`successContinue`**. There is no `cancelled` output — use `(cancel)`.

The `methods` array is both the allow-list and the visual order. No separate `order` input.

### Localization

```html
<easy-payments
  [product]="product"
  locale="es"
  (success)="onSuccess($event)"
  (cancel)="onCancel($event)"
  (error)="onError($event)"
/>
```

| `locale` | Behavior |
|----------|----------|
| `auto` (default) | Detects from the browser (`es-*` → Spanish, `pt-*` → Portuguese, `en-*` → English; other → English) |
| `en` | English |
| `es` | Spanish |
| `pt` | Portuguese |

Full guide: **[docs/localization.md](https://github.com/easy-payments-dev/easy-payments-angular/blob/master/docs/localization.md)**

### Custom translations

Pass partial overrides with `[translations]`. Missing keys fall back to the effective locale, then English:

```ts
readonly translations = {
  successTitle: 'You are all set!',
  successContinue: 'Back to shop',
};
```

```html
<easy-payments
  [product]="product"
  locale="en"
  [translations]="translations"
  (success)="onSuccess($event)"
  (cancel)="onCancel($event)"
  (error)="onError($event)"
/>
```

### Currency formatting

Locale changes **how** amounts are displayed (`Intl` number/currency formatting). It does **not** convert currencies. `product.amount` and `product.currency` stay as you provide them.

### Troubleshooting

| Symptom | Fix |
|---------|-----|
| `'easy-payments' is not a known element` | Import `EasyPaymentsComponent` in the host component's `imports` array (standalone). Ensure `provideEasyPayments(...)` is in `app.config.ts`. |
| No payment methods appear | Configure the matching `providers` + backend URLs, and include those methods in `[methods]`. |
| Stripe / wallets fail in production | Use live publishable keys server-side secrets, HTTPS, and Stripe Payment Method Domains for wallets. |
| Wrong language | Set `locale` explicitly (`en` / `es` / `pt`) instead of `auto`, or check the browser language list. |
| Amount looks like cents | Amounts are **major units** (`99` = $99.00), not Stripe-style cents. |

Full walkthrough: **[docs/getting-started.md](https://github.com/easy-payments-dev/easy-payments-angular/blob/master/docs/getting-started.md)**

**View complete example:** [`projects/demo`](https://github.com/easy-payments-dev/easy-payments-angular/tree/master/projects/demo) · **Library source:** [`projects/easy-payments`](https://github.com/easy-payments-dev/easy-payments-angular/tree/master/projects/easy-payments) · **Reference backend:** [`server`](https://github.com/easy-payments-dev/easy-payments-angular/tree/master/server)

---

## Provider Setup

Configure each provider with the matching guide. Start with Stripe if you use card / wallets / Klarna / Affirm.

| Provider | Guide | SAFE FOR FRONTEND | SERVER ONLY |
|----------|-------|-------------------|-------------|
| Stripe | [docs/providers/stripe.md](https://github.com/easy-payments-dev/easy-payments-angular/blob/master/docs/providers/stripe.md) | `pk_test_` / `pk_live_` | `sk_*` |
| Apple Pay | [docs/providers/apple-pay.md](https://github.com/easy-payments-dev/easy-payments-angular/blob/master/docs/providers/apple-pay.md) | Stripe publishable key | Stripe secret |
| Google Pay | [docs/providers/google-pay.md](https://github.com/easy-payments-dev/easy-payments-angular/blob/master/docs/providers/google-pay.md) | Stripe publishable key, Google merchant display fields | Stripe secret, production Google merchant secrets as required |
| Klarna | [docs/providers/klarna.md](https://github.com/easy-payments-dev/easy-payments-angular/blob/master/docs/providers/klarna.md) | Stripe publishable key | Stripe secret |
| Affirm | [docs/providers/affirm.md](https://github.com/easy-payments-dev/easy-payments-angular/blob/master/docs/providers/affirm.md) | Stripe publishable key | Stripe secret |
| PayPal | [docs/providers/paypal.md](https://github.com/easy-payments-dev/easy-payments-angular/blob/master/docs/providers/paypal.md) | PayPal Client ID | PayPal Client Secret |

**Payment Method Domains:** register the checkout **hostname** (not a URL path) in Stripe so Apple Pay and related methods can appear. Temporary HTTPS tunnels need their public frontend hostname registered — and re-registered when the tunnel name changes. Details: [Stripe PMD docs](https://docs.stripe.com/payments/payment-methods/pmd-registration) and [docs/providers/stripe.md](https://github.com/easy-payments-dev/easy-payments-angular/blob/master/docs/providers/stripe.md).

Localization behavior and hard limits (wallet sheets, Klarna/Affirm hosted pages): **[docs/localization.md](https://github.com/easy-payments-dev/easy-payments-angular/blob/master/docs/localization.md)**.

---

## Component API (summary)

| Input | Type | Default | Notes |
|-------|------|---------|-------|
| `product` | `PaymentProduct` | — | **Required** (`id`, `name`, `amount`, `currency`; amount in major units) |
| `methods` | `PaymentMethod[]` | `['apple-pay','google-pay','paypal','card']` | Allow-list + order |
| `checkout` | `CheckoutOptions` | — | Optional URLs / successBehavior / customer |
| `theme` | `'light' \| 'dark' \| 'system'` | `'system'` | System follows OS and updates live |
| `appearance` | `'default' \| 'transparent'` | `'default'` | Independent of theme |
| `maxWidth` | `number \| string \| null` | `640` | Clamped **320–1200** |
| `successBehavior` | `'confirmation' \| 'event-only'` | `'confirmation'` | Overridable via `checkout` |
| `locale` | `'auto' \| 'en' \| 'es' \| 'pt'` | `'auto'` | UI locale |
| `translations` | `Partial<EasyPaymentsTranslations>` | `{}` | Partial string overrides |

| Output | Payload |
|--------|---------|
| `success` | `PaymentResult` |
| `cancel` | `PaymentResult` |
| `error` | `PaymentError` |
| `successContinue` | `PaymentResult` |

Complete reference: **[docs/api.md](https://github.com/easy-payments-dev/easy-payments-angular/blob/master/docs/api.md)** · Localization: **[docs/localization.md](https://github.com/easy-payments-dev/easy-payments-angular/blob/master/docs/localization.md)** · Recipes: **[docs/configuration.md](https://github.com/easy-payments-dev/easy-payments-angular/blob/master/docs/configuration.md)**

---

## Diagnostics

Inject `EasyPaymentsDiagnosticsService` to read provider readiness. The checkout component already refreshes availability; this service projects that result.

```ts
import { Component, inject } from '@angular/core';
import { EasyPaymentsDiagnosticsService } from '@easy-payments/angular';

@Component({ /* ... */ })
export class CheckoutStatusComponent {
  private readonly diagnosticsService = inject(EasyPaymentsDiagnosticsService);
  readonly diagnostics = this.diagnosticsService.diagnostics;

  logCard(): void {
    const snapshot = this.diagnosticsService.snapshot();
    const card = this.diagnosticsService.method('card');
    if (card?.readiness === 'unavailable' || card?.readiness === 'misconfigured') {
      console.info(card.code, card.message);
    }
    console.info(snapshot.published, snapshot.methods);
  }
}
```

`diagnostics` is a signal. `snapshot()` returns a frozen `EasyPaymentsDiagnosticsSnapshot`. `method()` returns one `PaymentMethodDiagnostic`.

| `readiness` | Meaning |
|-------------|---------|
| `loading` | Still checking. Not ready. |
| `ready` | Availability passed. |
| `unavailable` | Not usable in this environment. |
| `misconfigured` | Configuration or initialization failed for that method. |

`published` is `false` until the first `refreshAvailability()`, and again after `reinitialize()` until the next refresh. An empty list in that state is not a ready checkout. `code` is a stable `EasyPaymentsDiagnosticCode` from `EASY_PAYMENTS_DIAGNOSTIC_CODES` and is omitted when the method is ready. `message` is fixed developer text.

A misconfigured Stripe method does not mark a configured PayPal method unavailable, and the reverse is also true. Invalid backend URLs stay off the snapshot; the affected method uses `PROVIDER_MISCONFIGURED`. `BACKEND_BASE_URL_INVALID` and `BACKEND_ENDPOINT_INVALID` are development-console codes.

Snapshots omit secret keys, client secrets, PaymentIntent secrets, authorization headers, tokens, and raw provider errors. The service does not read `window`, `document`, `navigator`, or `localStorage`. Apple Pay and Google Pay are not `ready` during server rendering.

Calling `EasyPaymentsConfigService.replace()` does not refresh diagnostics by itself. Call `PaymentOrchestratorService.reinitialize()`, then let `<easy-payments>` refresh or call `refreshAvailability()` yourself.

Full reference: **[docs/api.md](https://github.com/easy-payments-dev/easy-payments-angular/blob/master/docs/api.md#diagnostics)**.

---

## Payment events

`<easy-payments>` keeps `success`, `cancel`, `error`, and `successContinue`. Two outputs are added:

| Output | Payload | When |
|--------|---------|------|
| `started` | `PaymentStartedEvent` | A payment attempt begins. Not fired by selecting a tile. |
| `methodChange` | `PaymentMethodChangeEvent` | The selected method changes. |

```html
<easy-payments
  [product]="product"
  [methods]="methods"
  (started)="onStarted($event)"
  (success)="onSuccess($event)"
  (cancel)="onCancel($event)"
  (error)="onError($event)"
  (methodChange)="onMethodChange($event)"
/>
```

`PaymentStartedEvent` is `{ method, provider, amount, currency }`. Amount and currency are the checkout product input. `PaymentMethodChangeEvent` is `{ method, previousMethod, provider }`. `method` is null when no method remains selected.

PayPal `success` is emitted after capture. Apple Pay `started` is emitted on wallet confirm. Klarna and Affirm do not emit `started` again when the browser returns from a redirect. A repeated click or duplicate callback does not emit a second `started` for the same attempt. Configuration failures use `error` and do not emit `cancel`.

These events omit client secrets, secret keys, tokens, and raw provider responses. Log `PaymentError.code` rather than `message`. Diagnostics readiness is a separate API.

Full reference: **[docs/api.md](https://github.com/easy-payments-dev/easy-payments-angular/blob/master/docs/api.md#outputs)**.

---

## Responsive Design

Checkout is fluid up to `[maxWidth]`. The payment method grid reflows from the **component container width** (works in sidebars, modals, and embeds — not viewport-only). See Preview screenshots above.

---

## Provider credentials

| Provider | Frontend | Backend | Notes |
|----------|----------|---------|-------|
| **Stripe** | `pk_test_` / `pk_live_` | `sk_test_` / `sk_live_` | Card + wallets + Klarna + Affirm |
| **PayPal** | Client ID | Client Secret | Create + capture URLs |
| **Apple Pay** | `applePay: {}` + Stripe publishable key | Stripe secret via create URL | Opt-in via Easy Payments; uses Stripe ECE. Empty `{}` = no extra Apple Pay frontend credentials — HTTPS / Wallet / Payment Method Domains still required |
| **Google Pay** | `googlePay` + Stripe | Stripe secret via create URL | `TEST` / `PRODUCTION` |
| **Klarna** | `klarna` + Stripe | Stripe + `klarnaCreatePaymentUrl` | Redirect + return recovery |
| **Affirm** | `affirm` + Stripe | Stripe + `affirmCreatePaymentUrl` | ~$35 min in library; eligibility varies |

Details: [docs/providers/](https://github.com/easy-payments-dev/easy-payments-angular/tree/master/docs/providers/) · Security: [docs/security.md](https://github.com/easy-payments-dev/easy-payments-angular/blob/master/docs/security.md)

> **Never** put Stripe secret keys or PayPal Client Secrets in Angular.

---

## Backend

A backend is required for secrets, trusted pricing, and captures.

Any language works (NestJS, Express, .NET, Java, PHP, Python, Go, …) if it implements the [HTTP contract](https://github.com/easy-payments-dev/easy-payments-angular/blob/master/docs/backend.md).

This repo’s [`server/`](https://github.com/easy-payments-dev/easy-payments-angular/tree/master/server) NestJS app is a **reference example**, not a production mandate.

---

## Explore the Project

| Area | Path |
|------|------|
| Library | [`projects/easy-payments`](https://github.com/easy-payments-dev/easy-payments-angular/tree/master/projects/easy-payments) |
| Angular demo | [`projects/demo`](https://github.com/easy-payments-dev/easy-payments-angular/tree/master/projects/demo) |
| Reference backend | [`server`](https://github.com/easy-payments-dev/easy-payments-angular/tree/master/server) |
| Documentation | [`docs`](https://github.com/easy-payments-dev/easy-payments-angular/tree/master/docs) |
| Issues | [GitHub Issues](https://github.com/easy-payments-dev/easy-payments-angular/issues) |

---

## Run the demo locally

This section is for the **library demo app** in this repository (`projects/demo` + NestJS `server/`). The public website Playground uses **mock payments** and is separate.

### Angular demo

From the repository root:

```bash
npm install
npm run build:lib
npm start
```

Demo: http://localhost:4200

(`npm start` runs `ng serve demo`.)

### NestJS demo backend

```bash
cd server
npm install
# copy .env.example → .env (TEST / Sandbox secrets only)
npm run start:dev
```

Backend: http://localhost:3001

From the repository root you can also use `npm run server:install` and `npm run server:start` (same Nest install / `start:dev` flow).

### Real / Test Providers

1. Start **both** the NestJS backend and the Angular demo.
2. Open http://localhost:4200
3. Select **Real / Test Providers**

If switching modes fails:

1. Confirm http://localhost:3001/api/catalog/products returns JSON.
2. Confirm the browser’s **exact origin** is allowed by the backend `FRONTEND_ORIGIN` CORS setting (default includes `http://localhost:4200` and `http://127.0.0.1:4200`).
3. If the Angular demo runs on another port, add that origin to `FRONTEND_ORIGIN` and restart NestJS.

More: [docs/demo.md](https://github.com/easy-payments-dev/easy-payments-angular/blob/master/docs/demo.md)

---

## Testing Payments

- Stripe **Test** mode + test cards  
- PayPal **Sandbox**  
- Google Pay `environment: 'TEST'`  
- Demo Mode in the playground (mocks — no real charges)  

Do not use live credentials for basic integration testing.

---

## Going to Production

- Live publishable / secret credentials (backend secrets stay server-side)  
- Trusted server pricing  
- HTTPS  
- Stripe Payment Method Domains (wallets)  
- PayPal Live + Google Pay PRODUCTION merchant ID when applicable  
- Klarna / Affirm eligibility and approvals
- Webhooks / reconciliation before fulfillment
- Auth, rate limits, logging, CSP review  

v1.2.0 adds Full Checkout, Buttons Only, and Headless. `[bnplConfirmMode]` defaults to `element`. Klarna and Affirm Direct are Buttons Only opt-in. Merchant `requestPayment` starts card, Klarna, and Affirm only. PayPal, Google Pay, and Apple Pay stay on their official SDK buttons. Samsung Pay is not supported.

Stripe `checkout.successUrl` must be a same-origin `http:` or `https:` URL, or a relative path resolved against the current page. Other schemes and cross-origin URLs fail with `CONFIG_INVALID` before confirmation.

A browser `success` event is not fulfillment. The NestJS app in `server/` is a local demo, not a production backend. Its webhook status store is process-local and lost on restart. Your backend owns durable idempotency, capture, and fulfillment. Stripe TEST Klarna and Affirm payments, and locally signed webhook simulations, are not live production verification.

---

## FAQ

**What Angular versions are supported?** 20.3+, 21, and 22 (`>=20.3.0 <23.0.0`).  

**Is Easy Payments a payment processor?** No — it integrates your Stripe/PayPal accounts.  

**Where does the money go?** To your merchant accounts with those providers.  

**Do I need Stripe / PayPal?** Only for the methods you enable.  

**Do I need a backend?** Yes for real payments.  

**Can I use my own backend language?** Yes — implement the contract.  

**Can I choose method order?** Yes — `methods` array order. No separate `order` property.  

**How do I localize the UI?** `[locale]` (`auto` / `en` / `es` / `pt`) and optional `[translations]`. See [localization](https://github.com/easy-payments-dev/easy-payments-angular/blob/master/docs/localization.md).

**Does locale convert currency?** No — display formatting only.  

**Dark / light / system / transparent / width?** Yes — see [configuration](https://github.com/easy-payments-dev/easy-payments-angular/blob/master/docs/configuration.md).

**Does Apple Pay / Google Pay always appear?** No — capability and configuration dependent.  

**How do I report a bug or suggest a feature?** [GitHub Issues](https://github.com/easy-payments-dev/easy-payments-angular/issues).

**Can I inspect the source / demo / backend?** Yes — links above.  

**How can I support the project?** Optional contributions via [PayPal](https://paypal.me/JoseVicente07) — not required to use the library.

---

## Community & Feedback

Prefer **[GitHub Issues](https://github.com/easy-payments-dev/easy-payments-angular/issues)** for bugs, features, provider ideas, docs, compatibility, and a11y/UX suggestions.

Project contact (general / private): **jantvb@gmail.com**

Contributing guide: [CONTRIBUTING.md](https://github.com/easy-payments-dev/easy-payments-angular/blob/master/CONTRIBUTING.md)

---

## Support Easy Payments

Easy Payments is open source and free to use.

If Easy Payments saves you development time or helps your project, you can support its continued development with an optional contribution.

[Support Easy Payments via PayPal](https://paypal.me/JoseVicente07)

This is an optional way to support the open-source project. It is **not** a license fee, subscription, or related to merchant payments processed through Easy Payments.

---

## Changelog

See [CHANGELOG.md](https://unpkg.com/@easy-payments/angular@1.2.1/CHANGELOG.md) for **1.2.1**. 1.2.0, 1.1.0, and 1.0.0 remain in that file. The same file is included in the published package. This absolute link is what opens from npm; it does not depend on a GitHub organization URL.

---

## License

MIT © 2026 Jose Vicente — see [LICENSE](https://github.com/easy-payments-dev/easy-payments-angular/blob/master/LICENSE).
