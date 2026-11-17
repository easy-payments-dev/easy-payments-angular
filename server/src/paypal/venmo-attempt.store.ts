import { Injectable } from '@nestjs/common';

export interface VenmoAttemptBinding {
  attemptId: string;
  orderId: string;
  productId: string;
  productName: string;
  quantity: number;
  amount: string;
  currency: string;
  returnUrl: string;
  cancelUrl: string;
  createdAt: number;
  captureId?: string;
  lastStatus?: string;
}

/**
 * In-memory attempt ↔ PayPal Venmo order binding for Ionic smoke handoff.
 * Demo/server process lifetime only — not durable across restarts.
 */
@Injectable()
export class VenmoAttemptStore {
  private readonly byAttempt = new Map<string, VenmoAttemptBinding>();
  private readonly byOrder = new Map<string, string>();

  put(binding: VenmoAttemptBinding): void {
    const attemptId = binding.attemptId.trim().toLowerCase();
    const orderId = binding.orderId.trim();
    const previous = this.byAttempt.get(attemptId);
    if (previous?.orderId && previous.orderId !== orderId) {
      this.byOrder.delete(previous.orderId);
    }
    const next: VenmoAttemptBinding = {
      ...binding,
      attemptId: binding.attemptId.trim(),
      orderId,
    };
    this.byAttempt.set(attemptId, next);
    this.byOrder.set(orderId, attemptId);
  }

  getByAttempt(attemptId: string): VenmoAttemptBinding | undefined {
    return this.byAttempt.get(attemptId.trim().toLowerCase());
  }

  getByOrder(orderId: string): VenmoAttemptBinding | undefined {
    const attemptKey = this.byOrder.get(orderId.trim());
    if (!attemptKey) {
      return undefined;
    }
    return this.byAttempt.get(attemptKey);
  }

  patch(
    attemptId: string,
    patch: Partial<Pick<VenmoAttemptBinding, 'captureId' | 'lastStatus'>>,
  ): VenmoAttemptBinding | undefined {
    const existing = this.getByAttempt(attemptId);
    if (!existing) {
      return undefined;
    }
    const next = { ...existing, ...patch };
    this.put(next);
    return next;
  }
}
