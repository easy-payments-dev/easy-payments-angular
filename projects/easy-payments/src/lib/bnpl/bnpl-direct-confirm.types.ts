import type {
  CheckoutCustomerOptions,
  CheckoutShippingOptions,
} from '../models/checkout-options.model';

/**
 * Explicit Direct confirmation request for Klarna/Affirm adapters.
 *
 * Caller (future Buttons Only orchestration) owns:
 * - PaymentIntent creation (method-locked, server-priced)
 * - Redirect marker / ownership lifecycle
 * - Readiness checks via {@link evaluateBnplDirectReadiness}
 *
 * Adapters do not create Intents, mount Payment Element, or write return markers.
 */
export interface BnplDirectConfirmationRequest {
  /** Client secret of an existing method-locked Klarna or Affirm PaymentIntent. */
  clientSecret: string;
  /** Absolute return URL (orchestration should stamp ep_method / attempt params). */
  returnUrl: string;
  customer?: CheckoutCustomerOptions;
  shipping?: CheckoutShippingOptions;
}
