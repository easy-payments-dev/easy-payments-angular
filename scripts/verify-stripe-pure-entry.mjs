/**
 * W6.1 close-out: verify the built local package uses @stripe/stripe-js/pure
 * and that importing /pure does not auto-inject Stripe.js (minimal DOM shim).
 *
 * Real deferred load: calling loadStripe from /pure must append a script tag.
 * (We do not require Stripe.js to finish initializing in this shim.)
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const fesm = join(root, 'dist', 'easy-payments', 'fesm2022', 'easy-payments-angular.mjs');
const failures = [];

function assert(cond, msg) {
  if (!cond) failures.push(msg);
}

assert(existsSync(fesm), `Missing built FESM: ${fesm}`);
const src = readFileSync(fesm, 'utf8');
assert(
  /from ['"]@stripe\/stripe-js\/pure['"]/.test(src) ||
    /from ['"]@stripe\/stripe-js\/pure\/index\.js['"]/.test(src),
  'Built package must import loadStripe from @stripe/stripe-js/pure',
);
assert(
  !/from ['"]@stripe\/stripe-js['"]/.test(src),
  'Built package must not value-import the default @stripe/stripe-js entry',
);

/** Minimal DOM so @stripe/stripe-js can inject <script> tags. */
const scripts = [];
const head = {
  appendChild(node) {
    scripts.push(node);
    return node;
  },
};
const documentShim = {
  head,
  body: head,
  querySelectorAll(selector) {
    if (String(selector).includes('script')) {
      return scripts.filter((s) => s && s.tagName === 'SCRIPT');
    }
    return [];
  },
  createElement(tag) {
    const el = {
      tagName: String(tag).toUpperCase(),
      src: '',
      async: false,
      setAttribute() {},
      addEventListener() {},
    };
    return el;
  },
};
globalThis.document = documentShim;
globalThis.window = globalThis;

// Node ESM needs the file path; Angular/Vite resolve the public `/pure` entry.
const { loadStripe } = await import('@stripe/stripe-js/pure/index.js');
await Promise.resolve();
await Promise.resolve();
await new Promise((r) => setTimeout(r, 30));

const afterImport = scripts.map((s) => s.src).filter(Boolean);
assert(
  !afterImport.some((s) => /js\.stripe\.com/i.test(s)),
  `Importing /pure must not inject Stripe.js; got: ${afterImport.join(', ') || '(none)'}`,
);

const loadPromise = loadStripe('pk_test_w61_local_pure_deferred');
// Intentionally ignore rejection: shim never provides window.Stripe.
void loadPromise.catch(() => undefined);
await Promise.resolve();
await new Promise((r) => setTimeout(r, 30));
const afterLoad = scripts.map((s) => s.src).filter(Boolean);
assert(
  afterLoad.some((s) => /js\.stripe\.com/i.test(s)),
  'Calling loadStripe() from /pure must inject js.stripe.com (deferred real path)',
);

console.log('Built FESM pure import:', (src.match(/from ['"]@stripe\/stripe-js[^'"]*['"]/) || [])[0]);
console.log('Scripts after /pure import:', afterImport.length ? afterImport : '(none)');
console.log('Scripts after loadStripe():', afterLoad.filter((s) => /stripe/i.test(s)));

if (failures.length) {
  console.error('verify-stripe-pure-entry FAILED:');
  for (const f of failures) console.error(' -', f);
  process.exit(1);
}
console.log('verify-stripe-pure-entry passed (local unpublished build).');
