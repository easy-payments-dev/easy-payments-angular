export type CheckoutViewState =
  | 'checkout'
  | 'processing'
  | 'pending'
  | 'status-check'
  | 'success'
  | 'error'
  | 'cancelled';

/**
 * Safe, truncated transaction reference for customer UI.
 * Never displays tokens or secrets — only a shortened id when present.
 */
export function formatTransactionReference(transactionId?: string | null): string | null {
  const value = transactionId?.trim();
  if (!value) {
    return null;
  }
  if (value.length <= 8) {
    return value;
  }
  return `••••${value.slice(-4)}`;
}
