# Demo & Example Application

The repository includes a full Angular playground that embeds `<easy-payments>`.

**No public hosted demo URL** is published with v1.0.0 — run it locally.

Source: [`projects/demo`](../projects/demo)

---

## What the demo shows

- Experience switch: **Full Checkout** (`<easy-payments>`) vs **Payment Buttons Only** (`<easy-payment-buttons>`) vs **Headless Checkout** (`EasyPaymentsHeadless` session API)
- Card, PayPal, Apple Pay, Google Pay, Klarna, Affirm (availability depends on mode/config)
- Product fields (demo default **$99** USD `premium-plan`)
- Method enable/disable and **reorder**
- Theme: light / dark / system
- Appearance: default / transparent (+ preview backdrops)
- Phase 3 **Visual style QA** (`[visualStyle]` fields, presets, dual-instance theme check) — see [phase-3-visual-qa.md](./phase-3-visual-qa.md)
- `maxWidth` presets and slider (320–1200)
- Event log (`started` / `methodChange` / `success` / `cancel` / `error` / `pending`)
- **Buttons Only host outcome banner** outside the library component (demo-app UI only) — shows how a merchant can present outcomes from events
- **Demo Mode** (mocks) vs **Real / Test Providers**

---

## Run locally

From the repo root:

```bash
npm install
npm run build:lib
npm start
```

Open http://localhost:4200

### Backend (Real / Test Providers)

```bash
cd server
npm install
# copy .env.example → .env and fill TEST secrets
npm run start:dev
```

Server: http://localhost:3001

Root scripts also include:

- `npm run server:install`
- `npm run server:start`
- `npm run server:test`

---

## Frontend env (browser-safe only)

### Public / tracked

- [`environment.ts`](../projects/demo/src/environments/environment.ts) — placeholders only (`YOUR_*`)
- [`environment.example.ts`](../projects/demo/src/environments/environment.example.ts) — same placeholders for docs
- [`environment.local.example.ts`](../projects/demo/src/environments/environment.local.example.ts) — template for local overrides

### Local (gitignored)

```bash
cp projects/demo/src/environments/environment.local.example.ts ^
   projects/demo/src/environments/environment.local.ts
```

Edit `environment.local.ts` with your TEST `pk_test_...` and PayPal Sandbox Client ID.

`ng serve` / `demo:build:development` uses Angular `fileReplacements` to load `environment.local.ts` instead of the public placeholders.

Production demo builds and unit tests keep using the tracked placeholder `environment.ts`.

Never put `sk_...` or PayPal Client Secret in Angular.

---

## Educational entry points

| Concern | File |
|---------|------|
| Provider wiring | `projects/demo/src/app/app.config.ts` + Real-mode config in `app.ts` |
| Template bindings | `projects/demo/src/app/app.html` |
| Product / methods / theme / appearance / maxWidth | `projects/demo/src/app/app.ts` |
| Headless checkout panel (H5.1–H5.4) | `projects/demo/src/app/headless-demo/` |
| Placeholders | `projects/demo/src/environments/environment.example.ts` |

### Headless Checkout demo (H5.1–H5.4)

Select **Headless Checkout** in the Experience control. The panel:

- Injects public `EasyPaymentsHeadless` from `@easy-payments/angular`
- Creates a session with the playground product/methods and stable `checkoutInstanceId` `demo-headless-1`
- Shows a merchant-owned product summary and method selector
- Calls `initialize()`, then `recoverReturn()` before any new mount/payment attempt
- Mounts official Stripe Payment Element UI for **Card / Klarna / Affirm**, then pays with a merchant **Pay / Continue** control that calls `session.confirm()`
- Mounts official **PayPal / Google Pay / Apple Pay** controls (buyer click starts payment; the demo never calls `confirm()` for these)
- Displays processing / success / pending / cancelled / error, authorization-only notes, and bounded lifecycle events
- Recreates the session when product / methods / theme / locale change; defers recreate while processing, pending, or recovering, with an explicit “Apply pending configuration” action
- Unmounts provider UI and destroys the session when you leave the mode

#### Interaction model

| Method | Mount | Start payment |
|--------|-------|----------------|
| Card / Klarna / Affirm | Stripe Payment Element | Merchant button → `session.confirm()` |
| PayPal | Official PayPal Buttons | Buyer clicks PayPal |
| Google Pay | Official Google Pay button | Buyer clicks Google Pay |
| Apple Pay | Stripe Express Checkout Element | Buyer authorizes Apple Pay |

#### Redirect recovery

On Headless boot, after `initialize()`, the demo calls `recoverReturn()` for the stable `demo-headless-1` identity. Success requires Stripe retrieval via the library (not `redirect_status` alone). Transient `NETWORK_ERROR` / `SDK_LOAD_FAILED` keep correlation data and expose **Retry recoverReturn**. Null means non-owner / absent — the demo does not claim Full Checkout or Buttons Only returns.

#### Semantics

- **Pending / processing** is not success — do not retry a charge; verify backend/webhooks.
- **authorizationOnly** means authorization, not captured funds.
- Frontend Headless events are **not** authoritative fulfillment.
- Prerequisites match Real / Test Providers (Stripe TEST publishable key, PayPal Sandbox, NestJS URLs, Apple Pay domain verification where applicable).

Mock Mode still uses library mocks — it does not prove live Stripe/PayPal production readiness.

While return recovery is **retryable** (transient network/SDK failure), the demo locks method mounts and `confirm()` so a new PaymentIntent cannot start before `recoverReturn()` succeeds or the attempt is abandoned by leaving Headless.

#### Manual validation checklist (not covered by unit tests)

| Env | Preconditions | Action | Expected | Automated tests cannot prove |
|-----|---------------|--------|----------|------------------------------|
| A. Mock | Demo Mode | Select each method, confirm Card, click mock wallets | Mock outcomes / events | Real SDK chrome |
| B. Stripe TEST Card | Real mode + `pk_test_` + NestJS | Mount Card, pay test card | Success/decline matches Dashboard | Live 3DS UX |
| C. Stripe TEST Klarna/Affirm | Same + BNPL enabled | Confirm → redirect → return on Headless | `recoverReturn` matches PI; refresh no duplicate fulfill | Live bank UX |
| D. PayPal Sandbox | PayPal client id + NestJS | Official Buttons approve/capture | Capture success only after backend | Sandbox account quirks |
| E. Google Pay TEST | Stripe + supported Chrome | Official GPay button | Eligibility + charge path | Device/wallet availability |
| F. Apple Pay | Verified domain + Safari/device | ECE Apple Pay | Ready only when provider says so | Domain association |
| G. A11y/responsive | Any mode | Keyboard-only + 320–1440 widths | Focus visible, no overflow | Full WCAG audit / real devices |

Screenshots in docs were captured from this demo using browser viewport emulation (not physical device claims).
