# Getting Started

Easy Payments **v1.1.0** is an **Angular** library that renders a unified checkout for:

Card · PayPal · Apple Pay · Google Pay · Klarna · Affirm

Built-in UI locales: **`auto` · `en` · `es` · `pt`**.

You mainly:

1. Install the package  
2. Configure providers + backend URLs with `provideEasyPayments(...)`  
3. Pass a `PaymentProduct` and allowed `methods`  
4. Optionally set `theme` / `appearance` / `maxWidth` / `locale`  
5. Handle `success` / `cancel` / `error` / `successContinue`

---

## Angular compatibility

| Easy Payments | Angular peers |
|---------------|---------------|
| **1.1.x** | `>=20.3.0 <23.0.0` |
| **1.0.x** | `>=20.3.0 <23.0.0` |

- Workspace build: **Angular 22.1.5**
- Validated consumers: **Angular 20**, **21**, and **22**
- Not supported: Angular 19, Angular 23+, or non-Angular frameworks

---

## Installation

```bash
npm install @easy-payments/angular @stripe/stripe-js
```

> The npm package name is `@easy-payments/angular`.

Peer dependencies:

- `@angular/core` / `@angular/common` `>=20.3.0 <23.0.0`
- `@stripe/stripe-js` `^8.0.0`

---

## Quick Start (standalone Angular)

File-by-file walkthrough. **No NgModules.**

### 1. Install

```bash
npm install @easy-payments/angular @stripe/stripe-js
```

### 2. `app.config.ts`

Register HTTP and Easy Payments configuration:

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
      // baseUrl is optional. Omit it to use each URL exactly as written.
      backend: {
        // Shared origin for the relative paths below.
        // Local NestJS: 'http://localhost:3001'
        // Production: 'https://api.example.com'
        baseUrl: 'https://api.example.com',

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

`EasyPaymentsConfig`:

```ts
{
  providers: {
    stripe?: { publishableKey: string }; // publishable key only — never sk_...
    paypal?: { clientId: string; currency?: string; intent?: 'capture' | 'authorize' };
    // {} enables Apple Pay via existing Stripe config — not “zero setup”
    // (HTTPS, Wallet, Stripe Payment Method Domains still required)
    applePay?: { merchantName?: string; countryCode?: string };
    googlePay?: { merchantId?; merchantName?; environment?; countryCode? };
    klarna?: { purchaseCountry?; locale? }; // Stripe-backed
    affirm?: { purchaseCountry?; locale? }; // Stripe-backed
  };
  backend?: {
    baseUrl?: string;
    createPaymentUrl?;
    paypalCreateOrderUrl?;
    paypalCaptureOrderUrl?;
    klarnaCreatePaymentUrl?;
    affirmCreatePaymentUrl?;
  };
  enableMockMode?: boolean; // never in production
}
```

Never put Stripe secret keys or PayPal Client Secrets in Angular.

### 3. `app.component.ts`

```ts
import { Component } from '@angular/core';
import {
  EasyPaymentsComponent,
  PaymentError,
  PaymentMethod,
  PaymentProduct,
  PaymentResult,
  type EasyPaymentsTranslationOverrides,
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

  /** Optional partial overrides for Easy Payments-owned UI text. */
  readonly translations: EasyPaymentsTranslationOverrides = {
    // successTitle: 'You are all set!',
  };

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

`PaymentProduct` fields: `id`, `name`, `amount`, `currency` (required); `quantity?`, `description?`, `imageUrl?`, `metadata?`. `metadata` is an optional flat string map and is not payment-result metadata. Limits and provider behavior are in [api.md](./api.md#merchant-metadata).

**Amount is major currency units** (dollars, not cents). Example: `amount: 99` + `currency: 'USD'` → **$99.00**.

### 4. `app.component.html`

```html
<easy-payments
  [product]="product"
  [methods]="methods"
  theme="system"
  appearance="default"
  [maxWidth]="640"
  locale="auto"
  [translations]="translations"
  (success)="onSuccess($event)"
  (cancel)="onCancel($event)"
  (error)="onError($event)"
  (successContinue)="onContinue($event)"
/>
```

| Input | Notes |
|-------|--------|
| `product` | Required |
| `methods` | Allow-list **and** visual order (no separate `order`) |
| `checkout` | Optional checkout options |
| `theme` | `'light' \| 'dark' \| 'system'` |
| `appearance` | `'default' \| 'transparent'` |
| `maxWidth` | Default `640`, clamped 320–1200 |
| `successBehavior` | `'confirmation' \| 'event-only'` |
| `locale` | `'auto' \| 'en' \| 'es' \| 'pt'` (default `auto`) |
| `translations` | Partial string overrides |

| Output | Notes |
|--------|--------|
| `success` | `PaymentResult` |
| `cancel` | `PaymentResult` — **not** `cancelled` |
| `error` | `PaymentError` |
| `successContinue` | Fired when the customer continues from the built-in success screen |

---

## Complete copy/paste example

Minimal standalone app pieces:

**`app.config.ts`**

```ts
import { ApplicationConfig } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideEasyPayments } from '@easy-payments/angular';

export const appConfig: ApplicationConfig = {
  providers: [
    provideHttpClient(),
    provideEasyPayments({
      providers: {
        stripe: { publishableKey: 'pk_test_...' },
      },
      backend: {
        createPaymentUrl: '/api/payments/create',
      },
    }),
  ],
};
```

**`app.component.ts`**

```ts
import { Component } from '@angular/core';
import {
  EasyPaymentsComponent,
  PaymentError,
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
    id: 'sku-1',
    name: 'Demo Product',
    amount: 49.99,
    currency: 'USD',
  };

  onSuccess(r: PaymentResult): void {
    console.log(r);
  }
  onCancel(r: PaymentResult): void {
    console.log(r);
  }
  onError(e: PaymentError): void {
    console.error(e);
  }
}
```

**`app.component.html`**

```html
<easy-payments
  [product]="product"
  [methods]="['card']"
  locale="auto"
  (success)="onSuccess($event)"
  (cancel)="onCancel($event)"
  (error)="onError($event)"
/>
```

---

## Localization

- Default `locale="auto"` follows the browser language when possible.
- Force a language with `locale="en"`, `locale="es"`, or `locale="pt"`.
- Override individual strings with `[translations]`.
- Locale formats money for **display only** — it does **not** convert currency.

Details: **[localization.md](./localization.md)**

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `'easy-payments' is not a known element` | Add `EasyPaymentsComponent` to the host component `imports` array. Confirm `provideEasyPayments` is registered in `app.config.ts`. |
| No methods shown | Configure matching `providers` / backend URLs and list them in `[methods]`. |
| Wrong UI language | Set `locale` explicitly, or verify browser language detection for `auto`. |
| Amount looks 100× too small/large | Use **major units** (`99` = $99.00), not Stripe cents. |

---

## Explore examples

| What | Where |
|------|-------|
| Full Angular demo | [`projects/demo`](../projects/demo) |
| Library source | [`projects/easy-payments`](../projects/easy-payments) |
| NestJS reference backend | [`server`](../server) |
| Stripe / PayPal webhook reference | [`backend.md` — Webhooks](./backend.md#webhooks-reference) |
| Localization | [`localization.md`](./localization.md) |
| API reference | [`api.md`](./api.md) |
| Configuration recipes | [`configuration.md`](./configuration.md) |
| Backend contract | [`backend.md`](./backend.md) |
| Security | [`security.md`](./security.md) |

Checkout `success` events are not fulfillment. For production settlement, verify Stripe/PayPal webhooks on your backend (see the NestJS webhook reference).

---

## Payment Buttons Only (event-driven)

Use `<easy-payment-buttons>` when your app already owns product/price UI and you want a compact provider strip.

- The component emits `started`, `methodChange`, `success`, `cancel`, `error`, and `pending`.
- It does **not** render application-level outcome banners — show toasts, modals, or confirmation pages in your host.
- Keep listening for Stripe Payment Element validation and confirm CTAs inside the shared panel; those are payment-form UI, not app outcomes.
- Treat `pending` as incomplete. Verify fulfillment with backend / webhooks.

Full integration example and contracts: **[api.md — `<easy-payment-buttons>`](./api.md#component-easy-payment-buttons)**.

---

## Run the demo locally

```bash
npm install
npm run build:lib

# Optional: local TEST credentials (gitignored)
cp projects/demo/src/environments/environment.local.example.ts ^
   projects/demo/src/environments/environment.local.ts
# edit environment.local.ts — YOUR_* → pk_test_... / PayPal Client ID

npm start
```

Demo: http://localhost:4200  

Backend (Real / Test Providers):

```bash
cd server
npm install
cp .env.example .env   # fill YOUR_* with TEST secrets (gitignored)
npm run start:dev
```

Server: http://localhost:3001

Details: [demo.md](./demo.md)
