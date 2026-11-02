import { Injectable } from '@angular/core';
import { PaymentError } from '../errors/payment-error';

/**
 * Tracks live Headless session ids so two sessions cannot claim the same
 * merchant `checkoutInstanceId` (or resolved auto id) at once.
 * Root-scoped; does not hold session objects.
 */
@Injectable({ providedIn: 'root' })
export class HeadlessSessionRegistry {
  private readonly liveIds = new Set<string>();

  claim(id: string): void {
    if (this.liveIds.has(id)) {
      throw new PaymentError({
        code: 'CONFIG_INVALID',
        message: `A Headless checkout session with id "${id}" is already active.`,
      });
    }
    this.liveIds.add(id);
  }

  release(id: string): void {
    this.liveIds.delete(id);
  }

  /** Test / diagnostics. */
  has(id: string): boolean {
    return this.liveIds.has(id);
  }

  /** Test helper — clears all claims. */
  clearForTests(): void {
    this.liveIds.clear();
  }
}
