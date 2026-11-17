import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Smoke app Capacitor config.
 * - androidScheme http → WebView origin `http://localhost` so Google Pay TEST can use
 *   the in-WebView Payment Request / GMS path. Packaged `https://localhost` makes pay.js
 *   `window.open` pay.google.com (OR_BIBED_15) even with PaymentRequest enabled — proven by
 *   A/B: same APK WebView opens native GMS for http://127.0.0.1 control, Chrome handoff
 *   for https://localhost Ionic. Leave-app BNPL still uses public HTTPS App Links.
 * - cleartext true → allow http://10.0.2.2:3001 Nest API from the Android emulator.
 * For leave-app BNPL returns, set environment.nativeStripeReturnUrl to a public
 * HTTPS App Link, run scripts/patch-android-app-links.mjs after cap sync, and
 * publish assetlinks.json (see docs/ionic-capacitor-compatibility.md).
 */
const config: CapacitorConfig = {
  appId: 'dev.easypayments.ionic.smoke',
  appName: 'ionic-capacitor-smoke',
  webDir: 'www',
  server: {
    androidScheme: 'http',
    cleartext: true,
  },
  android: {
    allowMixedContent: true,
  },
};

export default config;
