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
| **Methods** | Card · PayPal · Venmo · Apple Pay · Google Pay · Klarna · Affirm · ACH · Cash App Pay · Afterpay · Zip |
| **Locales** | `auto` · `en` · `es` · `pt` |

<p align="center">
  <img src="https://raw.githubusercontent.com/easy-payments-dev/easy-payments-angular/v1.0.0/docs/assets/easy-payments-desktop.png" alt="Easy Payments checkout — desktop viewport" width="640" />
</p>

<p align="center">
  <a href="docs/getting-started.md">Getting Started</a> ·
  <a href="docs/migration-1.1-to-1.2.md">1.1 → 1.2</a> ·
  <a href="docs/headless.md">Headless</a> ·
  <a href="docs/localization.md">Localization</a> ·
  <a href="docs/api.md">API</a> ·
  <a href="docs/payment-flow.md">Payment flow</a> ·
  <a href="docs/configuration.md">Configuration</a> ·
  <a href="#payment-method-requirements">Method requirements</a> ·
  <a href="#visual-customization">Visual style</a> ·
  <a href="#provider-isolation--diagnostics">Diagnostics</a> ·
  <a href="projects/demo">Demo source</a> ·
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

> **npm note:** Screenshot `src` values use immutable absolute URLs on the `v1.0.0` tag (`raw.githubusercontent.com/.../v1.0.0/docs/assets/...`) so images render on npm after publish. See [docs/npm-readme-images.md](docs/npm-readme-images.md).

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

Full states (redirects, `successBehavior`, events): **[docs/payment-flow.md](docs/payment-flow.md)**

---

## What Easy Payments is / is not

**Is:** Angular payment integration library · unified checkout UI · per-method provider abstraction · normalized payment events/errors · developer readiness diagnostics · built-in UI localization (`en` / `es` / `pt`) · Easy Payments–owned visual customization (`theme`, `appearance`, `[visualStyle]`)

**Is not:** a payment processor · bank · merchant of record · Stripe/PayPal replacement · trusted pricing backend · a currency converter · Samsung Pay · ACH or other unfinished roadmap methods

Headless Checkout (`EasyPaymentsHeadless`) is an **additional** integration mode alongside Full Checkout and Buttons Only — see [docs/headless.md](docs/headless.md).

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
      // Local NestJS: baseUrl: 'http://localhost:3001'
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

A trailing slash on `baseUrl` does not matter. `https://api.example.com/v1` plus `/payments/create` stays under `/v1`. An absolute `https://...` endpoint is not prefixed. For a local Angular proxy, omit `baseUrl` and use `/api/...`. For the demo NestJS server, use `baseUrl: 'http://localhost:3001'` with those relative paths, and allow the Angular origin in CORS. Production APIs should be HTTPS. `javascript:`, `data:`, and `//host/...` URLs are rejected without taking down unrelated providers.

### 3. `app.component.ts` — product + handlers

```ts
import { Component } from '@angular/core';
import {
  EasyPaymentsComponent,
  PaymentError,
  type PaymentMethod,
  type PaymentMethodChangeEvent,
  type PaymentProduct,
  type PaymentResult,
  type PaymentStartedEvent,
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
    // Optional merchant reference data (not secrets / PII). See docs/api.md#merchant-metadata
    metadata: {
      orderId: 'ORDER-12345',
      customerReference: 'CUSTOMER-789',
    },
  };

  readonly methods: PaymentMethod[] = [
    'card',
    'paypal',
    'apple-pay',
    'google-pay',
    'klarna',
    'affirm',
  ];

  onStarted(event: PaymentStartedEvent): void {
    console.log('started', event.method, event.provider);
  }

  onMethodChange(event: PaymentMethodChangeEvent): void {
    console.log('methodChange', event.previousMethod, '→', event.method);
  }

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

`metadata` is an optional flat string map (`orderId`, `customerReference`, and similar). At most 10 entries, keys up to 40 characters, values up to 500 characters. It does not change the charged amount. PayPal receives only `orderId` as `custom_id`. Card, Apple Pay, Google Pay, Klarna, and Affirm store the validated map on the Stripe PaymentIntent. Do not put secrets or personal data in metadata. See [docs/api.md](docs/api.md#merchant-metadata).

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
  (started)="onStarted($event)"
  (methodChange)="onMethodChange($event)"
  (success)="onSuccess($event)"
  (cancel)="onCancel($event)"
  (error)="onError($event)"
  (successContinue)="onContinue($event)"
/>
```

Lifecycle outputs: **`started`**, **`methodChange`**, **`success`**, **`cancel`**, **`error`**, **`successContinue`**. There is no `cancelled` output — use `(cancel)`.

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

Full guide: **[docs/localization.md](docs/localization.md)**

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
| No payment methods appear | Configure the matching `providers` + backend URLs, and include those methods in `[methods]`. Inspect `EasyPaymentsDiagnosticsService` readiness. |
| Only some methods missing | Expected under provider isolation — fix that provider’s config, then `reinitialize()` + refresh availability. |
| Stripe / wallets fail in production | Use live publishable keys, server-side secrets, HTTPS, and Stripe Payment Method Domains for wallets. |
| Wrong language | Set `locale` explicitly (`en` / `es` / `pt`) instead of `auto`, or check the browser language list. |
| Amount looks like cents | Amounts are **major units** (`99` = $99.00), not Stripe-style cents. |
| `visualStyle` did not change Stripe/PayPal UI | Expected — provider SDK chrome is out of scope. |

Full walkthrough: **[docs/getting-started.md](docs/getting-started.md)**

**View complete example:** [`projects/demo`](projects/demo) · **Library source:** [`projects/easy-payments`](projects/easy-payments) · **Reference backend:** [`server`](server)

---

## Component API (summary)

| Input | Type | Default | Notes |
|-------|------|---------|-------|
| `product` | `PaymentProduct` | — | **Required** (`id`, `name`, `amount`, `currency`; amount in major units; optional `metadata`) |
| `methods` | `PaymentMethod[]` | `['apple-pay','google-pay','paypal','card']` | Allow-list + order |
| `checkout` | `CheckoutOptions` | — | Optional URLs / successBehavior / customer |
| `theme` | `'light' \| 'dark' \| 'system'` | `'system'` | System follows OS and updates live |
| `appearance` | `'default' \| 'transparent'` | `'default'` | Independent of theme |
| `visualStyle` | `EasyPaymentsVisualStyle \| null` | `null` | Optional EP-owned font/color/token overrides |
| `cardButtonAppearance` | `EasyPaymentsCardButtonAppearance \| null` | `null` | Optional Stripe Card CTA label + styles (EP-owned button only) |
| `selectorLabels` | `EasyPaymentButtonsSelectorLabels \| null` | `null` | Optional Card / US bank account (and other library) selector label overrides |
| `maxWidth` | `number \| string \| null` | `640` | Clamped **320–1200** |
| `successBehavior` | `'confirmation' \| 'event-only'` | `'confirmation'` | Overridable via `checkout` |
| `locale` | `'auto' \| 'en' \| 'es' \| 'pt'` | `'auto'` | UI locale |
| `translations` | `Partial<EasyPaymentsTranslations>` | `{}` | Partial string overrides |

| Output | Payload |
|--------|---------|
| `started` | `PaymentStartedEvent` |
| `methodChange` | `PaymentMethodChangeEvent` |
| `success` | `PaymentResult` |
| `cancel` | `PaymentResult` |
| `error` | `PaymentError` |
| `successContinue` | `PaymentResult` |

Complete reference: **[docs/api.md](docs/api.md)** · Localization: **[docs/localization.md](docs/localization.md)** · Recipes: **[docs/configuration.md](docs/configuration.md)**

---

## Provider isolation & diagnostics

Availability is evaluated **per payment method**. A failure for one provider does not automatically disable unrelated methods.

### Verified example: bad Stripe, good PayPal

With a secret key (or otherwise invalid Stripe setup) and a valid PayPal Client ID + create/capture URLs:

| Method | Typical readiness | Notes |
|--------|-------------------|--------|
| `card` | `misconfigured` | Stripe-owned |
| `apple-pay` / `google-pay` / `klarna` / `affirm` | not `ready` | Stripe-dependent (`STRIPE_INITIALIZATION_FAILED` when Stripe init fails) |
| `paypal` | `ready` | Independent of Stripe |

The reverse is also true: a misconfigured PayPal method does not mark a correctly configured Stripe `card` method unavailable. Invalid or unsafe backend URLs for one provider stay off the diagnostics snapshot; the affected method reports `PROVIDER_MISCONFIGURED` (or related fixed codes). Development console may also emit `BACKEND_BASE_URL_INVALID` / `BACKEND_ENDPOINT_INVALID` without printing the raw URL.

### How checkout communicates state

| Layer | What buyers see | What developers inspect |
|-------|-----------------|-------------------------|
| Method tiles | Only methods that pass availability are usable | `EasyPaymentsDiagnosticsService` readiness per method |
| Payment attempt | In-checkout processing / error / cancel UI | `(started)`, `(success)`, `(cancel)`, `(error)` |
| Config / init | Not shown as diagnostics banners in the buyer UI | Dev console warnings + diagnostics snapshot |

**Config/readiness failure** ≠ **payment failure**. Readiness comes from `refreshAvailability()` / diagnostics. A declined card or cancelled PayPal sheet is a payment outcome on `(error)` / `(cancel)` and does **not** rewrite diagnostics readiness by itself.

### Recovery

There is **no** background loop that auto-heals a misconfigured provider. After you fix config:

1. `EasyPaymentsConfigService.replace(...)`
2. `await PaymentOrchestratorService.reinitialize()`
3. Let `<easy-payments>` refresh on its next input change, or call `refreshAvailability(...)` yourself (the demo does this after mode switches)

Unavailable / misconfigured methods stay unavailable until a successful refresh. Buyers can continue with any method that is still `ready` (for example PayPal while Stripe is broken).

### Public diagnostics API

Inject `EasyPaymentsDiagnosticsService` anywhere `provideEasyPayments()` is registered. The checkout component already refreshes availability; this service projects that result.

```ts
import { Component, inject } from '@angular/core';
import {
  EasyPaymentsDiagnosticsService,
  type EasyPaymentsDiagnosticsSnapshot,
  type PaymentMethodDiagnostic,
} from '@easy-payments/angular';

@Component({
  selector: 'app-checkout-status',
  template: `
    @if (!diagnostics().published) {
      <p>Waiting for checkout availability.</p>
    } @else {
      @for (entry of diagnostics().methods; track entry.method) {
        <p>{{ entry.method }} · {{ entry.provider }} · {{ entry.readiness }}</p>
      }
    }
  `,
})
export class CheckoutStatusComponent {
  private readonly diagnosticsService = inject(EasyPaymentsDiagnosticsService);

  /** Signal. Updates when availability is published or cleared. */
  readonly diagnostics = this.diagnosticsService.diagnostics;

  logStatus(): void {
    const snapshot: EasyPaymentsDiagnosticsSnapshot = this.diagnosticsService.snapshot();
    const paypal: PaymentMethodDiagnostic | undefined = this.diagnosticsService.method('paypal');
    const card = this.diagnosticsService.method('card');

    if (card?.readiness === 'unavailable' || card?.readiness === 'misconfigured') {
      // Fixed developer text — safe to log. Prefer code over free-form messages elsewhere.
      console.info('card', card.code, card.message);
    }
    if (paypal?.readiness === 'ready') {
      console.info('PayPal remains available while other methods may be misconfigured.');
    }
    console.info(snapshot.published, snapshot.methods);
  }
}
```

| `readiness` | Meaning |
|-------------|---------|
| `loading` | Still checking. Not ready. |
| `ready` | Availability passed (does not mean the browser SDK is already loaded). |
| `unavailable` | Not usable in this environment / device. |
| `misconfigured` | Configuration or initialization failed for that method. |

`published` is `false` until the first `refreshAvailability()`, and again after `reinitialize()` until the next refresh. An empty unpublished list is **not** a ready checkout. `code` is a stable `EasyPaymentsDiagnosticCode` from `EASY_PAYMENTS_DIAGNOSTIC_CODES` (omitted when ready). `message` is fixed developer text.

Snapshots omit secret keys, client secrets, PaymentIntent secrets, authorization headers, tokens, and raw provider errors. The service does not read `window`, `document`, `navigator`, or `localStorage`. Apple Pay and Google Pay are not `ready` during server rendering.

With **multiple** `<easy-payments>` hosts, each instance keeps its own method-tile availability session. `EasyPaymentsDiagnosticsService` remains a **global last-refresh** projection (whichever host refreshed last) — it is not a per-instance merge.

Full reference: **[docs/api.md](docs/api.md#diagnostics)** · Security notes: **[docs/security.md](docs/security.md)**

---

## Payment events

| Output | Payload | When |
|--------|---------|------|
| `started` | `PaymentStartedEvent` | A payment attempt begins. Not fired by selecting a tile. |
| `methodChange` | `PaymentMethodChangeEvent` | The selected method changes. |
| `success` | `PaymentResult` | Payment succeeded (PayPal after capture). |
| `cancel` | `PaymentResult` | Customer cancelled. |
| `error` | `PaymentError` | Payment or configuration failure during an attempt. |
| `successContinue` | `PaymentResult` | Buyer continued after the confirmation view. |

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

`PaymentStartedEvent` is `{ method, provider, amount, currency }` (checkout product amount/currency). `PaymentMethodChangeEvent` is `{ method, previousMethod, provider }` (`method` may be `null`).

PayPal `success` is emitted after capture. Apple Pay `started` is emitted on wallet confirm. Klarna and Affirm do not emit `started` again when the browser returns from a redirect. A repeated click or duplicate callback does not emit a second `started` for the same attempt. Configuration failures use `error` and do not emit `cancel`.

These events omit client secrets, secret keys, tokens, and raw provider responses. Log `PaymentError.code` rather than `message`. Diagnostics readiness is a separate API. Frontend events are **not** fulfillment — use verified webhooks (or server retrieval) before shipping goods.

Full reference: **[docs/api.md](docs/api.md#outputs)**.

---

## Visual customization

Optional `[visualStyle]` customizes **Easy Payments–owned** UI only (shell, tiles, EP copy, accent/focus). It does **not** restyle Stripe Elements / iframes, PayPal Buttons, Apple Pay / Google Pay sheets, or provider logos.

```ts
import { Component } from '@angular/core';
import {
  EasyPaymentsComponent,
  PaymentError,
  type EasyPaymentsVisualStyle,
  type PaymentMethod,
  type PaymentProduct,
  type PaymentResult,
} from '@easy-payments/angular';

@Component({
  selector: 'app-branded-checkout',
  imports: [EasyPaymentsComponent],
  template: `
    <easy-payments
      [product]="product"
      [methods]="methods"
      theme="system"
      appearance="default"
      [visualStyle]="visualStyle"
      (success)="onSuccess($event)"
      (cancel)="onCancel($event)"
      (error)="onError($event)"
    />
  `,
})
export class BrandedCheckoutComponent {
  readonly product: PaymentProduct = {
    id: 'premium-plan',
    name: 'Premium Plan',
    amount: 99,
    currency: 'USD',
  };

  readonly methods: PaymentMethod[] = ['card', 'paypal'];

  readonly visualStyle: EasyPaymentsVisualStyle = {
    fontFamily: 'Georgia, "Times New Roman", serif', // load custom fonts in the host app
    textColor: '#0f172a',
    textSecondaryColor: '#64748b',
    backgroundColor: 'transparent',
    surfaceColor: '#ffffff',
    accentColor: '#0b6e4f',
    borderRadius: '12px',
    spacing: '16px',
  };

  onSuccess(result: PaymentResult): void {
    console.log(result);
  }

  onCancel(result: PaymentResult): void {
    console.log(result);
  }

  onError(error: PaymentError): void {
    console.error(error.code, error.message);
  }
}
```

| Concern | Behavior |
|---------|----------|
| `theme` | `light` / `dark` / `system` set built-in EP color tokens (`system` follows OS live). |
| `appearance` | `default` paints the outer shell; `transparent` clears shell chrome so a merchant parent background shows through. Tiles still use `--ep-surface`. |
| CSS tokens | `[visualStyle]` writes supported `--ep-*` values as **inline** host custom properties (they override stylesheet rules for the same token). Theme stylesheet → consumer CSS on `easy-payments` → `[visualStyle]` inline. Competing inline `style` vs `[visualStyle]` is order-dependent — use one mechanism. |
| Contrast | In Angular **development** mode only, low-contrast EP-owned pairs may `console.warn`. Never shown in buyer UI, never mutates colors, never blocks payments. Not a full WCAG audit. Transparent/unknown backdrops are skipped rather than guessed. |
| Reset | Set `[visualStyle]="null"` (or omit) to restore the active theme defaults. |

Interactive playground controls (presets, field editors, dual-instance theme check): run the demo and open **Visual style (Phase 3 QA)**. Checklist: **[docs/phase-3-visual-qa.md](docs/phase-3-visual-qa.md)**. Full token contract: **[docs/configuration.md](docs/configuration.md#visual-style)** · **[docs/api.md](docs/api.md#visual-style)**.

### Buttons Only shared corner radius (`buttonsAppearance.borderRadius`)

One shared setting for the **entire Buttons Only payment grid**. Reuses the existing `buttonsAppearance.borderRadius` CSS length (for example `'0'`, `'4px'`, `'999px'`). Default when omitted: theme `--ep-radius-md` for library/mock chrome; SDK buttons keep provider defaults until you set it.

```ts
import { Component } from '@angular/core';
import {
  EasyPaymentButtonsComponent,
  type EasyPaymentButtonsAppearance,
  type PaymentMethod,
  type PaymentProduct,
} from '@easy-payments/angular';

@Component({
  selector: 'app-buttons-radius',
  imports: [EasyPaymentButtonsComponent],
  template: `
    <easy-payment-buttons
      [product]="product"
      [methods]="methods"
      [buttonsAppearance]="buttonsAppearance"
    />
  `,
})
export class ButtonsRadiusComponent {
  readonly product: PaymentProduct = {
    id: 'premium-plan',
    name: 'Premium Plan',
    amount: 49.99,
    currency: 'USD',
  };

  readonly methods: PaymentMethod[] = [
    'card',
    'paypal',
    'venmo',
    'google-pay',
    'apple-pay',
  ];

  /** Exact property: `buttonsAppearance.borderRadius` (CSS px string). */
  readonly buttonsAppearance: EasyPaymentButtonsAppearance = {
    borderRadius: '4px', // also accepts '0' and pill-like '999px'
  };
}
```

| Surface | How radius is applied |
|---------|------------------------|
| Library selectors + mock strip buttons | CSS `--ep-buttons-radius` |
| PayPal / Venmo (live SDK) | `style.borderRadius` (px number). `0` → `shape: 'sharp'` (classic SDK bug) |
| Google Pay (live SDK) | `buttonRadius` (px). Clamped to ≤ half button height (**max 20** at the default 40px height) |
| Apple Pay (Stripe ECE) | Elements Appearance `variables.borderRadius` |

Scoped to Buttons Only. Does not change Full Checkout tiles or confirmation CTAs. Single-line selectors stay **40px** tall; long custom labels still wrap. Changing `borderRadius` remounts supported SDK buttons with the new radius. Do not clip official SDK chrome with CSS.

### Selector labels (`selectorLabels`)

Optional plain-text overrides for **library-owned** method selectors (Card, US bank account, and other non-wallet tiles). Card and US bank account can be set independently. These options change the **visible selector label** and its **accessible name**. Confirmation button text is configured separately via [`cardButtonAppearance`](#stripe-card-confirmation-button-cardbuttonappearance) (and related CTA inputs) — not here.

Omitted or blank keys fall back to the library’s localized defaults for the active `[locale]`.

#### Full Checkout

Bind `[selectorLabels]` on `<easy-payments>`:

```ts
import { Component } from '@angular/core';
import {
  EasyPaymentsComponent,
  type EasyPaymentButtonsSelectorLabels,
  type PaymentMethod,
  type PaymentProduct,
} from '@easy-payments/angular';

@Component({
  selector: 'app-selector-labels-full-checkout',
  imports: [EasyPaymentsComponent],
  template: `
    <easy-payments
      [product]="product"
      [methods]="methods"
      [selectorLabels]="selectorLabels"
    />
  `,
})
export class SelectorLabelsFullCheckoutComponent {
  readonly product: PaymentProduct = {
    id: 'premium-plan',
    name: 'Premium Plan',
    amount: 49.99,
    currency: 'USD',
  };

  readonly methods: PaymentMethod[] = ['card', 'us-bank-account', 'paypal'];

  readonly selectorLabels: EasyPaymentButtonsSelectorLabels = {
    card: 'Credit / Debit',
    usBankAccount: 'Bank account',
  };
}
```

#### Buttons Only

Set `buttonsAppearance.selectorLabels` (same `card` / `usBankAccount` keys):

```ts
import { Component } from '@angular/core';
import {
  EasyPaymentButtonsComponent,
  type EasyPaymentButtonsAppearance,
  type PaymentMethod,
  type PaymentProduct,
} from '@easy-payments/angular';

@Component({
  selector: 'app-selector-labels-buttons-only',
  imports: [EasyPaymentButtonsComponent],
  template: `
    <easy-payment-buttons
      [product]="product"
      [methods]="methods"
      [buttonsAppearance]="buttonsAppearance"
    />
  `,
})
export class SelectorLabelsButtonsOnlyComponent {
  readonly product: PaymentProduct = {
    id: 'premium-plan',
    name: 'Premium Plan',
    amount: 49.99,
    currency: 'USD',
  };

  readonly methods: PaymentMethod[] = ['card', 'us-bank-account', 'paypal'];

  readonly buttonsAppearance: EasyPaymentButtonsAppearance = {
    selectorLabels: {
      card: 'Credit / Debit',
      usBankAccount: 'Bank account',
    },
  };
}
```

#### Host-localized overrides (en / es / pt)

Supply your own English, Spanish, and Portuguese labels, pick the map for the active locale, and rebind when the language changes. Easy Payments does not translate host overrides — update the binding yourself (or omit keys to use library defaults).

```ts
import { Component, computed, signal } from '@angular/core';
import {
  EasyPaymentButtonsComponent,
  EasyPaymentsComponent,
  type EasyPaymentButtonsAppearance,
  type EasyPaymentButtonsSelectorLabels,
  type EasyPaymentsLocale,
  type PaymentMethod,
  type PaymentProduct,
} from '@easy-payments/angular';

const SELECTOR_LABELS_BY_LOCALE: Record<
  'en' | 'es' | 'pt',
  EasyPaymentButtonsSelectorLabels
> = {
  en: { card: 'Credit / Debit', usBankAccount: 'Bank account' },
  es: { card: 'Crédito / Débito', usBankAccount: 'Cuenta bancaria' },
  pt: { card: 'Crédito / Débito', usBankAccount: 'Conta bancária' },
};

@Component({
  selector: 'app-selector-labels-i18n',
  imports: [EasyPaymentsComponent, EasyPaymentButtonsComponent],
  template: `
    <easy-payments
      [product]="product"
      [methods]="methods"
      [locale]="locale()"
      [selectorLabels]="selectorLabels()"
    />

    <easy-payment-buttons
      [product]="product"
      [methods]="methods"
      [locale]="locale()"
      [buttonsAppearance]="buttonsAppearance()"
    />
  `,
})
export class SelectorLabelsI18nComponent {
  readonly product: PaymentProduct = {
    id: 'premium-plan',
    name: 'Premium Plan',
    amount: 49.99,
    currency: 'USD',
  };

  readonly methods: PaymentMethod[] = ['card', 'us-bank-account'];

  /** Host app language (keep in sync with `[locale]`). */
  readonly locale = signal<Exclude<EasyPaymentsLocale, 'auto'>>('en');

  readonly selectorLabels = computed(
    () => SELECTOR_LABELS_BY_LOCALE[this.locale()],
  );

  readonly buttonsAppearance = computed<EasyPaymentButtonsAppearance>(() => ({
    selectorLabels: this.selectorLabels(),
  }));

  setLanguage(next: 'en' | 'es' | 'pt'): void {
    this.locale.set(next);
  }
}
```

| Concern | Behavior |
|---------|----------|
| Keys | Use `card` and `usBankAccount` (and other library selectors as needed). Wallet SDK buttons are not relabelable. |
| Fallback | Omit a key or pass blank / invalid text → library localized default for the current `[locale]`. |
| A11y | Accessible names follow the visible selector label (override or default). |
| Confirm CTAs | Unchanged — configure with `[cardButtonAppearance]` (and BNPL/ACH confirm copy separately). |
| Reactivity | Rebind `[selectorLabels]` / `buttonsAppearance.selectorLabels` when your language changes so host copy stays in sync; defaults already track `[locale]`. |

Full field notes: **[docs/api.md](docs/api.md#selector-labels)** · **[docs/configuration.md](docs/configuration.md#selector-labels-card--us-bank-account)**.

### Stripe Card confirmation button (`cardButtonAppearance`)

The Stripe Card flow uses Stripe’s Payment Element plus an **Easy Payments–owned** confirm button (`.ep-stripe-card__pay` — “Pay {{amount}}” in Full Checkout, “Pay with card” in Buttons Only). Optional `[cardButtonAppearance]` customizes that library button only.

It does **not** restyle the Stripe Payment Element iframe, PayPal Buttons, Google Pay, or Apple Pay SDK chrome.

```ts
import { Component } from '@angular/core';
import {
  EasyPaymentsComponent,
  EasyPaymentButtonsComponent,
  type EasyPaymentsCardButtonAppearance,
  type PaymentMethod,
  type PaymentProduct,
} from '@easy-payments/angular';

@Component({
  selector: 'app-card-cta-examples',
  imports: [EasyPaymentsComponent, EasyPaymentButtonsComponent],
  template: `
    <!-- Full Checkout -->
    <easy-payments
      [product]="product"
      [methods]="methods"
      theme="system"
      [cardButtonAppearance]="cardButtonAppearance"
    />

    <!-- Buttons Only (same input; applies after Card expands) -->
    <easy-payment-buttons
      [product]="product"
      [methods]="methods"
      theme="dark"
      [cardButtonAppearance]="cardButtonAppearance"
    />
  `,
})
export class CardCtaExamplesComponent {
  readonly product: PaymentProduct = {
    id: 'premium-plan',
    name: 'Premium Plan',
    amount: 49.99,
    currency: 'USD',
  };

  readonly methods: PaymentMethod[] = ['card', 'paypal'];

  readonly cardButtonAppearance: EasyPaymentsCardButtonAppearance = {
    label: 'Complete card payment', // plain text; overrides localized idle label
    backgroundColor: '#0b6e4f',
    textColor: '#f8fafc',
    fontFamily: 'Georgia, serif',
    fontSize: '16px',
    fontWeight: 700,
    textAlign: 'center',
    border: 'none', // or omit and set borderWidth / borderStyle / borderColor
    borderRadius: '10px',
    minHeight: '48px',
    width: '100%',
    padding: '0 20px',
    hoverBackgroundColor: '#095c42',
    hoverTextColor: '#ffffff',
    disabledBackgroundColor: '#4b5563',
    disabledTextColor: '#d1d5db',
    loadingBackgroundColor: '#1f2937',
    loadingTextColor: '#f9fafb',
    focusOutlineColor: '#22c55e',
    focusOutlineWidth: '2px',
    focusOutlineOffset: '2px',
  };
}
```

| Concern | Behavior |
|---------|----------|
| Defaults | Omit `[cardButtonAppearance]` (or pass `null`) — light uses the dark slate CTA; dark mixes merchant `--ep-accent` into a high-contrast CTA with light text; `system` follows the resolved theme. Localization unchanged. |
| Label | Optional plain-text `label` replaces the idle localized string only when valid. Processing copy still uses i18n (`processingPayment`). Markup / oversized labels are rejected. |
| Styles | Valid fields become instance-local `--ep-card-cta-*` custom properties on `easy-stripe-card-payment`, falling back to theme `--ep-cta-*`. Invalid values are ignored (no CSS injection). |
| Borders | `border: 'none'` forces no border. Otherwise set `borderWidth` / `borderStyle` / `borderColor`. |
| A11y | Remains a real `<button>` with disabled / `aria-busy` behavior and `:focus-visible` outline. Prefer sufficient contrast when overriding colors; EP does not silently rewrite your colors. |
| Scope | Shared Stripe Card component for both hosts — one implementation, per-instance isolation. |

Full field table: **[docs/api.md](docs/api.md#stripe-card-button-appearance)** · **[docs/configuration.md](docs/configuration.md#stripe-card-button-appearance)**.

---

## Responsive Design

Checkout is fluid up to `[maxWidth]`. The payment method grid reflows from the **component container width** (works in sidebars, modals, and embeds — not viewport-only). See Preview screenshots above.

---

## Payment method requirements

Every method currently exposed by the library (Full Checkout, Buttons Only, and Headless) has setup, eligibility, secret vs public values, and unavailable UX documented here:

**[docs/payment-method-requirements.md](docs/payment-method-requirements.md)**

| Method | Detailed setup |
|--------|----------------|
| Card | [docs/providers/stripe.md](docs/providers/stripe.md) |
| Apple Pay | [docs/providers/apple-pay.md](docs/providers/apple-pay.md) |
| Google Pay | [docs/providers/google-pay.md](docs/providers/google-pay.md) |
| PayPal | [docs/providers/paypal.md](docs/providers/paypal.md) |
| Venmo | [docs/providers/venmo.md](docs/providers/venmo.md) |
| Klarna | [docs/providers/klarna.md](docs/providers/klarna.md) |
| Affirm | [docs/providers/affirm.md](docs/providers/affirm.md) |
| US bank account (ACH) | [docs/providers/us-bank-account.md](docs/providers/us-bank-account.md) |
| Cash App Pay | [docs/providers/cash-app-pay.md](docs/providers/cash-app-pay.md) |
| Afterpay | [docs/providers/afterpay.md](docs/providers/afterpay.md) |
| Zip | [docs/providers/zip.md](docs/providers/zip.md) |

Unavailable methods are **hidden** in Full Checkout and Buttons Only (not shown as disabled). Headless reports `readiness` / diagnostic codes. Use `EasyPaymentsDiagnosticsService` for developer diagnosis — buyers should not see technical config strings.

---

## Provider credentials

| Provider | Frontend | Backend | Notes |
|----------|----------|---------|-------|
| **Stripe** | `pk_test_` / `pk_live_` | `sk_test_` / `sk_live_` | Card + wallets + Klarna + Affirm + ACH + Cash App + Afterpay |
| **PayPal** | Client ID | Client Secret | Create + capture URLs (also Venmo) |
| **Apple Pay** | `applePay: {}` + Stripe publishable key | Stripe secret via create URL | Opt-in via Easy Payments; uses Stripe ECE. Empty `{}` = no extra Apple Pay frontend credentials — HTTPS / Wallet / Payment Method Domains still required |
| **Google Pay** | `googlePay` + Stripe | Stripe secret via create URL | `TEST` / `PRODUCTION` |
| **Klarna** | `klarna` + Stripe | Stripe + `klarnaCreatePaymentUrl` | Redirect + return recovery |
| **Affirm** | `affirm` + Stripe | Stripe + `affirmCreatePaymentUrl` | ~$35 min in library; eligibility varies |
| **Venmo** | `venmo: {}` + PayPal Client ID | Same PayPal create/capture | US/USD; opt-in |
| **US bank account** | `usBankAccount: {}` + Stripe | Stripe + `createUsBankAccountPaymentUrl` | USD ACH; opt-in |
| **Cash App Pay** | `cashAppPay: {}` + Stripe | Stripe + `cashAppPayCreatePaymentUrl` | US/USD; ≥ $0.50; opt-in |
| **Afterpay** | `afterpay: {}` + Stripe | Stripe + `afterpayCreatePaymentUrl` | AU/CA/NZ/GB/US; opt-in |
| **Zip** | `zip: {}` | `zipCreateCheckoutUrl` + `zipVerifyReturnUrl` | Server: `ZIP_MERCHANT_ID`, `ZIP_API_SECRET`, `ZIP_CALLBACK_URL`; US/USD; opt-in |

Details: [docs/payment-method-requirements.md](docs/payment-method-requirements.md) · [docs/providers/](docs/providers/) · Security: [docs/security.md](docs/security.md)

> **Never** put Stripe secret keys, PayPal Client Secrets, or Zip API secrets in Angular.

---

## Backend

A backend is required for secrets, trusted pricing, and captures.

Any language works (NestJS, Express, .NET, Java, PHP, Python, Go, …) if it implements the [HTTP contract](docs/backend.md).

Optional `backend.baseUrl` prefixes relative endpoint paths (see Quick Start). Absolute `https://...` endpoints are left unchanged. One invalid endpoint does not disable an unrelated provider.

This repo’s [`server/`](server) NestJS app is a **reference example**, not a production mandate. It also includes optional verified webhook receivers (`POST /api/webhooks/stripe`, `POST /api/webhooks/paypal`) for settlement experiments — see **[docs/backend.md — Webhooks](docs/backend.md#webhooks-reference)**. Angular `success` / `started` events are UX signals only; do not fulfill from them alone.

---

## Explore the Project

| Area | Path |
|------|------|
| Library | [`projects/easy-payments`](projects/easy-payments) |
| Angular demo | [`projects/demo`](projects/demo) |
| Reference backend | [`server`](server) |
| Documentation | [`docs`](docs) |
| Issues | [GitHub Issues](https://github.com/easy-payments-dev/easy-payments-angular/issues) |

---

## Running the Example Locally

```bash
npm install
npm run build:lib
npm start
```

Demo: http://localhost:4200

```bash
cd server
npm install
# copy .env.example → .env (TEST secrets only)
npm run start:dev
```

API: http://localhost:3001

More: [docs/demo.md](docs/demo.md) · Phase 3 visual QA checklist: [docs/phase-3-visual-qa.md](docs/phase-3-visual-qa.md)

---

## Testing Payments

- Stripe **Test** mode + test cards
- PayPal **Sandbox**
- Google Pay `environment: 'TEST'`
- Demo Mode in the playground (mocks — no real charges)
- Visual customization presets / dual-instance theme check in the demo **Visual style (Phase 3 QA)** panel

Do not use live credentials for basic integration testing.

---

## Going to Production

- Live publishable / secret credentials (backend secrets stay server-side)
- Trusted server pricing
- HTTPS
- Stripe Payment Method Domains (wallets)
- PayPal Live + Google Pay PRODUCTION merchant ID when applicable
- Klarna / Affirm eligibility & approvals
- Webhooks / reconciliation
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

**How do I localize the UI?** `[locale]` (`auto` / `en` / `es` / `pt`) and optional `[translations]`. See [localization](docs/localization.md).

**Does locale convert currency?** No — display formatting only.

**Dark / light / system / transparent / width?** Yes — see [configuration](docs/configuration.md).

**Can I brand fonts and colors?** Yes — optional `[visualStyle]` for Easy Payments–owned UI. Provider SDK chrome stays provider-owned. See [Visual customization](#visual-customization).

**If Stripe is misconfigured, does PayPal still work?** Yes, when PayPal is correctly configured. Stripe-dependent methods (card, wallets, Klarna, Affirm) stay unavailable until Stripe is fixed. See [Provider isolation & diagnostics](#provider-isolation--diagnostics).

**Does Apple Pay / Google Pay always appear?** No — capability and configuration dependent.

**How do I report a bug or suggest a feature?** [GitHub Issues](https://github.com/easy-payments-dev/easy-payments-angular/issues).

**Can I inspect the source / demo / backend?** Yes — links above.

**How can I support the project?** Optional contributions via [PayPal](https://paypal.me/JoseVicente07) — not required to use the library.

---

## Community & Feedback

Prefer **[GitHub Issues](https://github.com/easy-payments-dev/easy-payments-angular/issues)** for bugs, features, provider ideas, docs, compatibility, and a11y/UX suggestions.

Project contact (general / private): **jantvb@gmail.com**

Contributing guide: [CONTRIBUTING.md](CONTRIBUTING.md)

---

## Support Easy Payments

Easy Payments is open source and free to use.

If Easy Payments saves you development time or helps your project, you can support its continued development with an optional contribution.

[Support Easy Payments via PayPal](https://paypal.me/JoseVicente07)

This is an optional way to support the open-source project. It is **not** a license fee, subscription, or related to merchant payments processed through Easy Payments.

---

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for **1.2.1**. 1.2.0, 1.1.0, and 1.0.0 remain in that file.

---

## License

MIT © 2026 Jose Vicente — see [LICENSE](LICENSE).
