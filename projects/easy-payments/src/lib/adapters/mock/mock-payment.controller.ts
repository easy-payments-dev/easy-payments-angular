import { Injectable, signal } from '@angular/core';
import { PaymentMethod } from '../../models';

/**
 * Demo outcomes for mock adapters.
 * `processing` is opt-in (ACH-style pending). Existing demos that never call
 * `setOutcome('processing')` keep success / cancelled / failed behavior.
 */
export type MockPaymentOutcome = 'success' | 'cancelled' | 'failed' | 'processing';

/**
 * Controls mock/demo payment behavior.
 *
 * Mock adapters implement the same PaymentProviderAdapter contract as real
 * providers. This controller never processes a real payment.
 */
@Injectable({ providedIn: 'root' })
export class MockPaymentController {
  private readonly _outcome = signal<MockPaymentOutcome>('success');
  private readonly _unavailableMethods = signal<ReadonlySet<PaymentMethod>>(new Set());
  private readonly _delayMs = signal(0);

  readonly outcome = this._outcome.asReadonly();
  readonly unavailableMethods = this._unavailableMethods.asReadonly();
  readonly delayMs = this._delayMs.asReadonly();

  setOutcome(outcome: MockPaymentOutcome): void {
    this._outcome.set(outcome);
  }

  setUnavailableMethods(methods: readonly PaymentMethod[]): void {
    this._unavailableMethods.set(new Set(methods));
  }

  setDelay(ms: number): void {
    this._delayMs.set(Math.max(0, ms));
  }

  isMethodAvailable(method: PaymentMethod): boolean {
    return !this._unavailableMethods().has(method);
  }

  reset(): void {
    this._outcome.set('success');
    this._unavailableMethods.set(new Set());
    this._delayMs.set(0);
  }
}
