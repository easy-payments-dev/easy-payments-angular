/**
 * Reference payment states derived from verified provider webhooks.
 * Provider event schemas do not map 1:1; apply transitions carefully.
 */
export type ReferencePaymentStatus =
  | 'PENDING'
  | 'PROCESSING'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'CANCELED'
  | 'REFUNDED';

export type WebhookProvider = 'stripe' | 'paypal' | 'zip';

export interface ReferencePaymentRecord {
  provider: WebhookProvider;
  /** Stripe PaymentIntent id or PayPal capture id. */
  paymentId: string;
  status: ReferencePaymentStatus;
  /** Optional major-unit amount copied from the verified event (descriptive). */
  amount?: string;
  currency?: string;
  /** Correlated PayPal order id when present on a capture event. */
  orderId?: string;
  updatedAt: string;
  lastEventId: string;
  lastEventType: string;
}

export interface ApplyWebhookEventInput {
  provider: WebhookProvider;
  eventId: string;
  eventType: string;
  paymentId: string;
  status: ReferencePaymentStatus;
  amount?: string;
  currency?: string;
  orderId?: string;
}

export interface ApplyWebhookEventResult {
  /** Same provider event id was already recorded. */
  duplicate: boolean;
  /** Event was recognized but did not change state (unsupported transition / out-of-order). */
  ignored: boolean;
  previousStatus?: ReferencePaymentStatus;
  record?: ReferencePaymentRecord;
}

export const TERMINAL_REFERENCE_STATUSES: ReadonlySet<ReferencePaymentStatus> = new Set([
  'SUCCEEDED',
  'FAILED',
  'CANCELED',
  'REFUNDED',
]);
