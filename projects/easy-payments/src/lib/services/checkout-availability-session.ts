import { signal } from '@angular/core';
import type { AvailablePaymentMethod } from './payment-orchestrator.service';

/**
 * Per-checkout-instance availability snapshot.
 *
 * `PaymentOrchestratorService` remains root-scoped (adapters, initialize,
 * processPayment, and the global diagnostics projection). Each
 * `<easy-payments>` (and future payment-buttons) host owns one of these
 * sessions so a sibling refresh cannot overwrite another host's visible methods.
 *
 * Not providedIn root — construct one per component instance.
 */
export class CheckoutAvailabilitySession {
  private readonly _availableMethods = signal<AvailablePaymentMethod[]>([]);
  private readonly _availabilityPublished = signal(false);

  readonly availableMethods = this._availableMethods.asReadonly();
  readonly availabilityPublished = this._availabilityPublished.asReadonly();

  /** Replace the instance snapshot after a successful availability evaluation. */
  apply(results: readonly AvailablePaymentMethod[]): void {
    this._availableMethods.set(results.map((entry) => ({ ...entry })));
    this._availabilityPublished.set(true);
  }

  /** Clear local publication (e.g. after a failed refresh that should not paint stale tiles). */
  clear(): void {
    this._availableMethods.set([]);
    this._availabilityPublished.set(false);
  }
}
