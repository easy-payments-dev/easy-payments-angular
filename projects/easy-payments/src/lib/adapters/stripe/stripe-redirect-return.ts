/**
 * Generic Stripe BNPL / redirect return helpers (Klarna, Affirm, …).
 *
 * Stripe appends `payment_intent` and `payment_intent_client_secret` to return_url.
 * We stamp `ep_method=<method>` and a light sessionStorage marker (no secrets)
 * so Easy Payments can resume the correct method after the page remounts.
 *
 * Host kinds:
 * - `checkout` / `buttons` — Full Checkout and Buttons Only (existing)
 * - `headless` — Headless Klarna/Affirm (H4.2 ownership; public recovery is H4.3)
 */

import { PaymentError } from '../../errors/payment-error';
import type { PaymentMethod, PaymentProviderName } from '../../models';

export type StripeRedirectMethod = 'klarna' | 'affirm';

export const STRIPE_RETURN_METHOD_PARAM = 'ep_method';
/** Random, non-secret attempt token that ties a return URL to its pending marker. */
export const STRIPE_RETURN_ATTEMPT_PARAM = 'ep_attempt';
export const STRIPE_PENDING_STORAGE_KEY = 'ep.stripe.redirect.pending';

/** Finite poll when Stripe reports PaymentIntent status `processing` after return. */
export const STRIPE_PROCESSING_MAX_ATTEMPTS = 6;
export const STRIPE_PROCESSING_DELAY_MS = 750;

/**
 * Bounded retries when Stripe PaymentIntent retrieval fails transiently
 * (network / SDK). Does not reconfirm or create a new PaymentIntent.
 */
export const STRIPE_RETRIEVE_RETRY_ATTEMPTS = 3;
export const STRIPE_RETRIEVE_RETRY_DELAY_MS = 400;

/** Pending redirect markers older than this grant no ownership. */
export const STRIPE_PENDING_TTL_MS = 24 * 60 * 60 * 1000;

export type StripeReturnHostKind = 'checkout' | 'buttons' | 'headless';

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
   * Headless BNPL redirect markers require a merchant-stable id.
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

function isHostKind(value: unknown): value is StripeReturnHostKind {
  return value === 'checkout' || value === 'buttons' || value === 'headless';
}

/** True when the marker is past TTL or lacks a usable timestamp. */
export function isStripePendingReturnExpired(
  marker: StripePendingReturn,
  now: number = Date.now(),
): boolean {
  if (typeof marker.at !== 'number' || !Number.isFinite(marker.at) || marker.at <= 0) {
    return true;
  }
  return now - marker.at > STRIPE_PENDING_TTL_MS;
}

const STRIPE_RETURN_URL_MESSAGE =
  'Checkout successUrl must be a same-origin http(s) URL. Relative paths are resolved against the current page. Other schemes and cross-origin destinations are not allowed.';

function invalidStripeReturnUrl(method: PaymentMethod): never {
  const provider: PaymentProviderName =
    method === 'klarna' || method === 'affirm' ? method : 'stripe';
  throw new PaymentError({
    code: 'CONFIG_INVALID',
    message: STRIPE_RETURN_URL_MESSAGE,
    method,
    provider,
  });
}

function currentPageHref(locationHref?: string): string {
  const explicit = locationHref?.trim();
  if (explicit) {
    return explicit;
  }
  if (typeof window !== 'undefined' && window.location) {
    return `${window.location.origin}${window.location.pathname}${window.location.search}`;
  }
  return 'http://localhost/';
}

/**
 * Resolve a merchant return destination against the current page.
 * Does not add Stripe return markers and does not echo the supplied URL.
 */
export function resolveSameOriginStripeReturnUrl(
  baseUrl: string | undefined,
  locationHref: string | undefined,
  method: PaymentMethod,
): URL {
  let page: URL;
  try {
    page = new URL(currentPageHref(locationHref));
  } catch {
    invalidStripeReturnUrl(method);
  }
  if (page.protocol !== 'http:' && page.protocol !== 'https:') {
    invalidStripeReturnUrl(method);
  }

  const raw = baseUrl?.trim() ?? '';
  if (!raw) {
    return page;
  }
  if (raw.startsWith('//') || raw.startsWith('\\\\') || raw.startsWith('/\\')) {
    invalidStripeReturnUrl(method);
  }

  const schemeMatch = /^([a-z][a-z0-9+.-]*):/i.exec(raw);
  if (schemeMatch) {
    const scheme = schemeMatch[1].toLowerCase();
    if (scheme !== 'http' && scheme !== 'https') {
      invalidStripeReturnUrl(method);
    }
  }

  let url: URL;
  try {
    url = new URL(raw, page);
  } catch {
    invalidStripeReturnUrl(method);
  }
  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    url.username ||
    url.password ||
    url.origin !== page.origin
  ) {
    invalidStripeReturnUrl(method);
  }
  return url;
}

/** Build a return_url that preserves merchant params and marks the Stripe redirect method. */
export function buildStripeReturnUrl(
  method: StripeRedirectMethod,
  baseUrl?: string,
  locationHref?: string,
  attemptId?: string,
): string {
  const url = resolveSameOriginStripeReturnUrl(baseUrl, locationHref, method);
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
  try {
    const payload: StripePendingReturn = { method, productId, at: Date.now(), ...origin };
    store.setItem(STRIPE_PENDING_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Quota / private mode — callers that require a durable marker must use markHeadlessPendingReturn.
  }
}

/**
 * Write a Headless-owned pending marker. Fails closed when another unresolved
 * attempt already occupies the shared key (different host or Headless instance).
 * Same Headless `checkoutInstanceId` may replace its own prior attempt.
 */
export function markHeadlessPendingReturn(
  method: StripeRedirectMethod,
  productId: string,
  origin: Pick<StripeReturnOrigin, 'attemptId' | 'checkoutInstanceId'>,
  storage?: Storage,
): void {
  const store =
    storage ?? (typeof sessionStorage !== 'undefined' ? sessionStorage : undefined);
  if (!canUseSessionStorage(store)) {
    throw new PaymentError({
      code: 'PROVIDER_UNAVAILABLE',
      message:
        'sessionStorage is required to record Headless Klarna/Affirm redirect ownership before confirmation.',
      method,
      provider: method,
    });
  }
  if (!origin.attemptId || !isValidCheckoutInstanceId(origin.checkoutInstanceId)) {
    throw new PaymentError({
      code: 'CONFIG_INVALID',
      message:
        'Headless Klarna/Affirm redirect requires a stable checkoutInstanceId and attempt id for ownership.',
      method,
      provider: method,
    });
  }

  let existing: StripePendingReturn | null = null;
  try {
    existing = readStripePendingReturn(store);
  } catch {
    existing = null;
  }

  if (existing) {
    const sameHeadlessSession =
      existing.hostKind === 'headless' &&
      existing.checkoutInstanceId === origin.checkoutInstanceId;
    if (!sameHeadlessSession) {
      throw new PaymentError({
        code: 'PAYMENT_FAILED',
        message:
          'A Stripe redirect return is already pending for another checkout attempt. Complete or abandon that attempt before starting another.',
        method,
        provider: method,
      });
    }
  }

  try {
    const payload: StripePendingReturn = {
      method,
      productId,
      at: Date.now(),
      attemptId: origin.attemptId,
      hostKind: 'headless',
      checkoutInstanceId: origin.checkoutInstanceId,
    };
    store.setItem(STRIPE_PENDING_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    throw new PaymentError({
      code: 'PROVIDER_UNAVAILABLE',
      message: 'Unable to persist Headless redirect ownership marker in sessionStorage.',
      method,
      provider: method,
    });
  }
}

/**
 * Read the pending marker. Expired, malformed, or unreadable markers return null
 * and do not grant ownership. Expired entries are cleared from storage when possible.
 */
export function readStripePendingReturn(
  storage?: Storage,
  now: number = Date.now(),
): StripePendingReturn | null {
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
    if (parsed.hostKind !== undefined && parsed.hostKind !== null && !isHostKind(parsed.hostKind)) {
      return null;
    }
    if (isStripePendingReturnExpired(parsed, now)) {
      try {
        store.removeItem(STRIPE_PENDING_STORAGE_KEY);
      } catch {
        // ignore clear failures
      }
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
  try {
    store.removeItem(STRIPE_PENDING_STORAGE_KEY);
  } catch {
    // ignore
  }
}

/**
 * Clears the pending marker only if it still belongs to `attemptId`
 * (never a sibling host's or a newer attempt).
 */
export function clearStripePendingReturnFor(attemptId: string, storage?: Storage): void {
  if (!attemptId) {
    return;
  }
  const pending = peekStripePendingReturn(storage);
  if (pending?.attemptId === attemptId) {
    clearStripePendingReturn(storage);
  }
}

/**
 * Read without TTL eviction — used only so attempt-scoped clear can still remove
 * an expired marker that matches the settling attempt.
 */
function peekStripePendingReturn(storage?: Storage): StripePendingReturn | null {
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

/**
 * Remove Stripe + Easy Payments return query params without a full reload.
 * An explicit `href` is pure: it never writes `window.history` (callers that pass a
 * sample URL must not navigate the live page). The live page is updated only when
 * `href` is omitted, using the current pathname and `location.search` so a stale
 * `location.href` cannot keep or restore another attempt's query.
 */
export function clearStripeReturnParamsFromUrl(href?: string): string | null {
  if (typeof window === 'undefined' && !href) {
    return null;
  }
  let url: URL;
  try {
    if (href) {
      url = new URL(href);
    } else {
      const live = window.location;
      url = new URL(`${live.origin}${live.pathname}${live.search}${live.hash}`);
    }
  } catch {
    return null;
  }
  url.searchParams.delete('payment_intent');
  url.searchParams.delete('payment_intent_client_secret');
  url.searchParams.delete('redirect_status');
  url.searchParams.delete(STRIPE_RETURN_METHOD_PARAM);
  url.searchParams.delete(STRIPE_RETURN_ATTEMPT_PARAM);
  const next = href ? url.href : `${url.pathname}${url.search}${url.hash}`;
  if (!href && typeof window !== 'undefined' && typeof window.history?.replaceState === 'function') {
    window.history.replaceState({}, '', url.href);
  }
  return next;
}

/** @deprecated Use STRIPE_RETURN_METHOD_PARAM */
export const KLARNA_RETURN_METHOD_PARAM = STRIPE_RETURN_METHOD_PARAM;
/** @deprecated Use STRIPE_PENDING_STORAGE_KEY (shared) — Klarna pending now uses shared key */
export const KLARNA_PENDING_STORAGE_KEY = STRIPE_PENDING_STORAGE_KEY;
export const KLARNA_PROCESSING_MAX_ATTEMPTS = STRIPE_PROCESSING_MAX_ATTEMPTS;
export const KLARNA_PROCESSING_DELAY_MS = STRIPE_PROCESSING_DELAY_MS;
