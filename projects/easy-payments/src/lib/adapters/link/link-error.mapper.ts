import { PaymentError } from '../../errors/payment-error';

/**
 * Maps Stripe / Link wallet errors to customer-safe PaymentError.
 * Never surfaces raw Stripe JSON or Link credentials.
 */
export function mapLinkError(
  error: unknown,
  fallbackCode: PaymentError['code'] = 'PAYMENT_FAILED',
  fallbackMessage = 'Link payment failed.',
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
      message: 'Link was cancelled.',
      method: 'link',
      provider: 'link',
      originalError: error,
    });
  }

  return new PaymentError({
    code: fallbackCode,
    message,
    method: 'link',
    provider: 'link',
    originalError: error,
  });
}
