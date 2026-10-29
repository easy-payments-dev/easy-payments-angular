import { PaymentMethod, PaymentProviderName } from './payment-method.model';

/**
 * `processing` — PaymentIntent (or equivalent) is still settling. Not success and
 * not a definitive failure. Merchants must confirm the final outcome via backend
 * webhooks / retrieve; the UI must not invite a retry that could double-charge.
 */
export type PaymentStatus = 'success' | 'cancelled' | 'failed' | 'processing';

export interface PaymentResult {
  status: PaymentStatus;
  method: PaymentMethod;
  provider: PaymentProviderName;
  transactionId?: string;
  sessionId?: string;
  message?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Emitted when a customer starts a payment attempt.
 * Amount and currency come from the current checkout product input.
 * They are not a captured charge and are not a provider authorization.
 */
export interface PaymentStartedEvent {
  method: PaymentMethod;
  provider: PaymentProviderName;
  amount: number;
  currency: string;
}

/**
 * Emitted when the selected checkout method changes.
 * `method` is null when the previous selection is no longer available and no
 * other method can be selected.
 */
export interface PaymentMethodChangeEvent {
  method: PaymentMethod | null;
  previousMethod: PaymentMethod | null;
  provider: PaymentProviderName | null;
}

export function normalizePaymentResult(result: PaymentResult): PaymentResult {
  return {
    status: result.status,
    method: result.method,
    provider: result.provider,
    ...(result.transactionId !== undefined ? { transactionId: result.transactionId } : {}),
    ...(result.sessionId !== undefined ? { sessionId: result.sessionId } : {}),
    ...(result.message !== undefined ? { message: result.message } : {}),
    ...(result.metadata !== undefined ? { metadata: { ...result.metadata } } : {}),
  };
}
