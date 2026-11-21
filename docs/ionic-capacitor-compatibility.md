# Ionic + Capacitor compatibility

Validation of `@easy-payments/angular` inside a **minimal Ionic Angular + Capacitor** consumer that installs the **built npm package** (not the workspace source). The smoke app lives at [`examples/ionic-capacitor-smoke/`](../examples/ionic-capacitor-smoke/) and is **not** part of the published package.

## Versions tested

| Stack | Version |
|-------|---------|
| Easy Payments | `@easy-payments/angular@1.2.1` (from `npm run build:lib` → sync into smoke `vendor/`) |
| Angular (library workspace build) | **22.1.5** |
| Angular (Ionic smoke app) | **22.1.5** (aligned; see note below) |
| Ionic Framework | `@ionic/angular` **9.0.x** |
| Capacitor | **8.6.2** (`@capacitor/core`, `@capacitor/android`, `@capacitor/app`, …) |
| Android WebView (emulator) | Chrome WebView **156.0.8078.50** |
| Node | 24.x |
| TypeScript (smoke) | ~6.0 |

**Angular minor alignment:** Consuming a library built with Angular 22.1 from an app on 22.2 can fail TypeScript with `InputSignal` brand mismatches (`__ɵINPUT_SIGNAL_BRAND_WRITE_TYPE`). Keep the Ionic app on the **same Angular minor** as the package build, or rebuild the library against the app’s Angular version.

## Smoke app

```bash
# From repo root
npm run build:lib
cd examples/ionic-capacitor-smoke
npm run sync:lib          # physical copy → vendor/easy-payments (avoids dual @angular/core)
npm install --legacy-peer-deps
# Mock (default environment.ts)
npx ng serve --port 4201 --host 127.0.0.1

# Sandbox (TEST keys only — copy environment.local.example.ts → environment.local.ts)
npx ng serve --configuration=sandbox --port 4201 --host 127.0.0.1
```

Playwright mock surfaces: `npx playwright test` (expects serve on `http://127.0.0.1:4201`).

### Why `vendor/` (not `file:../../dist`)

Linking `file:../../dist/easy-payments` makes the application builder resolve `@angular/core` from the **monorepo root** (realpath of the package) while the app resolves Angular from `examples/ionic-capacitor-smoke/node_modules`. The production Capacitor bundle then embeds **two** copies of `@angular/core` (`injectInjectorOnly` + `injectInjectorOnly2`) and DI throws **NG0203** on Android WebView.

`scripts/sync-easy-payments-package.mjs` copies `dist/easy-payments` into `vendor/easy-payments` so resolution stays inside the smoke app. `angular.json` also sets `preserveSymlinks: true`.

### Android emulator

```bash
export ANDROID_HOME=…   # Windows: %LOCALAPPDATA%\Android\Sdk
npx ng build --configuration=development
npx cap sync android
# Prefer gradle + adb when `cap run` flaky:
cd android && ./gradlew assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
adb shell am start -n dev.easypayments.ionic.smoke/.MainActivity
```

CDP automation (after `adb forward tcp:9222 localabstract:webview_devtools_remote_<pid>`):

- `node scripts/cdp-smoke-check.mjs`
- `node scripts/cdp-android-mock-pass.mjs`
- `node scripts/cdp-android-headless-pass.mjs`

- Emulator → host Nest API: use `http://10.0.2.2:3001` (`smoke-payments.config.ts` rewrites `127.0.0.1` / `localhost` on Android).
- `capacitor.config.ts`: `server.androidScheme: 'https'` (WebView origin `https://localhost`), `cleartext: true`, AndroidManifest `usesCleartextTraffic="true"` for local HTTP API.

## Platform results

### Browser (Chromium / `ng serve` :4201)

| Mode | Render | Method select | Mock success | Mock cancel | Mock fail |
|------|:------:|:-------------:|:------------:|:-----------:|:---------:|
| Full Checkout | Pass | Pass | Pass | Pass | Pass |
| Buttons Only | Pass | Pass | Pass* | Pass* | Pass* |
| Headless | Pass | Mounts wallet DEMO / confirm-style | Pass* | Pass* | Pass* |

\*Playwright `e2e/mock-surfaces.spec.ts`: Full success/cancel/fail + Buttons mount + Headless mount — **5/5 passed**. Buttons/Headless outcome clicks share MockPaymentController with Full.

### Android emulator (Capacitor WebView)

| Mode | Render | Method select | Mock success | Mock cancel | Mock fail |
|------|:------:|:-------------:|:------------:|:-----------:|:---------:|
| Full Checkout | Pass | Pass | Pass | Pass | Pass |
| Buttons Only | Pass | Pass | Pass | Pass | Pass |
| Headless | Pass | Wallet DEMO (PayPal) | Pass | Pass | Pass |

Verified via CDP (`scripts/cdp-android-mock-pass.mjs`) against emulator WebView after dual-Angular NG0203 fix.

| Flow | Status |
|------|--------|
| Card (Stripe TEST) | **Verified earlier** on sandbox Capacitor APK (Elements in-WebView) |
| Klarna blank surface + stuck Processing | **Library fix landed** (Element `ready` gate + visibility resume → status-check, no resume-cancel). **Still needs manual** sandbox APK confirm of Custom Tab close → resume unlock |
| Google Pay blank sheet + stuck Processing | **Library fix landed** (`abandonInFlight` + resume reconcile). **Still needs manual** on a Google-signed-in emulator/device; sheet may remain unverified inside WebView |
| Leave-app redirect (Klarna / Cash App / Affirm) | **Needs manual** public HTTPS return (App Link) or live-reload origin; cancel/resume once via `App.addListener('appUrlOpen')` |
| Zip Sandbox | **Pending** merchant `ZIP_*` credentials |

### iOS (not runnable from this Windows host)

See [iOS on macOS](#ios-on-macos-windows-cannot-run) below.

## Wallet / method matrix (Capacitor WebView)

| Method | WebView | External browser / app | Notes |
|--------|---------|------------------------|-------|
| Card | Works in WebView (Mock verified; Stripe TEST Elements expected) | 3DS may open bank UI | Stripe Payment Element |
| Google Pay | Requires Payment Request + `GOOGLE_PAY_SUPPORTED` UA **and** an origin pay.js will keep on the in-WebView Payment Request path (`http://localhost` / `http://127.0.0.1` for TEST; registered HTTPS for production) | Packaged `https://localhost` makes pay.js `window.open` `pay.google.com` → Chrome (`OR_BIBED_15`) even when `PaymentRequest` exists and user activation is true | Smoke uses `androidScheme: 'http'` (`http://localhost`). A/B: same APK WebView → native GMS for TEST control on `http://127.0.0.1`; Chrome handoff on `https://localhost`. Emulator without a Google account still shows GMS account setup, not OR_BIBED_15 |
| Apple Pay | **Not on Android**; iOS Safari / WKWebView only | Apple Pay sheet | Requires iPhone/Safari checks |
| PayPal | SDK Buttons in WebView | May open PayPal app / browser | Sandbox Client ID available; leave-app resume **manual** |
| Venmo | Often `isEligible()===false` in the Capacitor WebView even when Chrome on the same device works | Smoke Sandbox: **Continue with Venmo** → Nest `POST /api/payments/paypal/venmo/handoff` creates Orders v2 with `payment_source.venmo` (catalog amount) and binds the attempt. If Sandbox returns `payer-action`/`approve`, Chrome opens that URL; otherwise a simplified page (product, total, official Venmo button, cancel) uses the bound order. Return reconciles via `POST .../venmo/complete` (idempotent capture) — success only after `COMPLETED`. Never invent Venmo URLs. | Config: `venmoSandboxCheckoutUrl` in gitignored `environment.local.ts`. Normal demo unchanged without smoke query |
| Klarna / Affirm / Afterpay / Cash App | Start in WebView | **Leave-app** redirect common | Return via App Links + `recoverReturn` / shared recovery — **manual** |
| US bank account | In-WebView PE | Microdeposit / bank may leave | Async `processing` |
| Zip | Pending Sandbox merchant access | Zip hosted checkout / popup | **Experimental** opt-in (not in smoke `SMOKE_METHODS`); see [zip.md](./providers/zip.md) |

## Redirects and App Links

### Browser (unchanged)

Easy Payments Stripe return URLs default to **same-origin `http(s)`** (current page when `checkout` is omitted).

| Origin | Valid? |
|--------|--------|
| `http://localhost/…` (smoke `androidScheme: 'http'`) | Yes — in-app same-origin; preferred for Google Pay TEST (avoids OR_BIBED_15) |
| `https://localhost/…` (Capacitor `androidScheme: 'https'`) | Yes for Stripe returns in-app, but Google Pay pay.js tends to hand off to Chrome (`OR_BIBED_15`) |
| `http://127.0.0.1:4201/…` (live reload) | Yes — if the device can reach the host; also OK for Google Pay TEST |
| `capacitor://…` / `ionic://…` | **No** — library rejects with an actionable `CONFIG_INVALID` message |

### Native leave-app (Klarna / Affirm / Cash App / Afterpay)

When Stripe opens **external Chrome**, `https://localhost/…` fails. Configure a **public HTTPS App Link** the smoke app owns:

1. Set `nativeStripeReturnUrl` in `environment.local.ts` (see `environment.local.example.ts`), e.g. `https://YOUR_DOMAIN/capacitor-return`.
2. Smoke wires `[checkout]` only on native via `resolveSmokeCheckoutOptions()` → `{ successUrl, allowExternalHttpsReturnUrl: true }`. Browser builds leave `checkout` undefined (same-origin preserved).
3. Publish Digital Asset Links + patch the Android intent-filter (below).
4. `main.ts` handles **warm** (`App.appUrlOpen`) and **cold** (`App.getLaunchUrl`) starts: validates origin/path/attempt, merges query into the WebView, runs library recovery (retrieve PaymentIntent — **never** trust `redirect_status`), dedupes callbacks, strips secrets from the URL, and never logs client secrets.
5. Prefer a stable Headless `checkoutInstanceId` for ownership after process death.

Never use live Stripe/PayPal/Zip credentials in the smoke app.

### Android App Link setup (smoke)

**Application ID:** `dev.easypayments.ionic.smoke`

#### 1) Debug signing SHA-256 (Windows PowerShell)

```powershell
# After the first debug build creates the debug keystore:
keytool -list -v -keystore "$env:USERPROFILE\.android\debug.keystore" -alias androiddebugkey -storepass android -keypass android
# Copy the SHA256: line (colon-separated hex) into assetlinks.json
```

#### 2) Publish `assetlinks.json`

Serve at `https://YOUR_DOMAIN/.well-known/assetlinks.json` (HTTPS, HTTP 200, `Content-Type: application/json`, no redirect):

```json
[{
  "relation": ["delegate_permission/common.handle_all_urls"],
  "target": {
    "namespace": "android_app",
    "package_name": "dev.easypayments.ionic.smoke",
    "sha256_cert_fingerprints": ["AA:BB:..."]
  }
}]
```

Template: `examples/ionic-capacitor-smoke/well-known/assetlinks.json.example`. Also host a simple page at `/capacitor-return` (see `capacitor-return.html.example`) for browsers that open the link before verification completes.

#### 3) Patch intent-filter + rebuild APK (Windows PowerShell)

From repo root:

```powershell
npm run build:lib
cd examples\ionic-capacitor-smoke
npm run sync:lib
# Edit src\environments\environment.local.ts → nativeStripeReturnUrl
# Edit app-links.config.json → host + pathPrefix to match
npx ng build --configuration=sandbox
npx cap sync android
node scripts\patch-android-app-links.mjs
node scripts\patch-android-google-pay-webview.mjs
cd android
.\gradlew.bat assembleDebug
adb install -r app\build\outputs\apk\debug\app-debug.apk
adb shell am start -n dev.easypayments.ionic.smoke/.MainActivity
```

#### 4) Verify App Links on the emulator

```powershell
adb shell pm get-app-links dev.easypayments.ionic.smoke
# Optional force re-verification after assetlinks.json is live:
adb shell pm verify-app-links --re-verify dev.easypayments.ionic.smoke
# Simulate a Stripe-shaped return (replace host; secrets are fake):
adb shell am start -a android.intent.action.VIEW -d "https://YOUR_DOMAIN/capacitor-return?payment_intent=pi_test&payment_intent_client_secret=pi_test_secret&ep_method=klarna&ep_attempt=testdedupe000001"
```

**Still requires a deployed domain:** live `assetlinks.json`, HTTPS `/capacitor-return` page, and Play/Digital Asset Links verification on a device/emulator with network access to that host. Local unit tests cover warm/cold/duplicate/unrelated URL decisions only.

## Host CTA gating (Headless)

Hosts that render their own Pay / Confirm control must enable it only when:

1. `session.state()` is `ready` (or recoverable `error`), and
2. the selected entry in `session.availableMethods()` has `readiness === 'ready'`.

Do **not** call `session.confirm()` for PayPal, Google Pay, Apple Pay, or Venmo — those use SDK/DEMO buttons. The Ionic smoke app gates `__epSmoke.confirmHeadless` the same way (see `home.page.ts`). While a method is still mounting, show loading copy instead of an enabled amount CTA.

Interrupted Google Pay / Klarna sheets on Android: the library reconciles on `visibilitychange` (and hosts may forward Capacitor `App.addListener('appStateChange')` to the same unlock path). Resume alone never emits `cancel`.

## Library fixes from this validation

1. **`EasyPaymentsConfigService`** — not `providedIn: 'root'`; registered by `provideEasyPayments`; constructor `@Inject(EASY_PAYMENTS_CONFIG)` (regression in `easy-payments-config.service.spec.ts`).
2. **Stripe return URL** — reject `capacitor://` / `ionic://` with a Capacitor-specific message; accept `https://localhost` WebView origin (regression tests in `stripe-redirect-return.spec.ts`).
3. Smoke host: `prebundle.exclude: ['@easy-payments/angular']`, `preserveSymlinks`, and **physical `vendor/` package copy** so Capacitor production bundles do not duplicate `@angular/core` (root cause of Android NG0203 blank WebView).
4. **CTA readiness + stuck Processing** — Payment Element mounts wait for Stripe `ready` / `loaderror` before enabling Pay; Full Checkout / Buttons scope `providerBusy` to the selected method; Klarna/GPay resume reconcile clears busy without fake cancel.
5. **Google Pay WebView Payment Request** — Capacitor defaults leave Payment Request off → `OR_BIBED_15` / Chrome handoff. Smoke enables `androidx.webkit` + manifest queries + `WebSettingsCompat.setPaymentRequestEnabled` + appends `GOOGLE_PAY_SUPPORTED` to the WebView UA. Library prefers a warmed `PaymentsClient` and does not await PaymentIntent create before `loadPaymentData` (preserves click gesture; attempt-scoped abandon / post-confirm gate unchanged). Emulator evidence: with those settings, pay.js still `window.open`s Google’s pay UI; Chrome shows `OR_BIBED_15`. Google also requires publishing the Android app integration in Pay & Wallet Console before the native in-WebView sheet is allowed.
6. **Full Checkout PE concurrency** — Mount only the selected Stripe Payment Element panel (Klarna / Affirm / Afterpay / Cash App / Card / ACH). Concurrent inactive mounts caused `SDK_LOAD_FAILED` ready timeouts; selected method can remount via in-panel Try again after load failure. Host-owned Klarna App Link recovery unchanged.

## iOS on macOS (Windows cannot run)

Exact reproduce steps on a Mac with Xcode:

1. Install Xcode (26+ for Capacitor 8) and CocoaPods.
2. From `examples/ionic-capacitor-smoke`:
   ```bash
   npm run build:lib   # from repo root first
   npm run sync:lib
   npm install --legacy-peer-deps
   npx ng build --configuration=development
   npx cap add ios
   npx cap sync ios
   npx cap open ios
   ```
3. In Xcode: select an **iPhone simulator** or a physical device; enable the Team/signing for `dev.easypayments.ionic.smoke`.
4. Run the app; repeat Mock Full / Buttons / Headless success, cancel, fail.
5. For sandbox Card + one leave-app method (Klarna or Cash App), point Nest at a tunnel the simulator can reach; configure Universal Links for the return host.

### Checks that require a physical iPhone

- **Apple Pay** availability and payment sheet (Simulator Apple Pay is limited / often unavailable).
- Wallet provisioning and Face ID / Touch ID payment confirmation.
- Universal Links open-from-Safari → app resume with Stripe return query (simulator can approximate; device is authoritative).
- Venmo / Cash App installed-app switch behavior.

## What still needs manual verification

- Stripe TEST Card + one leave-app provider on Android emulator (sandbox config + Nest + App Link or reachable return URL); cancel and resume once.
- iOS Simulator Mock pass on macOS.
- iPhone Apple Pay + Universal Link leave-app resume.
- Zip Sandbox end-to-end (pending merchant portal credentials).
- Production App Links domain association files (`assetlinks.json` / `apple-app-site-association`).
- Google Pay sheet availability on a signed-in emulator / device WebView.
