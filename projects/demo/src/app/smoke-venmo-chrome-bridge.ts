/**
 * Opt-in bridge for EP Ionic Smoke Android Venmo Chrome fallback.
 * Activates only when the playground is opened with ep_smoke_venmo=1 (+ attempt + return).
 * Does not change normal demo Venmo behavior.
 */

export const SMOKE_VENMO_QUERY = {
  flag: 'ep_smoke_venmo',
  attempt: 'ep_smoke_attempt',
  returnUrl: 'ep_smoke_return',
  order: 'ep_smoke_paypal_order',
  productName: 'ep_smoke_product_name',
  amount: 'ep_smoke_amount',
  currency: 'ep_smoke_currency',
} as const;

/** Capacitor smoke applicationId — used for Android Intent returns from Chrome. */
export const SMOKE_VENMO_ANDROID_PACKAGE = 'dev.easypayments.ionic.smoke';

export interface SmokeVenmoChromeBridge {
  attemptId: string;
  returnUrl: string;
  /** Nest-bound PayPal order from Venmo handoff (when Sandbox returned no approval URL). */
  orderId: string | null;
  productName: string | null;
  amount: string | null;
  currency: string | null;
}

export type SmokeVenmoReturnResult = 'approved' | 'cancelled';

export interface SmokeVenmoReturnLinks {
  /** Verified HTTPS App Link (same URL Digital Asset Links / intent-filter use). */
  httpsAppLink: string;
  /**
   * Chrome same-tab navigation to the HTTPS App Link loads the marketing site
   * (404 at /capacitor-return) instead of opening Ionic. Intent forces the package.
   */
  androidIntentUrl: string;
  result: SmokeVenmoReturnResult;
  attemptId: string;
  orderId: string | null;
  /** Traced destination after capture (for logs / QA). */
  destinationHost: string;
  destinationPath: string;
}

export function parseSmokeVenmoChromeBridge(
  search: string,
): SmokeVenmoChromeBridge | null {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  if (params.get(SMOKE_VENMO_QUERY.flag)?.trim() !== '1') {
    return null;
  }
  const attemptId = params.get(SMOKE_VENMO_QUERY.attempt)?.trim() ?? '';
  const returnUrl = params.get(SMOKE_VENMO_QUERY.returnUrl)?.trim() ?? '';
  if (!/^[a-z0-9]{8,64}$/i.test(attemptId)) {
    return null;
  }
  try {
    const parsed = new URL(returnUrl);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
      return null;
    }
  } catch {
    return null;
  }
  const orderRaw = params.get(SMOKE_VENMO_QUERY.order)?.trim() ?? '';
  const orderId = orderRaw && /^[A-Z0-9-_]+$/i.test(orderRaw) ? orderRaw : null;
  const productName = params.get(SMOKE_VENMO_QUERY.productName)?.trim() || null;
  const amountRaw = params.get(SMOKE_VENMO_QUERY.amount)?.trim() ?? '';
  const amount = amountRaw && /^\d+(\.\d{1,2})?$/.test(amountRaw) ? amountRaw : null;
  const currencyRaw = params.get(SMOKE_VENMO_QUERY.currency)?.trim().toUpperCase() ?? '';
  const currency = currencyRaw && /^[A-Z]{3}$/.test(currencyRaw) ? currencyRaw : null;
  return { attemptId, returnUrl, orderId, productName, amount, currency };
}

export function buildSmokeVenmoAppLinkReturn(input: {
  returnUrl: string;
  attemptId: string;
  result: SmokeVenmoReturnResult;
  orderId?: string | null;
}): string | null {
  let url: URL;
  try {
    url = new URL(input.returnUrl);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') {
    return null;
  }
  url.search = '';
  url.hash = '';
  url.searchParams.set('ep_method', 'venmo');
  url.searchParams.set('ep_attempt', input.attemptId);
  url.searchParams.set('ep_result', input.result);
  const order = input.orderId?.trim() ?? '';
  if (order && /^[A-Z0-9-_]+$/i.test(order)) {
    url.searchParams.set('ep_paypal_order', order);
  }
  return url.toString();
}

/** Android Intent URI that opens the smoke package with the HTTPS App Link data. */
export function buildSmokeVenmoAndroidIntentUrl(
  httpsAppLink: string,
  androidPackage: string = SMOKE_VENMO_ANDROID_PACKAGE,
): string | null {
  let url: URL;
  try {
    url = new URL(httpsAppLink);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || !androidPackage.trim()) {
    return null;
  }
  const pathAndQuery = `${url.pathname}${url.search}`;
  return (
    `intent://${url.host}${pathAndQuery}` +
    `#Intent;scheme=https;package=${androidPackage.trim()};end`
  );
}

export function buildSmokeVenmoReturnLinks(input: {
  returnUrl: string;
  attemptId: string;
  result: SmokeVenmoReturnResult;
  orderId?: string | null;
  androidPackage?: string;
}): SmokeVenmoReturnLinks | null {
  const httpsAppLink = buildSmokeVenmoAppLinkReturn(input);
  if (!httpsAppLink) {
    return null;
  }
  const androidIntentUrl = buildSmokeVenmoAndroidIntentUrl(
    httpsAppLink,
    input.androidPackage ?? SMOKE_VENMO_ANDROID_PACKAGE,
  );
  if (!androidIntentUrl) {
    return null;
  }
  const parsed = new URL(httpsAppLink);
  return {
    httpsAppLink,
    androidIntentUrl,
    result: input.result,
    attemptId: input.attemptId,
    orderId: input.orderId?.trim() || null,
    destinationHost: parsed.host,
    destinationPath: parsed.pathname,
  };
}

/**
 * Open the smoke app from Chrome. Prefer Intent (avoids marketing-site 404).
 * HTTPS App Link remains the verified deep-link payload.
 */
export function openSmokeVenmoReturnToIonic(
  links: SmokeVenmoReturnLinks,
  win: Window = window,
): { mode: 'intent' | 'https'; href: string } {
  // Confirmed failure: location.assign(https App Link) → Chrome loads
  // https://www.easy-payments.dev/capacitor-return as a website 404.
  win.location.href = links.androidIntentUrl;
  return { mode: 'intent', href: links.androidIntentUrl };
}
