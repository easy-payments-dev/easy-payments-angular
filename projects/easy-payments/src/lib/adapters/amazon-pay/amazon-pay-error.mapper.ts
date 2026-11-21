import { PaymentError } from '../../errors/payment-error';

/**
 * Maps Stripe / Amazon Pay wallet errors to customer-safe PaymentError.
 * Never surfaces raw Stripe JSON or Amazon Pay credentials.
 */
export function mapAmazonPayError(
  error: unknown,
  fallbackCode: PaymentError['code'] = 'PAYMENT_FAILED',
  fallbackMessage = 'Amazon Pay payment failed.',
): PaymentError {
  if (error instanceof PaymentError) {
    return error;
  }

  const stripeLike = error as {
    type?: string;
    code?: string;
    message?: string;
    decline_code?: string;
  } | null;

  const message =
    typeof stripeLike?.message === 'string' && stripeLike.message.trim()
      ? stripeLike.message.trim()
      : fallbackMessage;

  const code = stripeLike?.code?.toLowerCase() ?? '';
  const type = stripeLike?.type?.toLowerCase() ?? '';

  if (
    code === 'canceled' ||
    code === 'cancelled' ||
    type === 'canceled' ||
    /cancel/i.test(message)
  ) {
    return new PaymentError({
      code: 'PAYMENT_CANCELLED',
      message: 'Amazon Pay was cancelled.',
      method: 'amazon-pay',
      provider: 'amazonPay',
      originalError: error,
    });
  }

  return new PaymentError({
    code: fallbackCode,
    message,
    method: 'amazon-pay',
    provider: 'amazonPay',
    originalError: error,
  });
}
