import { appendMetadataSessionPart } from '../../metadata/merchant-metadata';
import { PaymentProduct } from '../../models';

export type LinkUiState =
  | 'idle'
  | 'initializing'
  | 'ready'
  | 'unavailable'
  | 'processing'
  | 'success'
  | 'error';

/**
 * Production Link availability — decided only by the mounted Express Checkout
 * Element `ready` event (`availablePaymentMethods.link`). Never by a hidden probe,
 * timeout, UA sniffing, or OS checks.
 *
 * - `idle` / `checking` = UNKNOWN (must not expose Link in the method list)
 * - `available` = Stripe reported link:true for the current session
 * - `unavailable` / `error` = Stripe reported link:false or load failure
 */
export type LinkAvailabilityState =
  | 'idle'
  | 'checking'
  | 'available'
  | 'unavailable'
  | 'error'
  | 'indeterminate';

export function buildLinkRenderKey(product: PaymentProduct): string {
  return appendMetadataSessionPart(
    [product.id, product.quantity ?? 1, product.currency.trim().toUpperCase(), product.amount].join(
      '|',
    ),
    product.metadata,
  );
}
