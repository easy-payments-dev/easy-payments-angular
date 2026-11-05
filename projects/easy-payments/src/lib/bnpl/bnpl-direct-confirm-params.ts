import type {
  ConfirmAffirmPaymentData,
  ConfirmKlarnaPaymentData,
  PaymentIntentConfirmParams,
} from '@stripe/stripe-js';
import type {
  CheckoutCustomerOptions,
  CheckoutShippingOptions,
} from '../models/checkout-options.model';
import type { EasyPaymentsAddress } from '../models/easy-payments-address.model';

const ISO_COUNTRY = /^[A-Za-z]{2}$/;

function trimText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeCountry(value: unknown): string | null {
  const country = trimText(value);
  if (!country || !ISO_COUNTRY.test(country)) {
    return null;
  }
  return country.toUpperCase();
}

function mapAddress(address: EasyPaymentsAddress | undefined): {
  line1?: string;
  line2?: string;
  city?: string;
  state?: string;
  postal_code?: string;
  country: string;
} | null {
  if (!address || typeof address !== 'object') {
    return null;
  }
  const country = normalizeCountry(address.country);
  if (!country) {
    return null;
  }
  return {
    country,
    ...(trimText(address.line1) ? { line1: trimText(address.line1) } : {}),
    ...(trimText(address.line2) ? { line2: trimText(address.line2) } : {}),
    ...(trimText(address.city) ? { city: trimText(address.city) } : {}),
    ...(trimText(address.state) ? { state: trimText(address.state) } : {}),
    ...(trimText(address.postalCode) ? { postal_code: trimText(address.postalCode) } : {}),
  };
}

function applyShipping(
  data: PaymentIntentConfirmParams,
  shipping: CheckoutShippingOptions | undefined,
): void {
  if (!shipping) {
    return;
  }
  const name = trimText(shipping.name);
  const address = mapAddress(shipping.address);
  if (!name || !address || !trimText(shipping.address?.line1) || !trimText(shipping.address?.city) || !trimText(shipping.address?.postalCode)) {
    // Incomplete shipping is omitted rather than inventing fields.
    return;
  }
  data.shipping = {
    name,
    address: {
      line1: trimText(shipping.address!.line1),
      city: trimText(shipping.address!.city),
      postal_code: trimText(shipping.address!.postalCode),
      country: address.country,
      ...(trimText(shipping.address?.line2) ? { line2: trimText(shipping.address!.line2) } : {}),
      ...(trimText(shipping.address?.state) ? { state: trimText(shipping.address!.state) } : {}),
    },
  };
}

/**
 * Builds Stripe.js Klarna Direct confirm data.
 *
 * Installed typings require `billing_details.address.country` whenever a
 * `payment_method` object is supplied. Without a valid ISO country we send
 * `return_url` (+ optional shipping) only — matching Stripe Direct API's
 * return_url-only confirm path.
 */
export function buildKlarnaDirectConfirmParams(
  returnUrl: string,
  customer?: CheckoutCustomerOptions,
  shipping?: CheckoutShippingOptions,
): ConfirmKlarnaPaymentData {
  const data: ConfirmKlarnaPaymentData = {
    return_url: returnUrl,
  };
  applyShipping(data, shipping);

  const mapped = mapAddress(customer?.address);
  if (!mapped) {
    return data;
  }

  const email = trimText(customer?.email);
  const name = trimText(customer?.name);
  const phone = trimText(customer?.phone);

  data.payment_method = {
    billing_details: {
      address: mapped,
      ...(email ? { email } : {}),
      ...(name ? { name } : {}),
      ...(phone ? { phone } : {}),
    },
  };
  return data;
}

/**
 * Builds Stripe.js Affirm Direct confirm data.
 * Billing/shipping are optional at the Stripe API level; incomplete maps are omitted.
 */
export function buildAffirmDirectConfirmParams(
  returnUrl: string,
  customer?: CheckoutCustomerOptions,
  shipping?: CheckoutShippingOptions,
): ConfirmAffirmPaymentData {
  const data: ConfirmAffirmPaymentData = {
    return_url: returnUrl,
  };
  applyShipping(data, shipping);

  const email = trimText(customer?.email);
  const name = trimText(customer?.name);
  const phone = trimText(customer?.phone);
  const mapped = mapAddress(customer?.address);

  if (!email && !name && !phone && !mapped) {
    return data;
  }

  data.payment_method = {
    billing_details: {
      ...(email ? { email } : {}),
      ...(name ? { name } : {}),
      ...(phone ? { phone } : {}),
      ...(mapped ? { address: mapped } : {}),
    },
  };
  return data;
}
