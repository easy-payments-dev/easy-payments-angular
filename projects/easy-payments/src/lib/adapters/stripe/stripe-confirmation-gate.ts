import { Injectable } from '@angular/core';
import { PaymentError } from '../../errors/payment-error';
import type { PaymentMethod, PaymentProviderName } from '../../models';

/**
 * Page-level guard: at most one Stripe confirmation (card, Klarna, Affirm,
 * Google Pay, Apple Pay) may be in flight at a time across every checkout host.
 *
 * Stripe.js confirmations can redirect the whole page (3DS, Klarna, Affirm), so a
 * second concurrent confirmation could be abandoned mid-flight. A rejected attempt
 * never reaches Stripe, so nothing is submitted and nothing is retried automatically.
 *
 * Capacitor / Custom Tab caveat: when Stripe redirects, `confirmPayment` often never
 * settles, so `finally` never releases the gate. Call {@link clear} from App Link /
 * resume recovery for that stale hold — do not release on mere `visibilitychange`
 * (backgrounding mid-confirm must not unlock a second attempt).
 *
 * Each {@link acquire} returns an attempt-scoped releaser: an older `finally` cannot
 * drop a newer hold, even when both use the same owner id.
 */
@Injectable({ providedIn: 'root' })
export class StripeConfirmationGate {
  private holder: string | null = null;
  /** Monotonic id for the current hold; invalidated by {@link clear} and successful release. */
  private attempt = 0;

  /** Throws a PaymentError on the caller's host when another confirmation is in flight. */
  acquire(ownerId: string, method: PaymentMethod, provider: PaymentProviderName): () => void {
    if (this.holder !== null) {
      throw new PaymentError({
        code: this.holder === ownerId ? 'PAYMENT_FAILED' : 'PROVIDER_UNAVAILABLE',
        message:
          this.holder === ownerId
            ? 'A payment confirmation is already in progress.'
            : 'Another payment is already being confirmed on this page. Wait for it to finish, then try again.',
        method,
        provider,
      });
    }
    const myAttempt = ++this.attempt;
    this.holder = ownerId;
    let released = false;

    return () => {
      if (released) {
        return;
      }
      released = true;
      // Only the live attempt may unlock — never a stale confirmPayment finally.
      if (this.attempt === myAttempt && this.holder === ownerId) {
        this.holder = null;
      }
    };
  }

  /**
   * Drop any in-flight hold (redirect recovery, visible resume, App Link return).
   * Invalidates outstanding releasers so a hung confirm cannot unlock a later attempt.
   * Idempotent.
   */
  clear(): void {
    this.attempt += 1;
    this.holder = null;
  }

  isHeld(): boolean {
    return this.holder !== null;
  }

  isHeldBy(ownerId: string): boolean {
    return this.holder === ownerId;
  }
}
