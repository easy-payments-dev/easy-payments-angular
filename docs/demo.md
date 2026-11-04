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
| Headless foundation panel (H5.1) | `projects/demo/src/app/headless-demo/` |
| Placeholders | `projects/demo/src/environments/environment.example.ts` |

### Headless Checkout demo (H5.1)

Select **Headless Checkout** in the Experience control. The panel:

- Injects public `EasyPaymentsHeadless` from `@easy-payments/angular`
- Creates a session with the playground product/methods and stable `checkoutInstanceId` `demo-headless-1`
- Calls `initialize()` and displays live availability + session state
- Destroys the session when you leave the mode (component teardown)

**Not in H5.1:** provider mounting, `confirm()`, `recoverReturn()`, or payment CTA UI (H5.2 / H5.3). The stable checkout id is reserved so H5.3 can demonstrate Klarna/Affirm return recovery without regenerating identity on every remount.

Screenshots in docs were captured from this demo using browser viewport emulation (not physical device claims).
