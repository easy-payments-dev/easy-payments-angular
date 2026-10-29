/**
 * Generic Stripe BNPL / redirect return helpers (Klarna, Affirm, …).
 *
 * Stripe appends `payment_intent` and `payment_intent_client_secret` to return_url.
 * We stamp `ep_method=<method>` and a light sessionStorage marker (no secrets)
 * so Easy Payments can resume the correct method after the page remounts.
 */

export type StripeRedirectMethod = 'klarna' | 'affirm';

export const STRIPE_RETURN_METHOD_PARAM = 'ep_method';
/** Random, non-secret attempt token that ties a return URL to its pending marker. */
export const STRIPE_RETURN_ATTEMPT_PARAM = 'ep_attempt';
export const STRIPE_PENDING_STORAGE_KEY = 'ep.stripe.redirect.pending';

/** Finite poll when Stripe reports PaymentIntent status `processing` after return. */
export const STRIPE_PROCESSING_MAX_ATTEMPTS = 6;
export const STRIPE_PROCESSING_DELAY_MS = 750;

export type StripeReturnHostKind = 'checkout' | 'buttons';

/**
 * Which host on the page started a redirect (no secrets).
 * Prefer `checkoutInstanceId` for ownership across reorder / remount.
 * `hostOrdinal` is retained only for markers written before stable ids.
 */
export interface StripeReturnOrigin {
  attemptId: string;
  hostKind: StripeReturnHostKind;
  /**
   * Stable host identity: optional merchant `[checkoutInstanceId]`, or an
   * auto-generated per-mount id. Survives reorder; merchant ids survive reload.
   */
  checkoutInstanceId: string;
  /** @deprecated Prefer checkoutInstanceId. Index among same kind+productId. */
  hostOrdinal?: number;
}

export interface StripePendingReturn extends Partial<StripeReturnOrigin> {
  method: StripeRedirectMethod;
  productId: string;
  at: number;
}

/** Merchant or auto host ids: non-secret, URL/storage safe. */
export const CHECKOUT_INSTANCE_ID_PATTERN = /^[a-zA-Z0-9_.:-]{1,64}$/;

export function isValidCheckoutInstanceId(value: string | null | undefined): value is string {
  return typeof value === 'string' && CHECKOUT_INSTANCE_ID_PATTERN.test(value);
}

export interface StripeReturnParams {
  paymentIntentId: string | null;
  clientSecret: string | null;
  redirectStatus: string | null;
  method: StripeRedirectMethod | null;
  attemptId: string | null;
}

export function createStripeReturnAttemptId(): string {
  const bytes = new Uint8Array(8);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function canUseSessionStorage(storage?: Storage): storage is Storage {
  return !!storage && typeof storage.getItem === 'function';
}

function currentSearch(search?: string): string {
  return search ?? (typeof window !== 'undefined' ? window.location.search : '');
}

function isRedirectMethod(value: string | null | undefined): value is StripeRedirectMethod {
  return value === 'klarna' || value === 'affirm';
}

/** Build a return_url that preserves merchant params and marks the Stripe redirect method. */
export function buildStripeReturnUrl(
  method: StripeRedirectMethod,
  baseUrl?: string,
  locationHref?: string,
  attemptId?: string,
): string {
  const href =
    locationHref ??
    (typeof window !== 'undefined'
      ? `${window.location.origin}${window.location.pathname}${window.location.search}`
      : 'http://localhost/');
  const url = new URL(baseUrl || href, href);
  url.searchParams.set(STRIPE_RETURN_METHOD_PARAM, method);
  if (attemptId) {
    url.searchParams.set(STRIPE_RETURN_ATTEMPT_PARAM, attemptId);
  }
  return url.href;
}

export function readStripeReturnParams(search?: string): StripeReturnParams {
  const params = new URLSearchParams(currentSearch(search));
  const rawMethod = params.get(STRIPE_RETURN_METHOD_PARAM);
  const rawAttempt = params.get(STRIPE_RETURN_ATTEMPT_PARAM);
  return {
    paymentIntentId: params.get('payment_intent'),
    clientSecret: params.get('payment_intent_client_secret'),
    redirectStatus: params.get('redirect_status'),
    method: isRedirectMethod(rawMethod) ? rawMethod : null,
    attemptId: rawAttempt && /^[a-z0-9]{8,64}$/i.test(rawAttempt) ? rawAttempt : null,
  };
}

export function markStripePendingReturn(
  method: StripeRedirectMethod,
  productId: string,
  storage?: Storage,
  origin?: Partial<StripeReturnOrigin>,
): void {
  const store =
    storage ?? (typeof sessionStorage !== 'undefined' ? sessionStorage : undefined);
  if (!canUseSessionStorage(store)) {
    return;
  }
  const payload: StripePendingReturn = { method, productId, at: Date.now(), ...origin };
  store.setItem(STRIPE_PENDING_STORAGE_KEY, JSON.stringify(payload));
}

export function readStripePendingReturn(storage?: Storage): StripePendingReturn | null {
  const store =
    storage ?? (typeof sessionStorage !== 'undefined' ? sessionStorage : undefined);
  if (!canUseSessionStorage(store)) {
    return null;
  }
  try {
    const raw = store.getItem(STRIPE_PENDING_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as StripePendingReturn;
    if (!parsed || !isRedirectMethod(parsed.method) || typeof parsed.productId !== 'string') {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearStripePendingReturn(storage?: Storage): void {
  const store =
    storage ?? (typeof sessionStorage !== 'undefined' ? sessionStorage : undefined);
  if (!canUseSessionStorage(store)) {
    return;
  }
  store.removeItem(STRIPE_PENDING_STORAGE_KEY);
}

/** Clears the pending marker only if it still belongs to `attemptId` (never a sibling host's). */
export function clearStripePendingReturnFor(attemptId: string, storage?: Storage): void {
  if (readStripePendingReturn(storage)?.attemptId === attemptId) {
    clearStripePendingReturn(storage);
  }
}

/**
 * Detect which Stripe redirect method (if any) is returning.
 * Prefers explicit `ep_method`; falls back to pending session marker.
 */
export function detectStripeReturnMethod(
  search?: string,
  storage?: Storage,
): StripeRedirectMethod | null {
  const params = readStripeReturnParams(search);
  if (params.method) {
    return params.method;
  }
  const pending = readStripePendingReturn(storage);
  if (!pending) {
    return null;
  }
  if (!(params.clientSecret || params.paymentIntentId)) {
    // ep_method alone without Stripe params is still a return attempt for that method
    // when the URL explicitly carries ep_method — handled above.
    // Pending alone without any Stripe params is not enough.
    return null;
  }
  return pending.method;
}

/**
 * True when the URL/session indicates a Stripe redirect return for the given method
 * (or any supported method when method is omitted).
 */
export function isStripeReturnAttempt(
  method?: StripeRedirectMethod,
  search?: string,
  storage?: Storage,
): boolean {
  const params = new URLSearchParams(currentSearch(search));
  const urlMethod = params.get(STRIPE_RETURN_METHOD_PARAM);
  if (isRedirectMethod(urlMethod)) {
    return method ? urlMethod === method : true;
  }

  const { clientSecret, paymentIntentId } = readStripeReturnParams(search);
  if (!(clientSecret || paymentIntentId)) {
    return false;
  }
  const pending = readStripePendingReturn(storage);
  if (!pending) {
    return false;
  }
  return method ? pending.method === method : true;
}

/** Remove Stripe + Easy Payments return query params without a full reload. */
export function clearStripeReturnParamsFromUrl(href?: string): string | null {
  if (typeof window === 'undefined' && !href) {
    return null;
  }
  const url = new URL(href ?? window.location.href);
  url.searchParams.delete('payment_intent');
  url.searchParams.delete('payment_intent_client_secret');
  url.searchParams.delete('redirect_status');
  url.searchParams.delete(STRIPE_RETURN_METHOD_PARAM);
  url.searchParams.delete(STRIPE_RETURN_ATTEMPT_PARAM);
  const next = `${url.pathname}${url.search}${url.hash}`;
  if (typeof window !== 'undefined' && typeof window.history?.replaceState === 'function') {
    window.history.replaceState({}, '', next);
  }
  return next;
}

/** @deprecated Use STRIPE_RETURN_METHOD_PARAM */
export const KLARNA_RETURN_METHOD_PARAM = STRIPE_RETURN_METHOD_PARAM;
/** @deprecated Use STRIPE_PENDING_STORAGE_KEY (shared) — Klarna pending now uses shared key */
export const KLARNA_PENDING_STORAGE_KEY = STRIPE_PENDING_STORAGE_KEY;
export const KLARNA_PROCESSING_MAX_ATTEMPTS = STRIPE_PROCESSING_MAX_ATTEMPTS;
export const KLARNA_PROCESSING_DELAY_MS = STRIPE_PROCESSING_DELAY_MS;
