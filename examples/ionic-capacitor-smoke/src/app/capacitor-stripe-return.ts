/**
 * Capacitor App Link / cold-start handling for Stripe BNPL returns.
 *
 * Never treats `redirect_status` as proof of payment — Easy Payments recovery
 * retrieves the PaymentIntent. Sensitive query params are stripped from the
 * WebView URL after merge and must never be logged.
 */

export const SMOKE_STRIPE_RETURN_SENSITIVE_PARAMS = [
  'payment_intent_client_secret',
  'payment_intent',
  'redirect_status',
] as const;

export const SMOKE_STRIPE_RETURN_MARKER_PARAMS = ['ep_method', 'ep_attempt'] as const;

export interface SmokeStripeReturnConfig {
  /** Absolute https App Link URL (origin + path), e.g. https://example.com/capacitor-return */
  nativeReturnUrl: string;
}

export type SmokeStripeReturnDecision =
  | { kind: 'apply'; search: string; attemptId: string | null; method: string | null }
  | { kind: 'ignore'; reason: 'unrelated' | 'invalid' | 'duplicate' | 'misconfigured' };

const handledAttemptKeys = new Set<string>();

/** Test-only: clear duplicate-callback memory. */
export function resetSmokeStripeReturnDedupeForTests(): void {
  handledAttemptKeys.clear();
}

export function parseSmokeNativeReturnConfig(
  nativeReturnUrl: string | undefined | null,
): { origin: string; pathname: string; href: string } | null {
  const raw = nativeReturnUrl?.trim() ?? '';
  if (!raw) {
    return null;
  }
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.username || url.password) {
      return null;
    }
    return {
      origin: url.origin,
      pathname: url.pathname.replace(/\/$/, '') || '/',
      href: `${url.origin}${url.pathname.replace(/\/$/, '') || '/'}`,
    };
  } catch {
    return null;
  }
}

type SmokeCheckoutOptions = {
  successUrl: string;
  allowExternalHttpsReturnUrl: true;
};

/** Same inputs must return the same object — new refs every CD remount Stripe Elements. */
let smokeCheckoutCacheKey: string | null = null;
let smokeCheckoutCacheValue: SmokeCheckoutOptions | undefined;

/** Test-only: clear the stable checkout options cache. */
export function resetSmokeCheckoutOptionsCacheForTests(): void {
  smokeCheckoutCacheKey = null;
  smokeCheckoutCacheValue = undefined;
}

function smokeCheckoutCacheKeyFor(input: {
  isNative: boolean;
  nativeStripeReturnUrl?: string | null;
}): string {
  return `${input.isNative ? '1' : '0'}\0${input.nativeStripeReturnUrl?.trim() ?? ''}`;
}

/**
 * Pure resolver for smoke App Link checkout options (no Capacitor / env imports).
 * Browser callers pass isNative=false so Stripe return_url stays same-origin.
 * Returns a stable object reference while inputs are unchanged.
 */
export function resolveSmokeCheckoutOptionsFrom(input: {
  isNative: boolean;
  nativeStripeReturnUrl?: string | null;
  useMockMode?: boolean;
  warn?: (message: string) => void;
}): SmokeCheckoutOptions | undefined {
  const cacheKey = smokeCheckoutCacheKeyFor(input);
  if (smokeCheckoutCacheKey === cacheKey) {
    return smokeCheckoutCacheValue;
  }

  let value: SmokeCheckoutOptions | undefined;
  if (!input.isNative) {
    value = undefined;
  } else {
    const parsed = parseSmokeNativeReturnConfig(input.nativeStripeReturnUrl);
    if (!parsed) {
      if (input.useMockMode === false) {
        const warn = input.warn ?? ((message: string) => console.warn(message));
        warn(
          '[ep-smoke] nativeStripeReturnUrl is missing or invalid in the sandbox build. ' +
            'Stripe BNPL will return to https://localhost (ERR_CONNECTION_REFUSED in Chrome). ' +
            'Set environment.local.ts nativeStripeReturnUrl and rebuild the sandbox APK.',
        );
      }
      value = undefined;
    } else {
      value = {
        successUrl: parsed.href,
        allowExternalHttpsReturnUrl: true,
      };
    }
  }

  smokeCheckoutCacheKey = cacheKey;
  smokeCheckoutCacheValue = value;
  return value;
}

function normalizePath(pathname: string): string {
  const trimmed = pathname.replace(/\/$/, '');
  return trimmed || '/';
}

function attemptKey(params: URLSearchParams): string | null {
  const attempt = params.get('ep_attempt')?.trim() ?? '';
  const intent = params.get('payment_intent')?.trim() ?? '';
  if (attempt && /^[a-z0-9]{8,64}$/i.test(attempt)) {
    return `attempt:${attempt.toLowerCase()}`;
  }
  if (intent) {
    return `pi:${intent}`;
  }
  return null;
}

/**
 * Validate an incoming App Link / launch URL for Stripe return handling.
 * Unrelated deep links and duplicates are ignored without applying query.
 */
export function evaluateSmokeStripeReturnUrl(
  incomingUrl: string,
  config: SmokeStripeReturnConfig,
  options?: { pendingAttemptId?: string | null },
): SmokeStripeReturnDecision {
  const expected = parseSmokeNativeReturnConfig(config.nativeReturnUrl);
  if (!expected) {
    return { kind: 'ignore', reason: 'misconfigured' };
  }

  let incoming: URL;
  try {
    incoming = new URL(incomingUrl);
  } catch {
    return { kind: 'ignore', reason: 'invalid' };
  }

  if (incoming.protocol !== 'https:' || incoming.origin !== expected.origin) {
    return { kind: 'ignore', reason: 'unrelated' };
  }
  if (normalizePath(incoming.pathname) !== expected.pathname) {
    return { kind: 'ignore', reason: 'unrelated' };
  }

  const params = incoming.searchParams;
  const hasSecret = !!params.get('payment_intent_client_secret')?.trim();
  const hasIntent = !!params.get('payment_intent')?.trim();
  const method = params.get('ep_method')?.trim() || null;
  const attemptId = params.get('ep_attempt')?.trim() || null;

  // Require Stripe return markers — never open the app on bare path hits.
  if (!hasSecret && !hasIntent && !method) {
    return { kind: 'ignore', reason: 'unrelated' };
  }

  // Attempt correlation when a pending marker exists (warm return).
  const pending = options?.pendingAttemptId?.trim();
  if (pending && attemptId && pending !== attemptId) {
    return { kind: 'ignore', reason: 'unrelated' };
  }

  const key = attemptKey(params);
  if (key && handledAttemptKeys.has(key)) {
    return { kind: 'ignore', reason: 'duplicate' };
  }
  if (key) {
    handledAttemptKeys.add(key);
  }

  return {
    kind: 'apply',
    search: incoming.search,
    attemptId,
    method,
  };
}

/** Safe log line — never includes client secrets or full query. */
export function formatSmokeStripeReturnLog(
  decision: SmokeStripeReturnDecision,
  incomingUrl: string,
): string {
  let path = '(invalid)';
  try {
    const u = new URL(incomingUrl);
    path = `${u.origin}${u.pathname}`;
  } catch {
    // keep placeholder
  }
  if (decision.kind === 'ignore') {
    return `stripe-return ignore:${decision.reason} ${path}`;
  }
  return `stripe-return apply method=${decision.method ?? 'unknown'} attempt=${decision.attemptId ?? 'none'} ${path}`;
}

/**
 * Merge Stripe return search onto the current WebView location and notify
 * recovery listeners. Strips sensitive params from history after a short delay
 * so retrieve can read them first.
 */
export function applySmokeStripeReturnSearch(
  search: string,
  win: Window = window,
  options?: { stripDelayMs?: number },
): void {
  const current = new URL(win.location.href);
  const incoming = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  for (const [key, value] of incoming.entries()) {
    current.searchParams.set(key, value);
  }
  const next = `${current.pathname}${current.search}${current.hash}`;
  win.history.replaceState({}, '', next);
  win.dispatchEvent(new PopStateEvent('popstate'));

  const delay = options?.stripDelayMs ?? 2_500;
  win.setTimeout(() => {
    stripSensitiveSmokeReturnParams(win);
  }, delay);
}

export function stripSensitiveSmokeReturnParams(win: Window = window): void {
  const current = new URL(win.location.href);
  let changed = false;
  for (const key of [
    ...SMOKE_STRIPE_RETURN_SENSITIVE_PARAMS,
    ...SMOKE_STRIPE_RETURN_MARKER_PARAMS,
  ]) {
    if (current.searchParams.has(key)) {
      current.searchParams.delete(key);
      changed = true;
    }
  }
  if (!changed) {
    return;
  }
  win.history.replaceState({}, '', `${current.pathname}${current.search}${current.hash}`);
}
