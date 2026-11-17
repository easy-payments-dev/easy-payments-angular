/**
 * Inserts a verified App Link intent-filter into AndroidManifest.xml.
 * Run after `npx cap sync android` (android/ is gitignored).
 *
 * Usage:
 *   node scripts/patch-android-app-links.mjs
 *   node scripts/patch-android-app-links.mjs --host smoke-return.example.com --path /capacitor-return
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const manifestPath = path.join(root, 'android', 'app', 'src', 'main', 'AndroidManifest.xml');
const configPath = path.join(root, 'app-links.config.json');

function argValue(name) {
  const idx = process.argv.indexOf(name);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

function loadConfig() {
  let host = argValue('--host');
  let pathPrefix = argValue('--path');
  if ((!host || !pathPrefix) && fs.existsSync(configPath)) {
    const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    host = host || cfg.host;
    pathPrefix = pathPrefix || cfg.pathPrefix;
  }
  host = (host || '').trim();
  pathPrefix = (pathPrefix || '/capacitor-return').trim() || '/capacitor-return';
  if (!host || host === 'YOUR_DOMAIN') {
    console.error(
      'Set app-links.config.json host (or --host) to your public App Link domain before patching.',
    );
    process.exit(1);
  }
  if (!pathPrefix.startsWith('/')) {
    pathPrefix = `/${pathPrefix}`;
  }
  return { host, pathPrefix };
}

function buildIntentFilter(host, pathPrefix) {
  return `
            <!-- Easy Payments Stripe BNPL App Link (patched by scripts/patch-android-app-links.mjs) -->
            <intent-filter android:autoVerify="true">
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data
                    android:scheme="https"
                    android:host="${host}"
                    android:pathPrefix="${pathPrefix}" />
            </intent-filter>
`;
}

if (!fs.existsSync(manifestPath)) {
  console.error(`Missing ${manifestPath}. Run: npx cap add android && npx cap sync android`);
  process.exit(1);
}

const { host, pathPrefix } = loadConfig();
let xml = fs.readFileSync(manifestPath, 'utf8');

// Remove prior patch block if present.
xml = xml.replace(
  /\s*<!-- Easy Payments Stripe BNPL App Link[\s\S]*?<\/intent-filter>\s*/g,
  '\n',
);

const marker = '<category android:name="android.intent.category.LAUNCHER" />';
const launcherIdx = xml.indexOf(marker);
if (launcherIdx < 0) {
  console.error('Could not find LAUNCHER intent-filter in AndroidManifest.xml');
  process.exit(1);
}
const insertAt = xml.indexOf('</intent-filter>', launcherIdx);
if (insertAt < 0) {
  console.error('Could not find end of LAUNCHER intent-filter');
  process.exit(1);
}
const afterLauncher = insertAt + '</intent-filter>'.length;
xml = xml.slice(0, afterLauncher) + buildIntentFilter(host, pathPrefix) + xml.slice(afterLauncher);

fs.writeFileSync(manifestPath, xml);
console.log(`Patched App Link intent-filter: https://${host}${pathPrefix}`);
console.log('Next: rebuild the debug APK and verify Digital Asset Links on the emulator.');
