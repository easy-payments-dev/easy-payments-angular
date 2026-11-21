import { appendMetadataSessionPart } from '../../metadata/merchant-metadata';
import { PaymentProduct } from '../../models';

export type AmazonPayUiState =
  | 'idle'
  | 'initializing'
  | 'ready'
  | 'unavailable'
  | 'processing'
  | 'success'
  | 'error';

/**
 * Production Amazon Pay availability — decided only by the mounted Express Checkout
 * Element `ready` event (`availablePaymentMethods.amazonPay`). Never by a hidden probe,
 * timeout, UA sniffing, or OS checks.
 *
 * - `idle` / `checking` = UNKNOWN (must not expose Amazon Pay in the method list)
 * - `available` = Stripe reported amazonPay:true for the current session
 * - `unavailable` / `error` = Stripe reported amazonPay:false or load failure
 */
export type AmazonPayAvailabilityState =
  | 'idle'
  | 'checking'
  | 'available'
  | 'unavailable'
  | 'error'
  | 'indeterminate';

export function buildAmazonPayRenderKey(product: PaymentProduct): string {
  return appendMetadataSessionPart(
    [product.id, product.quantity ?? 1, product.currency.trim().toUpperCase(), product.amount].join(
      '|',
    ),
    product.metadata,
  );
}
