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
| `checkoutInstanceId` | `string \| null` | `null` | No | 1–64 chars `[a-zA-Z0-9_.:-]` | Optional stable id for multi-host redirect ownership. Omit on single-host pages. See [Klarna / Affirm redirects](#klarna--affirm-redirects). |
| `theme` | `PaymentTheme` | `'system'` | No | `light`, `dark`, `system` | Color theme. `system` follows `prefers-color-scheme` and updates when the preference changes. |
| `appearance` | `EasyPaymentsAppearance` | `'default'` | No | `default`, `transparent` | Outer shell. Independent of `theme`. `transparent` removes built-in card chrome. |
| `visualStyle` | `EasyPaymentsVisualStyle \| null` | `null` | No | see [Visual style](#visual-style) | Optional EP-owned font / color / token overrides. Invalid fields ignored. Does not restyle provider SDK chrome. |
| `cardButtonAppearance` | `EasyPaymentsCardButtonAppearance \| null` | `null` | No | see [Stripe Card button appearance](#stripe-card-button-appearance) | Optional label + styles for the EP-owned Stripe Card confirm CTA. Does not restyle the Payment Element iframe or wallet SDK buttons. |
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
| `pending` | `PaymentResult` (`status: 'processing'`) | PaymentIntent still settling — not success, not failure | Show “confirming…” UX; await webhook |
| `cancel` | `PaymentResult` | Customer cancelled on a path the provider reports as cancellation | Restore cart UX, messaging |
| `error` | `PaymentError` | Payment failed, or an existing configuration/availability error | Show merchant error UI |
| `methodChange` | `PaymentMethodChangeEvent` | The selected method changes | Update the surrounding page |
| `successContinue` | `PaymentResult` | Customer clicks **Continue** on the built-in success screen | Only when `successBehavior` is `confirmation` |

`success`, `cancel`, `error`, and `successContinue` keep their existing names and payload fields. `started`, `methodChange`, and optional `pending` are additive.

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

`success` still fires only after the existing provider flow confirms success. PayPal `success` fires after capture, not when the order is created. Stripe card, Google Pay, and Apple Pay `success` fires for PaymentIntent statuses `succeeded` and `requires_capture`.

#### Pending / processing payments

A PaymentIntent that is still `processing` after confirm (Card, Google Pay, Apple Pay, Klarna, Affirm) is **not** `success` and is **not** treated as a definitive failure.

| Channel | Behavior |
|---------|----------|
| Optional `pending` output | Emits a `PaymentResult` with `status: 'processing'`. |
| `success` / `error` / `cancel` | Not emitted for this outcome. |
| UI | Full checkout keeps the processing screen (no Try again). Buttons Only locks further payment attempts on that host. |
| Retry | Blocked for that attempt so the buyer cannot double-submit. |

**Merchant responsibility:** listen for `pending` if you show in-app status, and always confirm the final outcome on your backend (Stripe webhooks such as `payment_intent.succeeded` / `payment_intent.payment_failed`, plus your own order state). Easy Payments never auto-retries a payment that may already have been submitted.

`error` still uses `PaymentError` and its stable `code`. A declined card uses `CARD_DECLINED` or `PAYMENT_FAILED`, depending on the existing mapper. Configuration failures such as `SDK_LOAD_FAILED` still use `error` and do not emit `cancel` or `started`. An availability refresh error still uses the existing `error` output and is not a payment attempt.

`cancel` fires when the existing flow reports cancellation: mock cancellation, PayPal `onCancel`, a Stripe or wallet result with status `cancelled`, or `PAYMENT_CANCELLED`. A configuration failure is not a cancellation. Easy Payments does not invent a cancellation for a provider that only reports a generic dismissal or load failure.

`methodChange` fires when the selected method actually changes, including the first selection and when the current method is removed or becomes unavailable. Choosing the method that is already selected does not fire it again. `provider` is null when `method` is null.

Duplicate terminal callbacks for the same attempt are ignored after the first `success`, `cancel`, `error`, or `pending` that belongs to that attempt. Callbacks after the component is destroyed are ignored.

Diagnostics stay separate. A payment failure does not change `EasyPaymentsDiagnosticsService` readiness, and a readiness update does not emit `started` or `cancel`.

These payloads omit PaymentIntent client secrets, secret keys, PayPal client secrets, access tokens, authorization headers, raw SDK bodies, and card data. `PaymentResult.metadata` remains whatever the existing provider result already included. Do not log `PaymentError.message` if a backend or SDK may have put sensitive text there; log `code` instead.

> There is **no** public `busyChange` output on `<easy-payments>` in v1.0.0. Processing locks the checkout UI internally; use the visible processing screen and the events above. See [payment-flow.md](./payment-flow.md).

---

## Component: `<easy-payment-buttons>`

Standalone **Payment Buttons Only** host. Selector: `easy-payment-buttons`.

Lightweight alternative to `<easy-payments>`: **no** product summary, checkout title, method tiles, repeated amounts, DEMO badges inside buttons, or checkout card shell. The merchant owns product/price UI; Easy Payments renders a compact payment **button strip** (horizontal or vertical) plus one shared expanded region for Card / Klarna / Affirm.

Brand marks / official SDK buttons identify each method — the strip does **not** repeat the provider name beside the logo. When mock methods are present, a **single** notice appears above the strip (`buttonsDemoModeNotice`), not a badge on every button.

The demo playground at `http://localhost:4200/` can switch between Full Checkout and Payment Buttons Only with live `[buttonsAppearance]` controls and a copyable Angular example. Multi-instance stress QA remains at `/?ep_qa=multi` (lazy-loaded).

Method order is exactly the developer `[methods]` array (one to six of: `apple-pay`, `google-pay`, `paypal`, `card`, `klarna`, `affirm`).

Configure providers with existing `provideEasyPayments(...)` — there is no competing `[config]` input.

### Buttons Only vs full checkout

| | `<easy-payments>` | `<easy-payment-buttons>` |
|--|-------------------|--------------------------|
| Product / total UI | Built-in summary | Merchant-owned (not rendered) |
| Method chrome | Selection tiles + detail panels | Compact strip + one shared panel |
| Host fill | Theme / `appearance` / `visualStyle` | Transparent by default (`buttonsAppearance.background` optional) |
| Wallet buttons | In checkout detail / express slots | Official SDK buttons in the strip |
| Card / Klarna / Affirm | Per-method panels under tiles | Selectors in strip → **one** panel **below the entire strip** |
| Outcome UI | Optional built-in confirmation / error screens | **Event-driven only** — no success/error/cancel/pending banners inside the component |

### Live methods (Phase 4 Step 4 — strip redesign)

| Method | Behavior |
|--------|----------|
| `apple-pay` | Official Stripe Express Checkout Element Apple Pay button in the strip (`compact`). No extra Pay CTA. |
| `google-pay` | Official Google Pay button in the strip. `compact` uses `buttonType: 'short'` (logo only). Google's `plain`/`pay`/`buy` types can be swapped by pay.js for a personalized card-info button (saved card art, min-width 240px) for signed-in Chrome users when Google enables its server-side dynamic-button flags; `short` is excluded from that swap. Full checkout keeps `buttonType: 'pay'`. No extra Pay CTA. |
| `paypal` | Official PayPal Buttons SDK in the strip (`compact`) with `fundingSource: 'paypal'` and `style.height: 40` (number — the SDK rejects strings) so exactly one PayPal button appears. Full checkout still shows all eligible funding sources (e.g. Pay Later) when the SDK offers them. |
| `card` | Compact library-owned selector with a visible **Card** label (generic icon alone is not enough). Selected state uses an opaque fill so contrast does not depend on the page behind the strip. Selecting Card opens the Stripe Payment Element in the **shared panel below the strip** with wallets/Link disabled (`wallets.link: 'never'`) so the traditional card fields appear. The panel's **Pay with card** button is the explicit confirmation Stripe requires after details are entered; selection never charges. |
| `klarna` | Compact selector → shared panel below the strip (Stripe BNPL). **Continue to Klarna** confirms and redirects. Selection does not start payment. |
| `affirm` | Compact selector → shared panel below the strip (Stripe BNPL). **Continue to Affirm** confirms and redirects. Selection does not start payment. |

Horizontal strips give every slot the same width (`160px` default, or `buttonsAppearance.buttonWidth`) and wrap; slots never stretch to fill a row. Narrow containers switch to two columns, then one.

Unavailable methods are collapsed out of the strip (no space, `aria-hidden`), and separators only sit between visible slots. Apple Pay's Express Checkout Element stays mounted while collapsed so a later eligibility result can reveal it. When no requested method is available, one `role="status"` message is shown. In Demo Mode the panel CTA reads **Complete demo payment**. Card / Apple Pay / Google Pay / Klarna / Affirm share Stripe publishable-key + create-payment dependencies; PayPal does not.

#### PayPal readiness

Live PayPal requires `providers.paypal.clientId` plus backend `paypalCreateOrderUrl` and `paypalCaptureOrderUrl` (same contracts as `<easy-payments>`). Amounts remain server-authoritative on create/capture.

#### Google Pay readiness

Live Google Pay requires `providers.googlePay` (TEST or PRODUCTION), a Stripe **publishable** key (`pk_…`), and backend `createPaymentUrl`. `isReadyToPay` must succeed in the buyer browser. PRODUCTION also requires a real Google `merchantId`. A Google Pay TEST token is **not** proof of a completed charge — `success` fires only after Stripe confirmation of the PaymentIntent.

#### Apple Pay readiness

Live Apple Pay requires `providers.applePay`, a Stripe **publishable** key, and backend `createPaymentUrl`. The merchant domain must be registered/verified with Apple Pay via Stripe (same production requirement as Ready-to-Use Checkout). The ECE is created with `paymentMethods.applePay: 'always'` and other wallets set to `never`, so Google Pay / Link / etc. are not shown in the Apple Pay slot. Wallet eligibility is decided by Stripe’s ECE `ready` event — mounting alone is not “available.” `success` fires only after Stripe PaymentIntent confirmation, never on ECE render or wallet authorization alone.

#### Klarna / Affirm readiness

Live Klarna requires `providers.klarna`, a Stripe **publishable** key, and backend `klarnaCreatePaymentUrl`. Supported presentment currencies include USD, EUR, GBP, CAD, AUD, SEK, NOK, and DKK (same adapter rules as Ready-to-Use Checkout). Live Affirm requires `providers.affirm`, a Stripe **publishable** key, backend `affirmCreatePaymentUrl`, USD or CAD, and a minimum about **$35** total (`amount * quantity`). Enabling the provider in config does **not** guarantee financing for every buyer or cart — Stripe/provider eligibility still applies. Do not treat PaymentIntent creation, a redirect URL, or a browser return as success.

#### Klarna / Affirm redirects

Klarna and Affirm may redirect the buyer. Return URLs are stamped with `ep_method=klarna|affirm` and a random, non-secret `ep_attempt` token. A `sessionStorage` marker records method, product id, attempt token, host kind (`checkout` or `buttons`), and a **stable `checkoutInstanceId`**. It never stores secrets. After return, the shared `StripeRedirectRecoveryService` hands the return to exactly one host, which retrieves the PaymentIntent and emits `success` / `pending` / `cancel` / `error`. **Pending/processing** outcomes are **not** emitted as `success`. Duplicate terminal events after reload are suppressed.

**Stable identity (recommended on multi-host pages).** Set optional `[checkoutInstanceId]` to a merchant-stable string that is the same before redirect and after return (for example your cart or checkout session id). Ownership then survives host reorder, conditional render, and `@defer` / delayed mount. Auto-generated ids work within a single SPA lifetime but do **not** survive a full-page Stripe redirect reload — use a merchant id when more than one host can show the same product.

**Return ownership.** Only the host that started the redirect recovers it. Other hosts revert silently and emit nothing. Easy Payments never guesses an owner:

| Situation | Behavior |
|-----------|----------|
| `ep_attempt` matches and marker `checkoutInstanceId` matches a live host | That host recovers (preferred; order-independent). |
| Marker has `checkoutInstanceId` but that host is not mounted yet | Waits. A later mount with the same id recovers it. Dev-mode warning `STRIPE_RETURN_OWNER_NOT_MOUNTED`. |
| Legacy marker with kind + ordinal only (no instance id) | Matches that kind/product/ordinal if still present; otherwise waits. |
| `ep_attempt` does not match the marker (stale or replayed URL) | Not recovered. URL params cleared; newer marker kept. `STRIPE_RETURN_UNATTRIBUTED (STALE_ATTEMPT)`. |
| Legacy return without `ep_attempt` and exactly one eligible host | That host recovers (1.1 behavior). |
| Legacy return without `ep_attempt` and several eligible hosts | Not recovered (no events). `STRIPE_RETURN_UNATTRIBUTED (AMBIGUOUS_HOSTS)`. |

When a return is not recovered, no payment events are emitted. Confirm status on your backend.

#### Mock mode

When `enableMockMode` is true, live Stripe / PayPal / Google Pay / Apple Pay SDKs are **not** loaded for those methods. Clearly labeled **Demo** strip stand-ins appear for wallets; Card / Klarna / Affirm still expand the shared panel below the strip. Mock controls are never shipped as production wallet replacements and do not call payment endpoints.

### Inputs

| Property | Type | Default | Required | Description |
|----------|------|---------|----------|-------------|
| `product` | `PaymentProduct` | — | **Yes** | Payment context for adapters/backends. **Not** rendered as a product summary in Buttons Only. |
| `methods` | `PaymentMethod[]` | all six methods | No | Allow-list **and** exact visual order. |
| `checkout` | `CheckoutOptions` | `undefined` | No | Optional checkout hints (including BNPL return URL context). |
| `checkoutInstanceId` | `string \| null` | `null` | No | Optional stable id for multi-host redirect ownership (same rules as `<easy-payments>`). |
| `layout` | `EasyPaymentButtonsLayout` | `'vertical'` | No | `horizontal` (wraps) \| `vertical` (stacks). |
| `buttonsAppearance` | `EasyPaymentButtonsAppearance \| null` | `null` | No | Strip presentation: `gap`, `separators` (`none`\|`line`), `separatorColor`, `background` (default transparent), `border` (`default`\|`none`), `borderColor`, `borderWidth`, `borderRadius`, `buttonHeight`, `buttonWidth`, `buttonMinWidth`. Applies to **library-owned** selectors/placeholders; official SDK buttons keep provider branding. |
| `theme` | `PaymentTheme` | `'system'` | No | `light` \| `dark` \| `system`. |
| `locale` | `EasyPaymentsLocale` | `'auto'` | No | `en` \| `es` \| `pt` \| `auto` (same resolver as checkout). French (`fr`) is planned for Phase 5 — not implemented yet. |
| `translations` | `EasyPaymentsTranslationOverrides` | `{}` | No | Partial overrides for library-owned strings. |
| `visualStyle` | `EasyPaymentsVisualStyle \| null` | `null` | No | EP-owned color/font/radius/spacing tokens. Host fill stays transparent; use `buttonsAppearance.background` for an optional strip fill. Provider SDK chrome is not restyled. |
| `cardButtonAppearance` | `EasyPaymentsCardButtonAppearance \| null` | `null` | No | Same Stripe Card CTA API as Full Checkout. Applied to the expanded Card panel confirm button. |

### Localization notes

- Library-owned Card labels, expanded confirm CTAs, loading/unavailable status, errors, and mock Demo chrome follow `locale` / `translations`.
- Provider SDKs (Stripe Elements, PayPal, Apple Pay, Google Pay) use their own supported locale mapping where available — they are not guaranteed to match EP copy 1:1.
- Runtime locale changes update EP-owned text without starting a payment. Active Stripe sessions follow existing remount rules.

### Event-driven outcomes (host-owned UI)

`<easy-payment-buttons>` is an **event-driven payment strip**. It does **not** render application-level success, failure, cancel, or pending banners. The host application owns those surfaces (toasts, modals, confirmation pages, or route navigation).

Still rendered inside Buttons Only (payment-form UI, not app outcomes):

- Stripe Payment Element validation and provider-required messages
- Secure authentication challenges (for example 3DS)
- Required confirm CTAs (`Pay with card`, `Continue to Klarna`, `Continue to Affirm`)
- Accessible loading / busy states and retry safeguards after `error` / `cancel`
- Provider initialization diagnostics needed for safe operation

`<easy-payments>` (Full Checkout) may keep its built-in outcome screens. That behavior is unchanged.

**Fulfillment rules**

- Treat `success` as a confirmed provider/backend result for that attempt — never as selection, SDK mount, or redirect return alone.
- Treat `pending` as **not completed**. Do not fulfill the order; await your backend / webhooks (`payment_intent.succeeded`, `payment_intent.payment_failed`, PayPal capture webhooks, and your own order state).
- Backend / webhook verification remains required before shipping or unlocking entitlements.

### Outputs

Same payload types as `<easy-payments>`:

| Output | When it fires |
|--------|----------------|
| `methodChange` | **Card / Klarna / Affirm:** buyer selects or clears the method (selection ≠ payment). **PayPal / Google Pay / Apple Pay:** buyer engages the official button (or mock strip control). Not fired on SDK mount alone. |
| `started` | **Card / Klarna / Affirm:** buyer confirms in the shared panel. **PayPal:** order creation begins. **Google Pay:** official button click. **Apple Pay:** ECE confirm attempt (not on `ready`). Not fired for redirect return recovery. |
| `success` / `cancel` / `error` | After provider (or mock) confirmation outcome. PayPal `success` only after **capture**. Card / Google Pay / Apple Pay / Klarna / Affirm `success` only after Stripe **confirm** (or verified retrieve after redirect). |
| `pending` | PaymentIntent still `processing` after confirm or return retrieve. Not success and not a definitive failure. Host locks retry; await backend/webhook. |

Duplicate terminal events for one attempt are suppressed. Destroyed hosts emit nothing from stale provider callbacks. After an `error` or `cancel`, the buyer can retry from the same host. After `pending`, retry stays locked.

### Shared orchestrator note

`<easy-payment-buttons>` and `<easy-payments>` share the root `PaymentOrchestratorService` and provider adapters, but per-payment state is owned by each host:

- **Card, Klarna, Affirm:** each host has its own Payment Element session and PaymentIntent client secret. Mounting, destroying, or confirming on one host never touches a sibling's element or PaymentIntent.
- **PayPal:** each host creates and captures its own order. Two hosts may create or capture different orders at the same time. The same order is never captured twice. Cancel reports the host's own order id.
- **Google Pay / Apple Pay:** busy state and mounts are per host. Apple Pay availability is tracked per product session, and every host receives availability updates.
- **One Stripe confirmation per page at a time.** Card, Klarna, Affirm, Google Pay, and Apple Pay share one Stripe account and the buyer's attention, so only one Stripe confirmation can be in flight on the page. A second host that tries to confirm meanwhile gets `error` with code `PROVIDER_UNAVAILABLE` ("Another payment is already being confirmed on this page…") on **that** host only. Nothing is sent to Stripe for it, and the first payment is unaffected. The buyer can retry after the first payment finishes. Easy Payments never retries a payment automatically. PayPal is not part of this rule.
- Adapter initialization runs once even when many hosts mount together. A provider that fails to initialize is unavailable on every host, without disabling other providers.

Visible method lists and ordering remain instance-local via `CheckoutAvailabilitySession`.

### Example

```typescript
import { Component } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { provideHttpClient } from '@angular/common/http';
import {
  provideEasyPayments,
  EasyPaymentButtonsComponent,
  PaymentError,
  type EasyPaymentButtonsAppearance,
  type PaymentMethodChangeEvent,
  type PaymentProduct,
  type PaymentResult,
  type PaymentStartedEvent,
} from '@easy-payments/angular';

bootstrapApplication(App, {
  providers: [
    provideHttpClient(),
    provideEasyPayments({
      // providers + backend URLs — same config as full checkout
    }),
  ],
});

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [EasyPaymentButtonsComponent],
  template: `
    <!-- Merchant-owned product / total UI goes here -->

    <easy-payment-buttons
      [product]="product"
      [methods]="methods"
      layout="horizontal"
      theme="system"
      locale="en"
      [buttonsAppearance]="buttonsAppearance"
      checkoutInstanceId="cart-session-123"
      (started)="onStarted($event)"
      (methodChange)="onMethodChange($event)"
      (success)="onSuccess($event)"
      (cancel)="onCancel($event)"
      (error)="onError($event)"
      (pending)="onPending($event)"
    />

    <!-- Host-owned outcome UI (toast, modal, route, etc.) — not part of the library -->
    @if (hostMessage) {
      <p role="status">{{ hostMessage }}</p>
    }
  `,
})
export class App {
  readonly product: PaymentProduct = {
    id: 'sku-1',
    name: 'Premium Plan',
    amount: 49,
    currency: 'USD',
  };

  readonly methods = ['apple-pay', 'google-pay', 'paypal', 'card', 'klarna', 'affirm'] as const;

  readonly buttonsAppearance: EasyPaymentButtonsAppearance = {
    gap: '12px',
    separators: 'none',
    background: 'transparent',
    border: 'default',
    borderRadius: '10px',
  };

  hostMessage: string | null = null;

  onStarted(event: PaymentStartedEvent): void {
    this.hostMessage = `Started ${event.method}`;
  }

  onMethodChange(event: PaymentMethodChangeEvent): void {
    this.hostMessage = `Method ${event.previousMethod ?? 'none'} → ${event.method ?? 'none'}`;
  }

  onSuccess(result: PaymentResult): void {
    // Confirmed provider/backend result for this attempt — still verify webhooks before fulfillment.
    this.hostMessage = `Success · ${result.method}${
      result.transactionId ? ` · ${result.transactionId}` : ''
    }`;
  }

  onCancel(result: PaymentResult): void {
    this.hostMessage = `Cancelled · ${result.method}`;
  }

  onError(error: PaymentError): void {
    this.hostMessage = `Error · ${error.method ?? 'unknown'} · ${error.code}`;
  }

  onPending(result: PaymentResult): void {
    // Not completed — do not fulfill; await backend/webhook.
    this.hostMessage = `Pending · ${result.method} · await webhook`;
  }
}
```

Each instance uses a local `CheckoutAvailabilitySession`. `EasyPaymentsDiagnosticsService` remains global / last-refresh.

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

### Stripe Card button appearance

Optional `[cardButtonAppearance]` customizes the **Easy Payments–owned** Stripe Card confirmation button (`.ep-stripe-card__pay`) used by both `<easy-payments>` and `<easy-payment-buttons>`. It does **not** restyle the Stripe Payment Element iframe or official PayPal / Google Pay / Apple Pay buttons.

```ts
interface EasyPaymentsCardButtonAppearance {
  label?: string;
  backgroundColor?: string;
  textColor?: string;
  fontFamily?: string;
  fontSize?: string;
  fontWeight?: string | number;
  textAlign?: 'left' | 'center' | 'right' | 'start' | 'end';
  border?: 'default' | 'none';
  borderWidth?: string;
  borderStyle?: string;
  borderColor?: string;
  borderRadius?: string;
  minHeight?: string;
  width?: string;
  padding?: string;
  hoverBackgroundColor?: string;
  hoverTextColor?: string;
  disabledBackgroundColor?: string;
  disabledTextColor?: string;
  loadingBackgroundColor?: string;
  loadingTextColor?: string;
  focusOutlineColor?: string;
  focusOutlineWidth?: string;
  focusOutlineOffset?: string;
}
```

| Field | Maps to | Notes |
|-------|---------|--------|
| `label` | (text content) | Plain text only. Overrides idle localized label (`Pay {{amount}}` / `Pay with card`). Processing copy stays i18n. |
| `backgroundColor` | `--ep-card-cta-bg` | Falls back to theme `--ep-cta-bg`. |
| `textColor` | `--ep-card-cta-text` | Falls back to `--ep-cta-text`. |
| `fontFamily` | `--ep-card-cta-font-family` | Stack, `'inherit'`, or `var(--token)`. |
| `fontSize` | `--ep-card-cta-font-size` | CSS length. |
| `fontWeight` | `--ep-card-cta-font-weight` | Number or keyword. |
| `textAlign` | `--ep-card-cta-text-align` | `left` \| `center` \| `right` \| `start` \| `end`. |
| `border` | (shortcut) | `'none'` forces no border; `'default'` keeps library defaults unless individual border fields are set. |
| `borderWidth` / `borderStyle` / `borderColor` | `--ep-card-cta-border-*` | Ignored when `border: 'none'`. |
| `borderRadius` | `--ep-card-cta-radius` | CSS length. |
| `minHeight` | `--ep-card-cta-min-height` | CSS length. |
| `width` | `--ep-card-cta-width` | Length or `%`; capped by `max-width: 100%`. |
| `padding` | `--ep-card-cta-padding` | 1–4 CSS length tokens. |
| `hoverBackgroundColor` / `hoverTextColor` | `--ep-card-cta-hover-*` | Enabled hover / active. |
| `disabledBackgroundColor` / `disabledTextColor` | `--ep-card-cta-disabled-*` | Overrides muted color-mix defaults. |
| `loadingBackgroundColor` / `loadingTextColor` | `--ep-card-cta-loading-*` | While `aria-busy="true"`. |
| `focusOutlineColor` / `focusOutlineWidth` / `focusOutlineOffset` | `--ep-card-cta-focus-*` | `:focus-visible` outline. |

**Defaults without customization**

- Light: dark slate CTA (`#0f172a` / `#f8fafc`).
- Dark: accent-mixed high-contrast CTA with light text (`--ep-cta-*` uses `--ep-accent`).
- System: follows the resolved light/dark theme.
- Idle labels stay localized until a valid `label` is provided.

**Safety**

- Values are sanitized; invalid / unsafe CSS is ignored (no stylesheet injection).
- Overrides are host-bound on the Stripe Card instance (multi-instance safe).
- Payment confirmation, validation, loading/disabled behavior, and events are unchanged.

```html
<easy-payments
  [product]="product"
  [methods]="['card']"
  theme="dark"
  [cardButtonAppearance]="{
    label: 'Pay securely',
    backgroundColor: '#111827',
    textColor: '#f8fafc',
    border: 'none',
    borderRadius: '8px',
    fontWeight: 700
  }"
/>
```

```html
<easy-payment-buttons
  [product]="product"
  [methods]="['card', 'paypal']"
  [cardButtonAppearance]="cardButtonAppearance"
/>
```

See [configuration.md](./configuration.md#stripe-card-button-appearance) for recipes and contrast notes.

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
- `EasyPaymentButtonsComponent`, `EasyPaymentButtonsLayout`, `EasyPaymentButtonsAppearance`, `EasyPaymentButtonSlot`, `EasyPaymentButtonSlotState`
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

## Multi-instance limitations

- Prefer one intentional checkout experience per product page when possible. Many hosts are supported, but wallets and BNPL still share one buyer attention and one Stripe confirmation gate per page.
- For Klarna/Affirm redirects on multi-host pages, set `[checkoutInstanceId]` to a merchant-stable value that is identical before and after return.
- Auto-generated host ids do not survive a full-page Stripe redirect reload.
- Card 3DS returns without `ep_method` are not recovered by the BNPL return path (existing behavior).
- Final asynchronous settlement is always your backend’s job (webhooks / retrieve), especially after a `pending` event.

---

## Demo multi-instance QA harness

Development-only page in the Angular demo app (not exported from `@easy-payments/angular`).

1. Run the demo (`npx ng serve demo` or your usual demo command) with **Demo Mode**.
2. Open `http://localhost:4200/?ep_qa=multi` (port may vary). The harness is **lazy-loaded** only for that query — the normal playground does not include it in the initial bundle.
3. Use the left panel to switch scenarios (1 host, 10 hosts, 5+5, layouts/themes, destroy/recreate, unavailable methods).
4. Mock pay controls exercise success / fail / cancel without live credentials.
5. Exit with the link back to `/` (or remove `ep_qa=multi`).

---

## Manual live-provider validation checklist

Unit tests use mocks and do not prove live provider behavior. Before production:

- [ ] Stripe TEST Card confirm + optional 3DS
- [ ] Klarna TEST redirect round-trip with one host and with two hosts using distinct `checkoutInstanceId` values
- [ ] Affirm TEST redirect round-trip (same)
- [ ] Google Pay TEST sheet on a supported browser/device
- [ ] Apple Pay on Safari with a Stripe-verified domain
- [ ] PayPal Sandbox create + capture on two concurrent hosts
- [ ] Confirm webhooks update order state when the UI emitted `pending`

---

## Related docs

- [Configuration recipes](./configuration.md)
- [Backend contract](./backend.md)
- [Security](./security.md)
- [Providers](./providers/)
