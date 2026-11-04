/**
 * Merchant-stable Headless checkout identity for the demo playground.
 *
 * Distinct from the runtime session `id` returned by `createSession()`.
 * Kept stable across component remounts so H5.3 redirect recovery can reclaim
 * Klarna/Affirm returns for this demo host. Do not put PII in this value.
 */
export const DEMO_HEADLESS_CHECKOUT_INSTANCE_ID = 'demo-headless-1';
