/**
 * Safe ACH lifecycle diagnostics. Logs only PaymentIntent id, status, and
 * named events — never client secrets or confirm payloads.
 */

export type AchLifecycleEvent =
  | 'confirm_started'
  | 'confirm_resolved'
  | 'confirm_hang_reconcile'
  | 'reconcile_status'
  | 'reconcile_exhausted'
  | 'return_recover_started'
  | 'return_recover_resolved'
  | 'attempt_emitted';

export interface AchLifecycleInfo {
  paymentIntentId?: string | null;
  status?: string | null;
}

export function logAchLifecycle(event: AchLifecycleEvent, info: AchLifecycleInfo = {}): void {
  if (typeof console === 'undefined' || typeof console.info !== 'function') {
    return;
  }
  console.info('[easy-payments:ach]', event, {
    paymentIntentId: info.paymentIntentId ?? null,
    status: info.status ?? null,
  });
}
