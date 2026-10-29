# Easy Payments API Reference (v1.1.0)

Complete public API for the Angular `<easy-payments>` and `<easy-payment-buttons>` components and related exports.

Package: `@easy-payments/angular`  
Peers: `@angular/core` / `@angular/common` `>=20.3.0 <23.0.0`, `@stripe/stripe-js` `^8.0.0`

---

## Component: `<easy-payments>`

Standalone component. Selector: `easy-payments`.

### Inputs

| Property | Type | Default | Required | Allowed values | Description |
|----------|------|---------|----------|----------------|-------------|
| `product` | `PaymentProduct` | — | **Yes** | see [PaymentProduct](#paymentproduct) | Product/checkout line shown to the customer and sent to your backend. |
| `methods` | `PaymentMethod[]` | `['apple-pay','google-pay','paypal','card']` | No | `apple-pay`, `google-pay`, `paypal`, `klarna`, `affirm`, `card` | Allowed methods **and** preferred visual order. Unavailable methods are omitted; relative order of available methods is preserved. No separate `order` input. |
| `checkout` | `CheckoutOptions` | `undefined` | No | see below | Optional checkout hints (`successUrl`, `cancelUrl`, `successBehavior`, customer, shipping). |
| `theme` | `PaymentTheme` | `'system'` | No | `light`, `dark`, `system` | Color theme. `system` follows `prefers-color-scheme` and updates when the preference changes. |
| `appearance` | `EasyPaymentsAppearance` | `'default'` | No | `default`, `transparent` | Outer shell. Independent of `theme`. `transparent` removes built-in card chrome. |
| `visualStyle` | `EasyPaymentsVisualStyle \| null` | `null` | No | see [Visual style](#visual-style) | Optional EP-owned font / color / token overrides. Invalid fields ignored. Does not restyle provider SDK chrome. |
| `maxWidth` | `number \| string \| null \| undefined` | `640` | No | clamped to **320–1200** px | Max checkout width. Component stays `width: 100%` up to this cap. Invalid values fall back to `640`. |
| `successBehavior` | `CheckoutSuccessBehavior` | `'confirmation'` | No | `confirmation`, `event-only` | Built-in success UI vs emit-only. Overridden by `checkout.successBehavior` when set. |
| `locale` | `EasyPaymentsLocale` | `'auto'` | No | `auto`, `en`, `es`, `pt` | UI locale. `auto` detects from the browser (`es-*`→es, `pt-*`→pt, `en-*`→en, else English). See [localization.md](./localization.md). |
| `translations` | `EasyPaymentsTranslationOverrides` | `{}` | No | partial dictionary keys | Partial overrides for Easy Payments-owned strings. Priority: override → locale dictionary → English. |

#### Examples

```html
<easy-payments
  [product]="product"
  [methods]="methods"
  theme="system"
  appearance="default"
  [maxWidth]="640"
  successBehavior="confirmation"
  (success)="onSuccess($event)"
  (cancel)="onCancel($event)"
  (error)="onError($event)"
  (successContinue)="onContinue($event)"
/>
```

```html
<easy-payments
  [product]="product"
  [methods]="['paypal', 'card', 'google-pay']"
  theme="dark"
  appearance="transparent"
  [maxWidth]="520"
  successBehavior="event-only"
/>
```

### Outputs

| Event | Payload | When it fires | Typical use |
|-------|---------|---------------|-------------|
| `started` | `PaymentStartedEvent` | A payment attempt begins | Disable a second submit, analytics |
| `success` | `PaymentResult` | Payment completed successfully | Persist order, navigate, analytics |
| `cancel` | `PaymentResult` | Customer cancelled on a path the provider reports as cancellation | Restore cart UX, messaging |
| `error` | `PaymentError` | Payment failed, or an existing configuration/availability error | Show merchant error UI |
| `methodChange` | `PaymentMethodChangeEvent` | The selected method changes | Update the surrounding page |
| `successContinue` | `PaymentResult` | Customer clicks **Continue** on the built-in success screen | Only when `successBehavior` is `confirmation` |

`success`, `cancel`, `error`, and `successContinue` keep their existing names and payload fields. `started` and `methodChange` are additive.

```html
<easy-payments
  [product]="product"
  [methods]="methods"
  (started)="onStarted($event)"
  (success)="onSuccess($event)"
  (cancel)="onCancel($event)"
  (error)="onError($event)"
  (methodChange)="onMethodChange($event)"
  (successContinue)="onContinue($event)"
/>
```

```ts
import {
  PaymentError,
  PaymentMethodChangeEvent,
  PaymentResult,
  PaymentStartedEvent,
} from '@easy-payments/angular';

onStarted(event: PaymentStartedEvent): void {
  // One attempt. Tile selection does not call this.
}

onSuccess(result: PaymentResult): void {
  // result.transactionId and result.sessionId are safe references when the provider has them.
}

onError(error: PaymentError): void {
  // Prefer error.code. error.message is the existing PaymentError text.
}

onCancel(result: PaymentResult): void {
  // Only when the current provider flow reports cancellation.
}

onMethodChange(event: PaymentMethodChangeEvent): void {
  // event.method is null when nothing remains selectable.
}
```

### Payment started

`started` fires once per attempt:

| Flow | When `started` fires |
|------|----------------------|
| Mock checkout and any `processPayment()` path | When the pay action is accepted |
| Stripe card | When the customer submits the card form, before `confirmPayment` |
| PayPal | When order creation begins. Approve and capture do not fire it again |
| Google Pay | When the official button click is accepted |
| Apple Pay | When Stripe Express Checkout emits `confirm`. Rendering the button does not fire it |
| Klarna and Affirm | When the customer submits. A return to the page does not fire it again |

Selecting a method tile does not fire `started`. A repeated click or a second SDK callback during the same attempt does not fire it again. `resetCheckoutView()` or the built-in Try again / Continue action allows another attempt.

`PaymentStartedEvent` contains `method`, `provider`, `amount`, and `currency`. Amount and currency are the current checkout product input, not a captured charge.

### Success, failure, and cancellation

`success` still fires only after the existing provider flow confirms success. PayPal `success` fires after capture, not when the order is created. Stripe card `success` keeps the current adapter rule: PaymentIntent statuses `succeeded`, `processing`, and `requires_capture` are already reported as success.

`error` still uses `PaymentError` and its stable `code`. A declined card uses `CARD_DECLINED` or `PAYMENT_FAILED`, depending on the existing mapper. Configuration failures such as `SDK_LOAD_FAILED` still use `error` and do not emit `cancel` or `started`. An availability refresh error still uses the existing `error` output and is not a payment attempt.

`cancel` fires when the existing flow reports cancellation: mock cancellation, PayPal `onCancel`, a Stripe or wallet result with status `cancelled`, or `PAYMENT_CANCELLED`. A configuration failure is not a cancellation. Easy Payments does not invent a cancellation for a provider that only reports a generic dismissal or load failure.

`methodChange` fires when the selected method actually changes, including the first selection and when the current method is removed or becomes unavailable. Choosing the method that is already selected does not fire it again. `provider` is null when `method` is null.

Duplicate terminal callbacks for the same attempt are ignored after the first `success`, `cancel`, or `error` that belongs to that attempt. Callbacks after the component is destroyed are ignored.

Diagnostics stay separate. A payment failure does not change `EasyPaymentsDiagnosticsService` readiness, and a readiness update does not emit `started` or `cancel`.

These payloads omit PaymentIntent client secrets, secret keys, PayPal client secrets, access tokens, authorization headers, raw SDK bodies, and card data. `PaymentResult.metadata` remains whatever the existing provider result already included. Do not log `PaymentError.message` if a backend or SDK may have put sensitive text there; log `code` instead.

> There is **no** public `busyChange` output on `<easy-payments>` in v1.0.0. Processing locks the checkout UI internally; use the visible processing screen and the events above. See [payment-flow.md](./payment-flow.md).

---

## Component: `<easy-payment-buttons>`

Standalone **Payment Buttons Only** host. Selector: `easy-payment-buttons`.

Lightweight alternative to `<easy-payments>`: no product summary, checkout title, or checkout card shell. The host background is **always transparent**. Method order is exactly the developer `[methods]` array (one to six of the same IDs: `card`, `paypal`, `apple-pay`, `google-pay`, `klarna`, `affirm`).

Configure providers with existing `provideEasyPayments(...)` — there is no competing `[config]` input.

### Foundation status (Phase 4 Step 1)

Slots are **structural placeholders** only. Provider SDKs are not mounted yet; payment actions are disabled (`pointer-events: none`, `aria-disabled`). Lifecycle outputs are declared for API stability but are **not** emitted from placeholder interaction. Live mounting belongs to later Phase 4 steps.

### Inputs

| Property | Type | Default | Required | Description |
|----------|------|---------|----------|-------------|
| `product` | `PaymentProduct` | — | **Yes** | Same product contract as `<easy-payments>` (availability / future payment context). |
| `methods` | `PaymentMethod[]` | all six methods | No | Allow-list **and** exact visual order. |
| `checkout` | `CheckoutOptions` | `undefined` | No | Optional checkout hints for future provider flows. |
| `layout` | `EasyPaymentButtonsLayout` | `'vertical'` | No | `horizontal` \| `vertical`. |
| `theme` | `PaymentTheme` | `'system'` | No | Same as `<easy-payments>`. |
| `locale` | `EasyPaymentsLocale` | `'auto'` | No | Same as `<easy-payments>`. |
| `translations` | `EasyPaymentsTranslationOverrides` | `{}` | No | Same as `<easy-payments>`. |
| `visualStyle` | `EasyPaymentsVisualStyle \| null` | `null` | No | EP-owned placeholder tokens. Host fill stays transparent even if `backgroundColor` is set. |

### Outputs

`started`, `methodChange`, `success`, `cancel`, `error` — same payload types as `<easy-payments>`. Not fired by foundation placeholders.

### Example

```html
<easy-payment-buttons
  [product]="product"
  [methods]="['affirm', 'paypal', 'card', 'klarna', 'google-pay', 'apple-pay']"
  layout="horizontal"
  (started)="onStarted($event)"
  (methodChange)="onMethodChange($event)"
  (success)="onSuccess($event)"
  (cancel)="onCancel($event)"
  (error)="onError($event)"
/>
```

Each instance uses a local `CheckoutAvailabilitySession` (same pattern as Step 0). `EasyPaymentsDiagnosticsService` remains global / last-refresh.

---

## PaymentProduct

```ts
interface PaymentProduct {
  id: string;
  name: string;
  description?: string;
  amount: number;
  currency: string;
  quantity?: number;
  imageUrl?: string;
  metadata?: Record<string, string>;
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` | Yes | Merchant product id (trusted pricing key on the backend). |
| `name` | `string` | Yes | Display name. |
| `description` | `string` | No | Short description. |
| `amount` | `number` | Yes | Unit amount in major currency units (e.g. `99` = $99.00). **Do not trust as production authority** — backend must validate. |
| `currency` | `string` | Yes | ISO currency code (e.g. `USD`). |
| `quantity` | `number` | No | Quantity (defaults treated as 1 when omitted/invalid in demo flows). |
| `imageUrl` | `string` | No | Optional product image URL. |
| `metadata` | `EasyPaymentsMerchantMetadata` | No | Optional flat string map. See [Merchant metadata](#merchant-metadata). |

### Minimal

```ts
const product: PaymentProduct = {
  id: 'premium-plan',
  name: 'Premium Plan',
  amount: 99,
  currency: 'USD',
};
```

### Complete

```ts
const product: PaymentProduct = {
  id: 'premium-plan',
  name: 'Premium Plan',
  description: 'One year subscription',
  amount: 99,
  currency: 'USD',
  quantity: 1,
  imageUrl: 'https://example.com/premium.png',
  metadata: { orderId: 'ORDER-12345', customerReference: 'CUSTOMER-789' },
};
```

---

## Merchant metadata

`PaymentProduct.metadata` is optional merchant reference data. It is a flat `Record<string, string>` (`EasyPaymentsMerchantMetadata`). It is not `PaymentResult.metadata`, which stays the provider result payload (`mock`, `stripeStatus`, `paypalStatus`, and similar).

```ts
metadata: {
  orderId: 'ORDER-12345',
  customerReference: 'CUSTOMER-789',
}
```

`validateMerchantMetadata()` enforces the same limits the reference backend enforces:

| Rule | Limit |
|------|--------|
| Entries | At most 10 |
| Key | 1–40 characters, starting with a letter, then letters, digits, `_`, or `-` |
| Value | Non-empty string, at most 500 characters |
| Shape | No arrays, numbers, booleans, or nested objects |
| Reserved keys | `amount`, `currency`, `productId`, `quantity`, `source`, `unitAmount`, `catalogUnitAmount`, `trustedUnitAmount`, `paymentMethod`, `provider`, and credential or card-like names |
| Unsafe values | Secret-key shapes, bearer tokens, and card-number shapes are rejected |

Invalid metadata throws `CONFIG_INVALID` from the payment adapters and `PRODUCT_INVALID` from `validatePaymentProduct()`. Messages do not include the raw key or value. Values are not truncated.

Omitted metadata keeps the previous request shape. No new configuration is required.

### Where it is sent

| Method | Behavior |
|--------|----------|
| Card, Apple Pay, Google Pay | Validated metadata is sent on `POST /api/payments/create` and stored on the Stripe PaymentIntent. The server writes `productId`, `quantity`, `source`, and the trusted unit amount after the merchant map, so those fields cannot be overridden. |
| Klarna, Affirm | Same validated map on their Stripe PaymentIntent create routes. Klarna and Affirm do not have a separate metadata API. |
| PayPal | Only `orderId` is sent, as `orderReference`, and the backend maps it to PayPal `custom_id` (127 characters). Other keys are not sent. `invoice_id` is not set. An `orderId` longer than 127 characters is rejected for PayPal and is not truncated. |

Merchant metadata is not copied into diagnostics snapshots or into `started`, `success`, `cancel`, or `error` payloads.

Do not put card numbers, secrets, or personal data in metadata. Metadata does not prove that an order or customer belongs to the current user.

In the Stripe test dashboard, open the PaymentIntent and read **Metadata**. In the PayPal sandbox transaction, read `custom_id`. Klarna and Affirm metadata is on the Stripe PaymentIntent used for that method.

---

## CheckoutOptions

```ts
type CheckoutSuccessBehavior = 'confirmation' | 'event-only';

interface CheckoutOptions {
  successUrl?: string;
  cancelUrl?: string;
  successBehavior?: CheckoutSuccessBehavior;
  customer?: { email?: string; name?: string };
  shipping?: { required?: boolean };
}
```

Notes:

- `successUrl` / `cancelUrl` are **merchant hints**. Easy Payments does **not** auto-redirect on them.
- `successBehavior` on `checkout` overrides the `successBehavior` input when present.

| Value | Meaning |
|-------|---------|
| `confirmation` | Show built-in success screen; emit `success`, then `successContinue` when Continue is clicked. |
| `event-only` | Emit `success` only; merchant owns post-payment UX. |

---

## PaymentMethod

```ts
type PaymentMethod =
  | 'apple-pay'
  | 'google-pay'
  | 'paypal'
  | 'klarna'
  | 'affirm'
  | 'card';
```

`PAYMENT_METHOD_LABELS` maps each method to a display label.

---

## Themes & appearance

```ts
type PaymentTheme = 'light' | 'dark' | 'system';
type ResolvedPaymentTheme = 'light' | 'dark';
type EasyPaymentsAppearance = 'default' | 'transparent';
```

- `theme` and `appearance` are **independent**.
- Layout reflows from the **component container width** (not only the viewport), via `[maxWidth]` (320–1200, default 640).

### Visual style

```ts
interface EasyPaymentsVisualStyle {
  fontFamily?: string;
  textColor?: string;
  textSecondaryColor?: string;
  backgroundColor?: string;
  surfaceColor?: string;
  accentColor?: string;
  borderRadius?: string;
  spacing?: string;
}
```

| Field | CSS variable(s) | Notes |
|-------|-----------------|--------|
| `fontFamily` | `--ep-font-family` | Stack, `'inherit'`, or `var(--token)`. Host loads fonts. |
| `textColor` | `--ep-text` | Primary EP-owned text. |
| `textSecondaryColor` | `--ep-text-secondary` | Secondary EP-owned text. |
| `backgroundColor` | `--ep-background` | Host backdrop. `'transparent'` supported. |
| `surfaceColor` | `--ep-surface` | Default shell + tiles/panels. With `appearance="transparent"`, shell stays clear; tiles still use surface. |
| `accentColor` | `--ep-accent`, `--ep-focus`, derived `--ep-accent-soft` | Selection / focus. Not provider logos/SDK. |
| `borderRadius` | `--ep-radius` | `--ep-radius-md = calc(var(--ep-radius) * 0.625)`. |
| `spacing` | `--ep-spacing` | `--ep-padding = calc(var(--ep-spacing) * 1.25)`; `--ep-spacing-sm = calc(var(--ep-spacing) * 0.625)`. |

**Precedence:** theme stylesheet defaults → optional consumer CSS on `easy-payments` → valid `[visualStyle]` **inline** tokens (win over stylesheets for the same property) → `appearance="transparent"` forces the shell element transparent without clearing `--ep-surface` / `--ep-background` tokens. Competing inline `style` and `[visualStyle]` on the same token are order-dependent; use one mechanism.

```html
<easy-payments
  [product]="product"
  [methods]="methods"
  appearance="default"
  [visualStyle]="{
    backgroundColor: 'transparent',
    surfaceColor: '#ffffff',
    accentColor: '#0b6e4f',
    borderRadius: '12px',
    spacing: '16px'
  }"
/>
```

- Independent of `theme` / `appearance`. Explicit overrides stay applied when switching light/dark/system.
- Removing a field (or setting `visualStyle` to `null`) restores the active theme’s default token.
- Does **not** change Stripe Elements, PayPal Buttons, wallet sheets, or official marks.
- Does **not** recreate payment provider sessions (session keys exclude visual style).

#### Contrast warnings (development only)

When Angular `isDevMode()` is true, `<easy-payments>` may log:

- `console.warn` — EP-owned pair below WCAG AA reference (**4.5:1** normal text, **3:1** focus/non-text UI)
- `console.info` — pair skipped because the backdrop is transparent/unknown (no invented host color)

These diagnostics never appear in buyer UI, never change colors, and never block checkout. They are not a WCAG compliance guarantee. Transparent shells without an opaque `backgroundColor` skip chrome-vs-host checks; opaque `--ep-surface` tile pairs are still evaluated when determinable. Unresolved `var()` / exotic color functions are skipped rather than guessed.

See [configuration.md](./configuration.md#developer-only-contrast-warnings) for examples and limitations.

See [configuration.md](./configuration.md) for the full public `--ep-*` token table.

Public layout constants:

| Constant | Value |
|----------|-------|
| `MIN_CHECKOUT_WIDTH` | `320` |
| `DEFAULT_CHECKOUT_MAX_WIDTH` | `640` |
| `MAX_CHECKOUT_WIDTH` | `1200` |

---

## PaymentResult

```ts
type PaymentStatus = 'success' | 'cancelled' | 'failed';

interface PaymentResult {
  status: PaymentStatus;
  method: PaymentMethod;
  provider: PaymentProviderName;
  transactionId?: string;
  sessionId?: string;
  message?: string;
  metadata?: Record<string, unknown>;
}
```

`normalizePaymentResult(result)` returns a shallow-normalized copy. Existing fields are unchanged.

```ts
interface PaymentStartedEvent {
  method: PaymentMethod;
  provider: PaymentProviderName;
  amount: number;
  currency: string;
}

interface PaymentMethodChangeEvent {
  method: PaymentMethod | null;
  previousMethod: PaymentMethod | null;
  provider: PaymentProviderName | null;
}
```

---

## PaymentError

```ts
type PaymentErrorCode =
  | 'CONFIG_MISSING'
  | 'CONFIG_INVALID'
  | 'PRODUCT_INVALID'
  | 'PROVIDER_UNAVAILABLE'
  | 'PROVIDER_NOT_CONFIGURED'
  | 'PAYMENT_CANCELLED'
  | 'PAYMENT_FAILED'
  | 'CARD_DECLINED'
  | 'AUTHENTICATION_REQUIRED'
  | 'AUTHENTICATION_FAILED'
  | 'NETWORK_ERROR'
  | 'SDK_LOAD_FAILED'
  | 'BACKEND_ERROR'
  | 'PROVIDER_NOT_IMPLEMENTED'
  | 'UNKNOWN';

class PaymentError extends Error {
  readonly code: PaymentErrorCode;
  readonly method?: PaymentMethod;
  readonly provider?: PaymentProviderName;
  readonly originalError?: unknown;
}
```

`normalizeError(error, fallback?)` converts unknown errors into `PaymentError`.

---

## Configuration: `provideEasyPayments`

```ts
provideEasyPayments(config: EasyPaymentsConfig)
```

```ts
interface EasyPaymentsConfig {
  providers: EasyPaymentsProviderConfig;
  backend?: EasyPaymentsBackendConfig;
  enableMockMode?: boolean; // never use in production
}
```

### Provider configs (frontend-safe)

| Provider key | Fields | Notes |
|--------------|--------|-------|
| `stripe` | `publishableKey` | `pk_test_...` / `pk_live_...` only |
| `paypal` | `clientId`, optional `currency`, `intent` | Client ID only |
| `applePay` | optional `merchantName`, `countryCode` | Uses Stripe; needs Stripe + `createPaymentUrl` |
| `googlePay` | optional `merchantId`, `merchantName`, `environment`, `countryCode` | Stripe gateway; `TEST` default; `merchantId` required for `PRODUCTION` |
| `klarna` | optional `purchaseCountry`, `locale` | Stripe-backed; needs `klarnaCreatePaymentUrl` |
| `affirm` | optional `purchaseCountry`, `locale` | Stripe-backed; needs `affirmCreatePaymentUrl`; library hides Affirm below ~$35 total |

### Backend URLs

| Field | Purpose |
|-------|---------|
| `baseUrl` | Optional origin or origin + path prefix for relative endpoints |
| `createPaymentUrl` | Stripe PaymentIntent create → `{ provider:'stripe', clientSecret, ... }` |
| `paypalCreateOrderUrl` | PayPal create order → `{ provider:'paypal', orderId }` |
| `paypalCaptureOrderUrl` | PayPal capture → `{ provider:'paypal', orderId, captureId, status? }` |
| `klarnaCreatePaymentUrl` | Klarna PI create → `{ provider:'klarna', clientSecret, ... }` |
| `affirmCreatePaymentUrl` | Affirm PI create → `{ provider:'affirm', clientSecret, ... }` |
| `confirmPaymentUrl` | Optional / reserved |

Relative endpoints are resolved against `baseUrl` when it is set. Absolute `http(s)` endpoints are used unchanged. See [Backend](./backend.md).

---

## Diagnostics

`EasyPaymentsDiagnosticsService` is a read-only view of the readiness `PaymentOrchestratorService` already publishes. It does not start a second diagnostics engine, and it does not reconfigure providers on its own.

**Multi-instance note:** diagnostics remain **global / last-refresh** (whichever checkout last called `refreshAvailability`). Each `<easy-payments>` host keeps an **instance-local** availability session for its own method tiles and order. Do not assume `diagnostics().methods` matches every mounted checkout’s visible tiles.

Inject it anywhere `provideEasyPayments()` is available:

```ts
import { Component, inject } from '@angular/core';
import {
  EasyPaymentsDiagnosticsService,
  PaymentMethodDiagnostic,
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

  /** Frozen copy for logging or one-off inspection. */
  current() {
    return this.diagnosticsService.snapshot();
  }

  /** One method from the current snapshot. */
  card(): PaymentMethodDiagnostic | undefined {
    return this.diagnosticsService.method('card');
  }
}
```

`snapshot()` returns a frozen `EasyPaymentsDiagnosticsSnapshot`:

| Field | Meaning |
|-------|---------|
| `published` | `false` until `refreshAvailability()` finishes. `reinitialize()` sets it back to `false` until the next refresh. |
| `methods` | One `PaymentMethodDiagnostic` per method included in the last refresh, in that order. |

`PaymentMethodDiagnostic` fields: `method`, `provider`, `readiness`, optional `code`, `message`, and `mock`.

Before the first refresh, `published` is `false` and `methods` is empty. That means availability has not been published. It does not mean every method is ready. `<easy-payments>` refreshes when its product, methods, or checkout inputs change. A host that calls `EasyPaymentsConfigService.replace()` must also call `PaymentOrchestratorService.reinitialize()`. The checkout component then refreshes on its next input change; the demo calls `refreshAvailability()` itself after `reinitialize()`.

### Readiness

| `readiness` | Meaning |
|-------------|---------|
| `loading` | The provider is still checking. Apple Pay Express Checkout `checking` is `loading`. A loading method is not ready. |
| `ready` | The existing availability check passed. |
| `unavailable` | The method cannot be used in this environment, or its provider is not available. |
| `misconfigured` | Configuration or initialization failed for that method. |

`ready` means the library's availability check passed. It does not mean a browser SDK has already loaded. Card and PayPal check configuration and backend URLs before loading their SDKs.

### Diagnostic codes

`code` is optional and is omitted for `ready` methods. Present codes are members of `EASY_PAYMENTS_DIAGNOSTIC_CODES` / `EasyPaymentsDiagnosticCode`. Unknown strings are dropped so a snapshot cannot echo an arbitrary value. `message` is fixed developer text for that code.

Codes the snapshot uses when the orchestrator publishes them:

| Code | Typical readiness |
|------|-------------------|
| `PROVIDER_AVAILABILITY_PENDING` | `loading` |
| `PROVIDER_UNAVAILABLE` | `unavailable` (including Apple Pay or Google Pay when the device or browser cannot pay) |
| `PROVIDER_MISCONFIGURED` | `misconfigured` or `unavailable` when a configured method fails its availability check |
| `PROVIDER_NOT_CONFIGURED` | `misconfigured` |
| `STRIPE_INITIALIZATION_FAILED` | Stripe-dependent method blocked by a Stripe initialization failure |
| `CONFIG_MISSING` | `misconfigured` |
| `CONFIG_INVALID` | `misconfigured` |
| `SDK_LOAD_FAILED` | `unavailable` |
| `BACKEND_ERROR` | `unavailable` |
| `PROVIDER_NOT_IMPLEMENTED` | `unavailable` |

`BACKEND_BASE_URL_INVALID` and `BACKEND_ENDPOINT_INVALID` are stable development-console codes from backend URL validation. The affected method's snapshot code stays `PROVIDER_MISCONFIGURED`. The raw URL is not included.

### Unavailable provider

```ts
const paypal = diagnostics.method('paypal');
if (paypal?.readiness === 'unavailable' || paypal?.readiness === 'misconfigured') {
  console.info(paypal.code, paypal.message);
}
```

A Stripe secret key, missing Stripe setup, or invalid Stripe endpoint does not mark a correctly configured PayPal method unavailable. A PayPal initialization or endpoint failure does not mark Stripe card unavailable.

### Security

Snapshots and diagnostic messages are safe to log. They do not include Stripe secret keys, PayPal client secrets, PaymentIntent client secrets, authorization headers, access tokens, raw provider errors, or customer payment details. Development warnings use the same redaction and do not print those values. Do not treat a snapshot as a secret store or as proof of a completed charge.

### Server-side rendering

`EasyPaymentsDiagnosticsService` can be injected during server rendering. Construction and `snapshot()` do not read `window`, `document`, `navigator`, or `localStorage`. Browser SDK loading stays inside the existing provider guards. Apple Pay and Google Pay are not reported `ready` on the server. An empty unpublished snapshot during server render is expected until the browser checkout refreshes availability.

---

## Notable public exports

From `@easy-payments/angular` (see `public-api.ts`):

- `EasyPaymentsComponent`
- `EasyPaymentButtonsComponent`, `EasyPaymentButtonsLayout`, `EasyPaymentButtonSlot`, `EasyPaymentButtonSlotState`
- `provideEasyPayments`, `EasyPaymentsConfigService`
- Models / types above (including `EasyPaymentsAppearance`, `EasyPaymentsVisualStyle`)
- `PaymentError`, `normalizeError`
- `PaymentStartedEvent`, `PaymentMethodChangeEvent`
- `EasyPaymentsDiagnosticsService`, `EASY_PAYMENTS_DIAGNOSTIC_CODES`
- `EasyPaymentsDiagnosticsSnapshot`, `PaymentMethodDiagnostic`, `EasyPaymentsDiagnosticCode`, `MethodReadinessState`
- `validatePaymentProduct`, `validateMerchantMetadata`, `EasyPaymentsConfigValidator`
- `EasyPaymentsMerchantMetadata`, `MERCHANT_METADATA_LIMITS`
- `MockPaymentController` (demo/testing)
- Klarna/Stripe return helpers (`isKlarnaReturnAttempt`, `detectStripeReturnMethod`, …)
- Layout helpers: `resolveCheckoutMaxWidth`, width constants

---

## Related docs

- [Configuration recipes](./configuration.md)
- [Backend contract](./backend.md)
- [Security](./security.md)
- [Providers](./providers/)
