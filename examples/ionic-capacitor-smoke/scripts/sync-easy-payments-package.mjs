/**
 * Copy the built library into a physical vendor/ tree so the Angular
 * application builder resolves `@angular/*` from this smoke app's
 * node_modules — not the monorepo root via the realpath of `file:../../dist`.
 *
 * Without this, Capacitor/Android production bundles can embed two copies of
 * `@angular/core` and throw NG0203 when Easy Payments factories call inject().
 */
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const smokeRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const distPackage = join(smokeRoot, '..', '..', 'dist', 'easy-payments');
const vendorPackage = join(smokeRoot, 'vendor', 'easy-payments');

if (!existsSync(join(distPackage, 'package.json'))) {
  console.error(
    'Missing ../../dist/easy-payments. Run `npm run build:lib` from the repo root first.',
  );
  process.exit(1);
}

rmSync(vendorPackage, { recursive: true, force: true });
mkdirSync(dirname(vendorPackage), { recursive: true });
cpSync(distPackage, vendorPackage, { recursive: true });
console.log(`Synced ${distPackage} → ${vendorPackage}`);
