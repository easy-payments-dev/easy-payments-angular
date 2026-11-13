import type { PaymentMethod } from '../models/payment-method.model';
import type { EasyPaymentButtonsSelectorLabels } from '../models/easy-payment-buttons-appearance.model';

/**
 * Resolve a plain-text selector label override for library-owned methods.
 * Returns null when missing, blank, or invalid so callers keep localized defaults.
 */
export function resolveSelectorLabelOverride(
  labels: EasyPaymentButtonsSelectorLabels | null | undefined,
  method: PaymentMethod,
): string | null {
  if (
    !labels ||
    (method !== 'card' &&
      method !== 'klarna' &&
      method !== 'affirm' &&
      method !== 'us-bank-account' &&
      method !== 'cash-app-pay' &&
      method !== 'afterpay' &&
      method !== 'venmo')
  ) {
    return null;
  }
  const key =
    method === 'us-bank-account'
      ? 'usBankAccount'
      : method === 'cash-app-pay'
        ? 'cashAppPay'
        : method;
  return sanitizeSelectorLabel(labels[key]);
}

/** Plain text only. Rejects markup so a label cannot inject HTML. */
export function sanitizeSelectorLabel(value: string | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.replace(/[\u0000-\u001F\u007F]/g, '').replace(/\s+/g, ' ').trim();
  if (!trimmed || trimmed.length > 64 || /[<>]/.test(trimmed)) {
    return null;
  }
  return trimmed;
}
