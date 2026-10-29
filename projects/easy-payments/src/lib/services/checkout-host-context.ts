import { inject, Injectable, OnDestroy, signal } from '@angular/core';
import {
  StripeRedirectRecoveryService,
  type StripeReturnHost,
} from '../adapters/stripe/stripe-redirect-recovery.service';
import type {
  StripeRedirectMethod,
  StripeReturnHostKind,
  StripeReturnOrigin,
} from '../adapters/stripe/stripe-redirect-return';

/**
 * Stripe redirect return state for one host:
 * - `none` — no return for this host (panels behave normally)
 * - `pending` — a return is on the page but ownership is not decided yet
 * - `owner` — this host is recovering the return (panels must not create a new PaymentIntent)
 */
export type StripeReturnPhase = 'none' | 'pending' | 'owner';

/**
 * Per-host context (component-level provider on `<easy-payments>` and
 * `<easy-payment-buttons>`). Lets child payment panels stamp redirect origin and
 * follow the host's return ownership without reaching into the host component.
 */
@Injectable()
export class CheckoutHostContext implements StripeReturnHost, OnDestroy {
  private readonly recovery = inject(StripeRedirectRecoveryService);
  private currentProductId: string | null = null;

  kind: StripeReturnHostKind = 'checkout';
  private readonly phase = signal<StripeReturnPhase>('none');
  private readonly phaseMethod = signal<StripeRedirectMethod | null>(null);

  /** Return phase as seen by the panel for `method`; other methods always see `none`. */
  returnPhaseFor(method: StripeRedirectMethod): StripeReturnPhase {
    const phase = this.phase();
    return phase !== 'none' && this.phaseMethod() === method ? phase : 'none';
  }

  returnPhase(): StripeReturnPhase {
    return this.phase();
  }

  setReturnPhase(phase: StripeReturnPhase, method: StripeRedirectMethod | null = null): void {
    this.phaseMethod.set(phase === 'none' ? null : method);
    this.phase.set(phase);
  }

  constructor() {
    this.recovery.registerHost(this);
  }

  productId(): string | null {
    return this.currentProductId;
  }

  setProductId(productId: string): void {
    this.currentProductId = productId;
  }

  describeReturnOrigin(attemptId: string): StripeReturnOrigin {
    return this.recovery.describeReturnOrigin(this, attemptId);
  }

  ngOnDestroy(): void {
    this.recovery.unregisterHost(this);
  }
}
