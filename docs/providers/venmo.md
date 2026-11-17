# Venmo

Opt-in Venmo for `@easy-payments/angular` — Full Checkout, Payment Buttons Only, and Headless Checkout.

Venmo reuses the **PayPal JavaScript SDK** (`enable-funding=venmo` + official Venmo Buttons with `fundingSource: 'venmo'` / `Buttons().isEligible()`) and the same **Orders v2** create/capture backend pattern as PayPal for normal browser checkout.

Official PayPal references:

- [Pay with Venmo eligibility and supported browsers](https://developer.paypal.com/v5/venmo/overview)
- [Orders API — Sample JSON order request 4: Pay with Venmo](https://developer.paypal.com/whats-an-order/)
- [Venmo Sandbox testing](https://developer.paypal.com/platforms/checkout/pay-with-venmo/test)
- [Pay with Venmo integration](https://developer.paypal.com/docs/checkout/pay-with-venmo/integrate/)

Easy Payments loads the unpinned CDN SDK already used for PayPal: `https://www.paypal.com/sdk/js` with `components=buttons`.

## Branding & Buttons Only variant

| Surface | Brand treatment |
|---------|-----------------|
| Full Checkout selector | Official Venmo wordmark (blue on light, white on dark) from PayPal Newsroom assets. Accessible name remains **Venmo**. |
| Buttons Only / Headless | Classic `paypal.Buttons({ fundingSource: 'venmo' })`. In `paypal-checkout-components`, Venmo’s `Label` returns empty, so the SDK renders a **wordmark-only** Venmo button (no “Pay with” text). Color `blue` is the official Venmo primary. Eligibility still uses `Buttons().isEligible()`. |

This repo does **not** use PayPal JS SDK v6 web components (`<venmo-button>`). The installed integration is classic CDN Buttons (`components=buttons`).

## Eligibility

| Constraint | Requirement |
|------------|-------------|
| Buyer / market | United States only |
| Currency | USD (via PayPal `providers.paypal.currency`) |
| SDK | PayPal JS Buttons + `enable-funding=venmo` |
| Backend | Same `paypalCreateOrderUrl` / `paypalCaptureOrderUrl` as PayPal for browser checkout |
| Sandbox button visibility | Optional `sandboxBuyerCountry: 'US'` (never set in production) |

## Scope

- Available only when the host opts in with `'venmo'` in `[methods]` (or Headless `methods`).
- Requires `providers.venmo` (object), PayPal `clientId`, and PayPal create/capture URLs.
- **Disabled by default** (not in Full Checkout or Buttons default method lists).
- When Venmo is configured, the shared PayPal SDK script also receives `enable-funding=venmo` so PayPal + Venmo can share one load.
- Outcomes: `method: 'venmo'`, `provider: 'venmo'`.

## Merchant configuration

```ts
provideEasyPayments({
  providers: {
    paypal: {
      clientId: 'YOUR_PAYPAL_CLIENT_ID',
      currency: 'USD',
      intent: 'capture',
    },
    // Opt in. Sandbox only: simulate a US buyer so the Venmo button can appear.
    venmo: { sandboxBuyerCountry: 'US' },
  },
  backend: {
    paypalCreateOrderUrl: 'https://api.example.com/payments/paypal/create',
    paypalCaptureOrderUrl: 'https://api.example.com/payments/paypal/capture',
  },
});
```

### Full Checkout

```html
<easy-payments
  [product]="product"
  [methods]="['card', 'paypal', 'venmo']"
  (success)="onSuccess($event)"
  (cancel)="onCancel($event)"
  (error)="onError($event)"
/>
```

Library-owned outcome UI after approval / capture.

### Payment Buttons Only

Official Venmo Buttons mount in the strip (`compact`). Outcomes are **host-owned** via events (`success` / `cancel` / `error`) — no in-strip banners.

```html
<easy-payment-buttons
  [product]="product"
  [methods]="['paypal', 'venmo']"
  (success)="onSuccess($event)"
  (cancel)="onCancel($event)"
  (error)="onError($event)"
/>
```

### Headless Checkout

Host owns placement. Mount Venmo; the buyer click starts payment. Do **not** call `session.confirm()` for Venmo (same pattern as PayPal).

```ts
const session = headless.createSession({
  product,
  methods: ['venmo'],
  // ...
});
await session.initialize();
await session.mount('venmo', containerEl);
```

## Mode support & limitations

| Mode | Supported | Notes |
|------|-----------|-------|
| Full Checkout | Yes | Official Venmo Buttons + eligibility |
| Buttons Only | Yes | Compact official button; host owns outcomes |
| Headless | Yes | Host owns mount container; button starts payment |

**Limitations**

- Venmo is US/USD only; `isEligible()` may hide the button outside eligible contexts.
- Live desktop QR checkout **cannot be tested in sandbox** (sandbox uses web login / app-switch flows instead).
- Merchant must have Venmo enabled on the PayPal account / app.
- Desktop QR and some post-purchase Venmo experiences are not sandbox-testable (see PayPal test docs).
- Full Checkout selector uses the official Venmo wordmark; Buttons Only uses the SDK’s wordmark-only Venmo funding button.

## Sandbox steps (browser)

1. Use a PayPal **Sandbox** Client ID with Venmo enabled for the app.
2. Configure `providers.venmo: { sandboxBuyerCountry: 'US' }` (demo/sandbox only).
3. Ensure backend create/capture hit PayPal Sandbox Orders API.
4. Open the demo (or your host) on a page that includes `'venmo'` in methods.
5. Confirm the official Venmo button renders (eligibility).
6. Complete approval:
   - **Desktop sandbox:** Venmo web login flow (not live QR).
   - **Mobile web with Venmo app:** app-switch when installed; otherwise web login.
7. Confirm create → approve → capture; outcomes tagged `method: 'venmo'`.
8. Cancel mid-flow and confirm a single cancel event and retryable button.
9. Optional decline amounts from PayPal’s Venmo sandbox table (`12.34` insufficient funds, etc.).

## Android Sandbox example (Ionic / Capacitor)

**Android Sandbox example** — EP Ionic smoke when Venmo is ineligible in the Capacitor WebView but Chrome on the same device can show the official button. This is **not** the normal browser checkout above.

### Two taps (shopper view)

1. **Continue with Venmo in Chrome** in the Ionic app — opens the Sandbox Venmo checkout in Chrome with a short-lived attempt id.
2. **Pay with Venmo** — the official PayPal Venmo button on that Chrome page (product, total, Venmo button, cancel). No invented Venmo URL and no auto-click of the SDK button.

### Return to Ionic

After approve or cancel, Chrome shows **Return to Ionic** (verified HTTPS App Link as `href`; Android uses an Intent so Chrome does not treat the App Link as a marketing-site web page). Ionic reconciles the same attempt and PayPal order with Nest; approval and capture stay separate; success only after a completed capture. Cancel clears the attempt; repeated returns do not emit a second success.

### Observed PayPal Sandbox Orders v2 response (current flow)

When this integration creates a Sandbox order with `payment_source.venmo`, the **observed** create-order response was:

- `status`: `PAYER_ACTION_REQUIRED`
- HATEOAS `links`: **only** `rel: "self"` (no `payer-action` or `approve` buyer URL)

Because of that observed response, the current Android Sandbox handoff **does not open a PayPal-returned approval URL**. It opens the simplified Chrome page and starts buyer approval with the **official Venmo Buttons** against the Nest-bound order. If PayPal later returns a documented `payer-action` / `approve` link for the same create shape, the handoff prefers that URL; it still never invents a Venmo destination.

Also see [Ionic / Capacitor compatibility](../ionic-capacitor-compatibility.md).

## Production checklist

- [ ] Remove `sandboxBuyerCountry` (never ship it live)
- [ ] Live PayPal Client ID + Live secret (server only)
- [ ] Venmo enabled on the Live PayPal app / account
- [ ] USD catalog pricing trusted server-side
- [ ] HTTPS

## Common problems

| Symptom | Check |
|---------|-------|
| Venmo button missing | `providers.venmo`, PayPal clientId, `enable-funding`, `isEligible()`, US buyer / sandbox `buyer-country=US` |
| SDK load fights PayPal | Both share one script; Venmo opt-in reloads with `enable-funding=venmo` |
| Capture tagged as PayPal | Use Venmo method surface (not PayPal-only Buttons) so capture uses `method: 'venmo'` |
| Ionic WebView: no Venmo button | Expected when `isEligible()` is false; use the Android Sandbox Chrome handoff example above |
