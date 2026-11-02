import type { StripeElements, StripePaymentElement } from '@stripe/stripe-js';

/** Owner used when a caller does not pass an ownerId (legacy single-host behaviour). */
export const LEGACY_STRIPE_ELEMENT_OWNER = 'legacy';

/** One host's Payment Element + PaymentIntent. Never shared between hosts. */
export interface StripeElementSession {
  elements: StripeElements | null;
  paymentElement: StripePaymentElement | null;
  clientSecret: string | null;
  sessionId: string | undefined;
  paymentIntentId: string | undefined;
  confirming: boolean;
}

/**
 * Owner-scoped Payment Element sessions for a root (shared) Stripe adapter.
 * Each host component gets its own Elements group, PaymentIntent and confirm flag,
 * so one host can neither confirm nor unmount another host's payment.
 */
export class StripeElementSessionStore {
  private readonly sessions = new Map<string, StripeElementSession>();

  get(ownerId: string = LEGACY_STRIPE_ELEMENT_OWNER): StripeElementSession {
    let session = this.sessions.get(ownerId);
    if (!session) {
      session = {
        elements: null,
        paymentElement: null,
        clientSecret: null,
        sessionId: undefined,
        paymentIntentId: undefined,
        confirming: false,
      };
      this.sessions.set(ownerId, session);
    }
    return session;
  }

  peek(ownerId: string = LEGACY_STRIPE_ELEMENT_OWNER): StripeElementSession | undefined {
    return this.sessions.get(ownerId);
  }

  unmount(ownerId: string = LEGACY_STRIPE_ELEMENT_OWNER): void {
    const session = this.sessions.get(ownerId);
    if (!session) {
      return;
    }
    unmountSession(session);
  }

  /** Destroys one owner's session, or every session when ownerId is omitted. */
  destroy(ownerId?: string): void {
    if (ownerId === undefined) {
      for (const session of this.sessions.values()) {
        unmountSession(session);
      }
      this.sessions.clear();
      return;
    }
    const session = this.sessions.get(ownerId);
    if (session) {
      unmountSession(session);
      this.sessions.delete(ownerId);
    }
  }

  size(): number {
    return this.sessions.size;
  }
}

function unmountSession(session: StripeElementSession): void {
  try {
    session.paymentElement?.unmount();
  } catch {
    // Element may already be unmounted.
  }
  session.paymentElement = null;
  session.elements = null;
}
