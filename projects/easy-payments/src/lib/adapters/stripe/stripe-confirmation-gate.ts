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
 */
@Injectable({ providedIn: 'root' })
export class StripeConfirmationGate {
  private holder: string | null = null;

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
    this.holder = ownerId;
    let released = false;
    return () => {
      if (released) {
        return;
      }
      released = true;
      if (this.holder === ownerId) {
        this.holder = null;
      }
    };
  }

  isHeld(): boolean {
    return this.holder !== null;
  }

  isHeldBy(ownerId: string): boolean {
    return this.holder === ownerId;
  }
}
