let ownerSequence = 0;

/**
 * Page-unique, non-secret token identifying one payment host component on a
 * shared root adapter (Payment Element session, wallet attempt, PayPal order guard).
 */
export function createPaymentOwnerId(prefix: string): string {
  ownerSequence += 1;
  return `${prefix}-${ownerSequence}`;
}
