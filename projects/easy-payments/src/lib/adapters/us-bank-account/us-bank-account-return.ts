/**
 * ACH (US bank account) return / reconcile helpers.
 *
 * Stripe may redirect for next actions even with `redirect: 'if_required'`.
 * We stamp `ep_method=us-bank-account` on return_url and recover via
 * retrievePaymentIntent only — never create or confirm a second PaymentIntent.
 */

import { resolveSameOriginStripeReturnUrl } from '../stripe/stripe-redirect-return';

export const ACH_RETURN_METHOD = 'us-bank-account' as const;
export const ACH_RETURN_METHOD_PARAM = 'ep_method';

/** Wait before polling when confirmPayment appears hung. */
export const ACH_CONFIRM_HANG_MS = 4_000;
/** Bounded retrieve attempts for the same client secret. */
export const ACH_RECONCILE_MAX_ATTEMPTS = 8;
export const ACH_RECONCILE_DELAY_MS = 750;

export interface AchReturnParams {
  paymentIntentId: string | null;
  clientSecret: string | null;
  redirectStatus: string | null;
}

function currentSearch(search?: string): string {
  return search ?? (typeof window !== 'undefined' ? window.location.search : '');
}

/** Same-origin return_url with ep_method=us-bank-account. */
export function buildAchReturnUrl(
  baseUrl?: string,
  locationHref?: string,
): string {
  const url = resolveSameOriginStripeReturnUrl(
    baseUrl,
    locationHref,
    'us-bank-account',
  );
  url.searchParams.set(ACH_RETURN_METHOD_PARAM, ACH_RETURN_METHOD);
  return url.href;
}

export function readAchReturnParams(search?: string): AchReturnParams {
  const params = new URLSearchParams(currentSearch(search));
  return {
    paymentIntentId: params.get('payment_intent'),
    clientSecret: params.get('payment_intent_client_secret'),
    redirectStatus: params.get('redirect_status'),
  };
}

/** True when URL indicates an ACH Stripe return (explicit ep_method). */
export function isAchReturnAttempt(search?: string): boolean {
  const params = new URLSearchParams(currentSearch(search));
  if (params.get(ACH_RETURN_METHOD_PARAM) !== ACH_RETURN_METHOD) {
    return false;
  }
  const { clientSecret, paymentIntentId } = readAchReturnParams(search);
  return !!(clientSecret || paymentIntentId);
}

/**
 * Clear ACH / Stripe return query params without reload.
 * Never logs or stores secrets.
 */
export function clearAchReturnParamsFromUrl(): void {
  if (typeof window === 'undefined' || typeof window.history?.replaceState !== 'function') {
    return;
  }
  try {
    const url = new URL(window.location.href);
    url.searchParams.delete('payment_intent');
    url.searchParams.delete('payment_intent_client_secret');
    url.searchParams.delete('redirect_status');
    url.searchParams.delete(ACH_RETURN_METHOD_PARAM);
    window.history.replaceState({}, '', url.href);
  } catch {
    // ignore
  }
}

type DelayFn = (ms: number) => Promise<void>;

const defaultDelay: DelayFn = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let delayImpl: DelayFn = defaultDelay;

export function delay(ms: number): Promise<void> {
  return delayImpl(ms);
}

/** Test-only: replace hang/reconcile timers (never use in production). */
export function setAchDelayForTests(fn: DelayFn | null): void {
  delayImpl = fn ?? defaultDelay;
}
