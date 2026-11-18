import type { PaymentErrorCode } from '../errors/payment-error';
import type { PaymentMethod } from '../models';
import type { EasyPaymentsTranslations } from './translations.types';

export interface LocalizePaymentErrorContext {
  method?: PaymentMethod;
}

/**
 * Map a normalized PaymentError code to a customer-facing localized string.
 * Never returns the technical/provider English diagnostic from PaymentError.message.
 *
 * Zip CONFIG_MISSING / CONFIG_INVALID use zipUnavailable (same as the Zip tile) so
 * buyers are told to choose another method rather than a generic config message.
 */
export function localizePaymentError(
  code: PaymentErrorCode | undefined,
  messages: EasyPaymentsTranslations,
  context?: LocalizePaymentErrorContext,
): string {
  if (
    (code === 'CONFIG_MISSING' || code === 'CONFIG_INVALID') &&
    context?.method === 'zip'
  ) {
    return messages.zipUnavailable;
  }

  switch (code) {
    case 'CARD_DECLINED':
      return messages.errorDetailCardDeclined;
    case 'NETWORK_ERROR':
      return messages.errorDetailNetwork;
    case 'CONFIG_MISSING':
    case 'CONFIG_INVALID':
      return messages.errorDetailConfig;
    case 'PROVIDER_UNAVAILABLE':
    case 'PROVIDER_NOT_CONFIGURED':
    case 'PROVIDER_NOT_IMPLEMENTED':
      if (context?.method === 'google-pay') {
        return messages.googlePayUnavailable;
      }
      if (context?.method === 'apple-pay') {
        return messages.applePayUnavailable;
      }
      return messages.errorDetailUnavailable;
    case 'AUTHENTICATION_REQUIRED':
      return messages.errorDetailAuthRequired;
    case 'AUTHENTICATION_FAILED':
      return messages.errorDetailAuthFailed;
    case 'SDK_LOAD_FAILED':
      return messages.errorDetailSdkLoad;
    case 'BACKEND_ERROR':
      return messages.errorDetailBackend;
    case 'PRODUCT_INVALID':
      return messages.errorDetailProductInvalid;
    case 'PAYMENT_CANCELLED':
      return messages.errorDetailCancelled;
    case 'PAYMENT_FAILED':
    case 'UNKNOWN':
    default:
      return messages.errorBody;
  }
}
