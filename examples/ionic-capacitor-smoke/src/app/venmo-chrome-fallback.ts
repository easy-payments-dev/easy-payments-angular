/**
 * Android Sandbox prototype: when Venmo is ineligible inside the Capacitor WebView,
 * open the working HTTPS web checkout in Chrome and return via the verified App Link.
 *
 * App Link markers alone never mark success — Home verifies PayPal order status
 * with the Nest backend after an `approved` return.
 */

export const VENMO_FALLBACK_STORAGE_KEY = 'ep.venmo.chrome.fallback.pending';
export const VENMO_FALLBACK_RETURN_EVENT = 'ep-smoke-venmo-fallback-return';
/** Fired as soon as an App Link is received — cancels resume-dismiss before evaluate. */
export const VENMO_FALLBACK_INCOMING_EVENT = 'ep-smoke-venmo-fallback-incoming';

export const VENMO_FALLBACK_QUERY = {
  flag: 'ep_smoke_venmo',
  attempt: 'ep_smoke_attempt',
  returnUrl: 'ep_smoke_return',
  /** Nest-bound PayPal order from Venmo handoff create. */
  order: 'ep_smoke_paypal_order',
  productName: 'ep_smoke_product_name',
  amount: 'ep_smoke_amount',
  currency: 'ep_smoke_currency',
} as const;

export const VENMO_RETURN_QUERY = {
  method: 'ep_method',
  attempt: 'ep_attempt',
  order: 'ep_paypal_order',
  result: 'ep_result',
} as const;

export type VenmoFallbackResult = 'approved' | 'cancelled';

export interface VenmoFallbackPending {
  attemptId: string;
  openedAt: number;
  checkoutUrl: string;
  /** Nest-created PayPal order id for this attempt (when handoff succeeded). */
  orderId?: string;
}

export interface VenmoFallbackReturnDetail {
  attemptId: string;
  result: VenmoFallbackResult;
  orderId: string | null;
}

export type VenmoFallbackReturnDecision =
  | { kind: 'handle'; detail: VenmoFallbackReturnDetail }
  | { kind: 'ignore'; reason: 'unrelated' | 'invalid' | 'duplicate' | 'misconfigured' | 'stale' };

/** Attempts already delivered to Home (cancel or approved verify kickoff). */
const deliveredVenmoAttempts = new Set<string>();

/** Test-only. */
export function resetVenmoFallbackDedupeForTests(): void {
  deliveredVenmoAttempts.clear();
}

export function isHttpsSandboxCheckoutUrl(raw: string | null | undefined): boolean {
  const value = raw?.trim() ?? '';
  if (!value) {
    return false;
  }
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch {
    return false;
  }
}

/** Short-lived attempt id (12–32 chars, URL-safe). */
export function createVenmoFallbackAttemptId(random = Math.random): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < 16; i++) {
    out += alphabet[Math.floor(random() * alphabet.length)]!;
  }
  return out;
}

export function isVenmoFallbackAttemptId(value: string | null | undefined): boolean {
  return !!value && /^[a-z0-9]{8,64}$/i.test(value.trim());
}

/**
 * Build the Chrome checkout URL: working web Venmo host + smoke return bridge params.
 * When Nest did not return a buyer approval URL, this hosts the official Venmo button.
 */
export function buildVenmoChromeCheckoutUrl(input: {
  checkoutBaseUrl: string;
  attemptId: string;
  nativeReturnUrl: string;
  orderId?: string | null;
  productName?: string | null;
  amount?: string | null;
  currency?: string | null;
}): string | null {
  if (!isHttpsSandboxCheckoutUrl(input.checkoutBaseUrl)) {
    return null;
  }
  if (!isVenmoFallbackAttemptId(input.attemptId)) {
    return null;
  }
  let returnUrl: URL;
  try {
    returnUrl = new URL(input.nativeReturnUrl.trim());
  } catch {
    return null;
  }
  if (returnUrl.protocol !== 'https:') {
    return null;
  }

  const target = new URL(input.checkoutBaseUrl);
  target.searchParams.set(VENMO_FALLBACK_QUERY.flag, '1');
  target.searchParams.set(VENMO_FALLBACK_QUERY.attempt, input.attemptId.trim());
  target.searchParams.set(VENMO_FALLBACK_QUERY.returnUrl, returnUrl.toString());
  const orderId = input.orderId?.trim() ?? '';
  if (orderId && /^[A-Z0-9-_]+$/i.test(orderId)) {
    target.searchParams.set(VENMO_FALLBACK_QUERY.order, orderId);
  }
  const productName = input.productName?.trim() ?? '';
  if (productName) {
    target.searchParams.set(VENMO_FALLBACK_QUERY.productName, productName.slice(0, 127));
  }
  const amount = input.amount?.trim() ?? '';
  if (amount && /^\d+(\.\d{1,2})?$/.test(amount)) {
    target.searchParams.set(VENMO_FALLBACK_QUERY.amount, amount);
  }
  const currency = input.currency?.trim().toUpperCase() ?? '';
  if (currency && /^[A-Z]{3}$/.test(currency)) {
    target.searchParams.set(VENMO_FALLBACK_QUERY.currency, currency);
  }
  return target.toString();
}

export function writeVenmoFallbackPending(
  pending: VenmoFallbackPending,
  storage: Storage = sessionStorage,
): void {
  storage.setItem(VENMO_FALLBACK_STORAGE_KEY, JSON.stringify(pending));
}

export function readVenmoFallbackPending(
  storage: Storage = sessionStorage,
): VenmoFallbackPending | null {
  try {
    const raw = storage.getItem(VENMO_FALLBACK_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<VenmoFallbackPending>;
    if (
      typeof parsed.attemptId !== 'string' ||
      !isVenmoFallbackAttemptId(parsed.attemptId) ||
      typeof parsed.openedAt !== 'number' ||
      typeof parsed.checkoutUrl !== 'string'
    ) {
      return null;
    }
    const orderId =
      typeof parsed.orderId === 'string' && /^[A-Z0-9-_]+$/i.test(parsed.orderId.trim())
        ? parsed.orderId.trim()
        : undefined;
    return {
      attemptId: parsed.attemptId,
      openedAt: parsed.openedAt,
      checkoutUrl: parsed.checkoutUrl,
      ...(orderId ? { orderId } : {}),
    };
  } catch {
    return null;
  }
}

export function clearVenmoFallbackPending(storage: Storage = sessionStorage): void {
  try {
    storage.removeItem(VENMO_FALLBACK_STORAGE_KEY);
  } catch {
    // ignore
  }
}

export function parseSmokeNativeReturnBase(
  nativeReturnUrl: string | null | undefined,
): { origin: string; pathname: string } | null {
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
    };
  } catch {
    return null;
  }
}

function normalizePath(pathname: string): string {
  const trimmed = pathname.replace(/\/$/, '');
  return trimmed || '/';
}

/**
 * Validate an App Link as a Venmo Chrome-fallback return.
 * Never treats presence of the link as payment success.
 */
export function evaluateVenmoChromeFallbackReturn(
  incomingUrl: string,
  config: { nativeReturnUrl: string },
  options?: { pendingAttemptId?: string | null },
): VenmoFallbackReturnDecision {
  const expected = parseSmokeNativeReturnBase(config.nativeReturnUrl);
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
  const method = params.get(VENMO_RETURN_QUERY.method)?.trim() ?? '';
  if (method !== 'venmo') {
    return { kind: 'ignore', reason: 'unrelated' };
  }

  const attemptId = params.get(VENMO_RETURN_QUERY.attempt)?.trim() ?? '';
  if (!isVenmoFallbackAttemptId(attemptId)) {
    return { kind: 'ignore', reason: 'invalid' };
  }

  const pending = options?.pendingAttemptId?.trim();
  // Require the original Chrome-open attempt — ignore orphan / mismatched App Links.
  if (!pending || pending !== attemptId) {
    return { kind: 'ignore', reason: 'stale' };
  }

  const resultRaw = params.get(VENMO_RETURN_QUERY.result)?.trim() ?? '';
  if (resultRaw !== 'approved' && resultRaw !== 'cancelled') {
    return { kind: 'ignore', reason: 'invalid' };
  }

  const orderRaw = params.get(VENMO_RETURN_QUERY.order)?.trim() ?? '';
  // PayPal approval redirects append token=<orderId> to experience_context.return_url.
  const tokenRaw = params.get('token')?.trim() ?? '';
  const orderCandidate = orderRaw || tokenRaw;
  const orderId =
    orderCandidate && /^[A-Z0-9-_]+$/i.test(orderCandidate) ? orderCandidate : null;
  if (resultRaw === 'approved' && !orderId) {
    return { kind: 'ignore', reason: 'invalid' };
  }

  // One delivery per attempt (approve or cancel) — Home owns success verify dedupe.
  const dedupeKey = `venmo:${attemptId.toLowerCase()}`;
  if (deliveredVenmoAttempts.has(dedupeKey)) {
    return { kind: 'ignore', reason: 'duplicate' };
  }
  deliveredVenmoAttempts.add(dedupeKey);

  return {
    kind: 'handle',
    detail: {
      attemptId,
      result: resultRaw,
      orderId,
    },
  };
}

export function formatVenmoFallbackReturnLog(
  decision: VenmoFallbackReturnDecision,
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
    return `venmo-fallback ignore:${decision.reason} ${path}`;
  }
  return `venmo-fallback handle result=${decision.detail.result} attempt=${decision.detail.attemptId} order=${decision.detail.orderId ? 'yes' : 'no'} ${path}`;
}

export function dispatchVenmoFallbackReturn(detail: VenmoFallbackReturnDetail, win: Window = window): void {
  win.dispatchEvent(new CustomEvent(VENMO_FALLBACK_RETURN_EVENT, { detail }));
}

/** PayPal order statuses that prove a completed capture (never trust App Link alone). */
export function isVerifiedVenmoCaptureStatus(status: string | null | undefined): boolean {
  const normalized = status?.trim().toUpperCase() ?? '';
  return normalized === 'COMPLETED';
}

/**
 * Demo/smoke bridge: build App Link after web Venmo success or cancel.
 * Used by the demo when opened with ep_smoke_* query params.
 */
export function buildVenmoFallbackAppLink(input: {
  nativeReturnUrl: string;
  attemptId: string;
  result: VenmoFallbackResult;
  orderId?: string | null;
}): string | null {
  const base = parseSmokeNativeReturnBase(input.nativeReturnUrl);
  if (!base || !isVenmoFallbackAttemptId(input.attemptId)) {
    return null;
  }
  const url = new URL(input.nativeReturnUrl.trim());
  url.search = '';
  url.hash = '';
  url.searchParams.set(VENMO_RETURN_QUERY.method, 'venmo');
  url.searchParams.set(VENMO_RETURN_QUERY.attempt, input.attemptId.trim());
  url.searchParams.set(VENMO_RETURN_QUERY.result, input.result);
  const order = input.orderId?.trim() ?? '';
  if (order && /^[A-Z0-9-_]+$/i.test(order)) {
    url.searchParams.set(VENMO_RETURN_QUERY.order, order);
  }
  return url.toString();
}
