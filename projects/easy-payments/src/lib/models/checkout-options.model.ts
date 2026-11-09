import type { EasyPaymentsAddress } from './easy-payments-address.model';

export type CheckoutSuccessBehavior = 'confirmation' | 'event-only';

export interface CheckoutCustomerOptions {
  email?: string;
  name?: string;
  /** Optional phone in E.164 or merchant-local format. Not sent to backends yet. */
  phone?: string;
  /**
   * Optional billing address.
   * Country must be ISO 3166-1 alpha-2. Not sent to backends yet.
   */
  address?: EasyPaymentsAddress;
}

export interface CheckoutShippingOptions {
  /** When true, BNPL Direct readiness requires shipping name + address. */
  required?: boolean;
  /** Shipping recipient name. Not sent to backends yet. */
  name?: string;
  /**
   * Optional shipping address.
   * Country must be ISO 3166-1 alpha-2. Not sent to backends yet.
   */
  address?: EasyPaymentsAddress;
}

export interface CheckoutOptions {
  successUrl?: string;
  cancelUrl?: string;
  /**
   * Controls built-in success confirmation UI after a successful payment.
   * - confirmation (default): show Easy Payments success screen
   * - event-only: emit (success) only; merchant handles post-payment UX/navigation
   *
   * Existing successUrl / cancelUrl remain merchant-controlled hints and do not
   * trigger automatic redirects inside Easy Payments.
   */
  successBehavior?: CheckoutSuccessBehavior;
  customer?: CheckoutCustomerOptions;
  shipping?: CheckoutShippingOptions;
}
