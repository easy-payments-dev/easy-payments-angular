# Ionic + Capacitor smoke (not published)

Minimal Ionic Angular 9 + Capacitor 8 app that consumes the **built** `@easy-payments/angular` package via a **physical** `vendor/easy-payments` copy (not a `file:../../dist` symlink — that duplicates `@angular/core` in Capacitor production bundles and causes NG0203).

See **[docs/ionic-capacitor-compatibility.md](../../docs/ionic-capacitor-compatibility.md)** for versions, platform results, redirects, and iOS steps.

```bash
# repo root
npm run build:lib
cd examples/ionic-capacitor-smoke
npm run sync:lib
npm install --legacy-peer-deps
npx ng serve --port 4201 --host 127.0.0.1
```

Sandbox: copy `src/environments/environment.local.example.ts` → `environment.local.ts`, then `npx ng serve --configuration=sandbox --port 4201`.

**Browser BNPL returns** keep using the current page (omit `checkout`). **Android leave-app** (Klarna etc.) needs `nativeStripeReturnUrl` + App Links — see [docs/ionic-capacitor-compatibility.md](../../docs/ionic-capacitor-compatibility.md#native-leave-app-klarna--affirm--cash-app--afterpay).

Android (Mock / in-WebView):

```bash
npx ng build --configuration=development
npx cap sync android
cd android && ./gradlew assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

Android sandbox with App Links (PowerShell) — after setting `nativeStripeReturnUrl` + `app-links.config.json`:

```powershell
npx ng build --configuration=sandbox
npx cap sync android
node scripts\patch-android-app-links.mjs
cd android; .\gradlew.bat assembleDebug
adb install -r app\build\outputs\apk\debug\app-debug.apk
```

CDP helpers (after `adb forward tcp:9222 localabstract:webview_devtools_remote_<pid>`): `scripts/cdp-*.mjs`.
