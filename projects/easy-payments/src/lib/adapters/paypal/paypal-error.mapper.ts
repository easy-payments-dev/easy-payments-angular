import { PaymentError, PaymentErrorCode } from '../../errors/payment-error';

/**
 * Maps PayPal JS SDK / REST failures into PaymentError without leaking raw payloads to UI.
 */
export function mapPayPalError(
  error: unknown,
  fallbackCode: PaymentErrorCode = 'PAYMENT_FAILED',
  fallbackMessage = 'PayPal payment failed.',
): PaymentError {
  if (error instanceof PaymentError) {
    return error;
  }

  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : fallbackMessage;

  const lower = message.toLowerCase();

  if (
    lower.includes('cancel') ||
    lower.includes('closed') ||
    lower.includes('window closed') ||
    lower.includes('popup closed')
  ) {
    return new PaymentError({
      code: 'PAYMENT_CANCELLED',
      message: 'PayPal checkout was cancelled.',
      method: 'paypal',
      provider: 'paypal',
      originalError: error,
    });
  }

  if (lower.includes('network') || lower.includes('failed to fetch')) {
    return new PaymentError({
      code: 'NETWORK_ERROR',
      message: 'A network error occurred during PayPal checkout.',
      method: 'paypal',
      provider: 'paypal',
      originalError: error,
    });
  }

  // Script/network load only — do not treat Buttons create/render messages as SDK load.
  if (
    lower.includes('failed to load sdk') ||
    lower.includes('sdk failed to load') ||
    lower.includes('sdk script') ||
    lower.includes('window.paypal') ||
    lower.includes('sdk load timed out') ||
    lower.includes('timed out loading')
  ) {
    return new PaymentError({
      code: 'SDK_LOAD_FAILED',
      message: 'PayPal SDK failed to load.',
      method: 'paypal',
      provider: 'paypal',
      originalError: error,
    });
  }

  if (lower.includes('declin')) {
    return new PaymentError({
      code: 'PAYMENT_FAILED',
      message: 'The PayPal payment was declined.',
      method: 'paypal',
      provider: 'paypal',
      originalError: error,
    });
  }

  if (lower.includes('duplicate') || lower.includes('already captured')) {
    return new PaymentError({
      code: 'PAYMENT_FAILED',
      message: 'This PayPal order was already captured.',
      method: 'paypal',
      provider: 'paypal',
      originalError: error,
    });
  }

  return new PaymentError({
    code: fallbackCode,
    message: message || fallbackMessage,
    method: 'paypal',
    provider: 'paypal',
    originalError: error,
  });
}
