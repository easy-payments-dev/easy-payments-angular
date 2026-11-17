/**
 * Enables Google Pay Payment Request API support in the Capacitor Android WebView.
 * Run after `npx cap sync android` (android/ is gitignored / may be regenerated).
 *
 * Applies:
 *   1) androidx.webkit dependency
 *   2) PAY / IS_READY_TO_PAY / UPDATE_PAYMENT_DETAILS <queries>
 *   3) MainActivity WebSettingsCompat.setPaymentRequestEnabled
 *
 * Usage:
 *   node scripts/patch-android-google-pay-webview.mjs
 *
 * @see https://developers.google.com/pay/api/android/guides/recipes/using-android-webview
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const androidApp = path.join(root, 'android', 'app');
const manifestPath = path.join(androidApp, 'src', 'main', 'AndroidManifest.xml');
const buildGradlePath = path.join(androidApp, 'build.gradle');
const mainActivityPath = path.join(
  androidApp,
  'src',
  'main',
  'java',
  'dev',
  'easypayments',
  'ionic',
  'smoke',
  'MainActivity.java',
);

const QUERIES_BLOCK = `
    <!--
      Google Pay / Payment Request in WebView (patched by scripts/patch-android-google-pay-webview.mjs).
      Required so WebView can discover Android payment apps instead of handing off to Chrome.
    -->
    <queries>
        <intent>
            <action android:name="org.chromium.intent.action.PAY" />
        </intent>
        <intent>
            <action android:name="org.chromium.intent.action.IS_READY_TO_PAY" />
        </intent>
        <intent>
            <action android:name="org.chromium.intent.action.UPDATE_PAYMENT_DETAILS" />
        </intent>
    </queries>
`;

const WEBKIT_DEP =
  '    // Google Pay in WebView: WebSettingsCompat.setPaymentRequestEnabled (OR_BIBED_15).\n' +
  '    implementation "androidx.webkit:webkit:$androidxWebkitVersion"\n';

const MAIN_ACTIVITY = `package dev.easypayments.ionic.smoke;

import android.os.Bundle;
import android.webkit.WebSettings;
import android.webkit.WebView;
import androidx.webkit.WebSettingsCompat;
import androidx.webkit.WebViewFeature;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;

/**
 * Enables the Payment Request API on Capacitor's WebView so Google Pay can run
 * in-WebView (avoids OR_BIBED_15 / pay.google.com Chrome handoff).
 *
 * @see https://developers.google.com/pay/api/android/guides/recipes/using-android-webview
 */
public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    enableWebViewPaymentRequest();
  }

  private void enableWebViewPaymentRequest() {
    Bridge bridge = this.bridge;
    if (bridge == null) {
      return;
    }
    WebView webView = bridge.getWebView();
    if (webView == null) {
      return;
    }
    WebSettings settings = webView.getSettings();
    settings.setJavaScriptEnabled(true);
    // Google requires this marker when the WebView UA is non-Chrome (contains "; wv)").
    // Without it, pay.js stays on the payframe/redirect path and Capacitor opens
    // pay.google.com in external Chrome (OR_BIBED_15).
    String userAgent = settings.getUserAgentString();
    if (userAgent == null) {
      userAgent = "";
    }
    if (!userAgent.contains("GOOGLE_PAY_SUPPORTED")) {
      settings.setUserAgentString(userAgent + " GOOGLE_PAY_SUPPORTED");
    }
    if (WebViewFeature.isFeatureSupported(WebViewFeature.PAYMENT_REQUEST)) {
      WebSettingsCompat.setPaymentRequestEnabled(settings, true);
    }
  }
}
`;

function requireFile(filePath, hint) {
  if (!fs.existsSync(filePath)) {
    console.error(`Missing ${filePath}. ${hint}`);
    process.exit(1);
  }
}

requireFile(manifestPath, 'Run: npx cap add android && npx cap sync android');
requireFile(buildGradlePath, 'Run: npx cap sync android');
requireFile(mainActivityPath, 'Expected Capacitor MainActivity at the smoke package path.');

// --- AndroidManifest.xml queries ---
let manifest = fs.readFileSync(manifestPath, 'utf8');
manifest = manifest.replace(
  /\s*<!--\s*\n\s*Google Pay \/ Payment Request in WebView[\s\S]*?<\/queries>\s*/g,
  '\n',
);
manifest = manifest.replace(
  /\s*<queries>\s*<intent>\s*<action android:name="org\.chromium\.intent\.action\.PAY"\s*\/>[\s\S]*?<\/queries>\s*/g,
  '\n',
);
if (!manifest.includes('org.chromium.intent.action.PAY')) {
  if (!manifest.trimEnd().endsWith('</manifest>')) {
    console.error('AndroidManifest.xml does not end with </manifest>');
    process.exit(1);
  }
  manifest = manifest.replace(/\s*<\/manifest>\s*$/, `${QUERIES_BLOCK}</manifest>\n`);
  fs.writeFileSync(manifestPath, manifest);
  console.log('Patched AndroidManifest.xml <queries> for Payment Request.');
} else {
  console.log('AndroidManifest.xml already declares Payment Request queries.');
}

// --- app/build.gradle webkit dependency ---
let gradle = fs.readFileSync(buildGradlePath, 'utf8');
if (!gradle.includes('androidx.webkit:webkit')) {
  const marker = "implementation project(':capacitor-android')";
  const idx = gradle.indexOf(marker);
  if (idx < 0) {
    console.error('Could not find capacitor-android dependency in app/build.gradle');
    process.exit(1);
  }
  gradle = gradle.slice(0, idx) + WEBKIT_DEP + gradle.slice(idx);
  fs.writeFileSync(buildGradlePath, gradle);
  console.log('Patched app/build.gradle with androidx.webkit dependency.');
} else {
  console.log('app/build.gradle already depends on androidx.webkit.');
}

// --- MainActivity Payment Request enablement ---
fs.writeFileSync(mainActivityPath, MAIN_ACTIVITY);
console.log('Wrote MainActivity.java with setPaymentRequestEnabled.');
console.log('Next: rebuild the debug APK and confirm window.PaymentRequest is defined in the WebView.');
