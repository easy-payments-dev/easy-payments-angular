import type { BnplConfirmMode } from '../models/bnpl-confirm-mode.model';
import type { CheckoutOptions } from '../models/checkout-options.model';
import type { EasyPaymentsAddress } from '../models/easy-payments-address.model';

/** BNPL methods that may use Direct confirmation in a future Buttons Only milestone. */
export type BnplDirectProvider = 'klarna' | 'affirm';

export type BnplSelectedFlow = 'direct' | 'element' | 'configuration-error';

/**
 * Stable machine-readable readiness codes. Values never include customer PII.
 */
export type BnplReadinessReasonCode =
  | 'mode_element'
  | 'missing_email'
  | 'missing_name'
  | 'missing_billing_address'
  | 'incomplete_billing_address'
  | 'invalid_billing_country'
  | 'missing_shipping_name'
  | 'missing_shipping_address'
  | 'incomplete_shipping_address'
  | 'invalid_shipping_country'
  | 'direct_not_ready'
  | 'ready';

/**
 * Field paths describing what is missing or invalid (not the field values).
 * Example: `customer.email`, `customer.address.country`.
 */
export type BnplReadinessFieldPath = string;

export interface BnplReadinessResult {
  /** True when library Direct readiness policy is satisfied for the provider. */
  ready: boolean;
  /**
   * Flow Buttons Only selects for the given mode when `[bnplConfirmMode]` is set.
   * Full Checkout and Headless ignore this helper for payment execution.
   */
  selectedFlow: BnplSelectedFlow;
  missingFields: BnplReadinessFieldPath[];
  reasonCodes: BnplReadinessReasonCode[];
}

export interface EvaluateBnplDirectReadinessInput {
  provider: BnplDirectProvider;
  /** Defaults to `auto` when omitted / null / undefined. */
  mode?: BnplConfirmMode | null;
  checkout?: CheckoutOptions | null;
}

const ISO_COUNTRY = /^[A-Za-z]{2}$/;

function trimText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function hasText(value: unknown): boolean {
  return trimText(value).length > 0;
}

function isValidCountryCode(value: unknown): boolean {
  return ISO_COUNTRY.test(trimText(value));
}

/**
 * Completeness for library Direct readiness (not a claim about Stripe's absolute API).
 * Requires line1, city, postalCode, and a valid ISO alpha-2 country.
 */
function inspectAddress(
  address: EasyPaymentsAddress | null | undefined,
  prefix: 'customer.address' | 'shipping.address',
): {
  present: boolean;
  complete: boolean;
  invalidCountry: boolean;
  missingFields: BnplReadinessFieldPath[];
} {
  if (address == null || typeof address !== 'object') {
    return {
      present: false,
      complete: false,
      invalidCountry: false,
      missingFields: [prefix],
    };
  }

  const missingFields: BnplReadinessFieldPath[] = [];
  if (!hasText(address.line1)) {
    missingFields.push(`${prefix}.line1`);
  }
  if (!hasText(address.city)) {
    missingFields.push(`${prefix}.city`);
  }
  if (!hasText(address.postalCode)) {
    missingFields.push(`${prefix}.postalCode`);
  }

  const country = trimText(address.country);
  let invalidCountry = false;
  if (!country) {
    missingFields.push(`${prefix}.country`);
  } else if (!isValidCountryCode(country)) {
    invalidCountry = true;
    missingFields.push(`${prefix}.country`);
  }

  return {
    present: true,
    complete: missingFields.length === 0 && !invalidCountry,
    invalidCountry,
    missingFields,
  };
}

function uniquePreserveOrder(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (seen.has(value)) {
      continue;
    }
    seen.add(value);
    out.push(value);
  }
  return out;
}

/**
 * Evaluates Easy Payments library UX readiness for Klarna/Affirm Direct confirmation.
 *
 * This is **not** a network call and does not create or confirm PaymentIntents.
 * It does not mutate `checkout`.
 *
 * Library policy (stricter than / distinct from Stripe API minimums):
 * - Klarna: email + name; shipping name+address when `shipping.required`.
 * - Affirm: email + name + complete billing address; shipping when required.
 */
export function evaluateBnplDirectReadiness(
  input: EvaluateBnplDirectReadinessInput,
): BnplReadinessResult {
  const mode: BnplConfirmMode = input.mode ?? 'auto';
  const checkout = input.checkout ?? null;
  const customer = checkout?.customer;
  const shipping = checkout?.shipping;

  if (mode === 'element') {
    return {
      ready: false,
      selectedFlow: 'element',
      missingFields: [],
      reasonCodes: ['mode_element'],
    };
  }

  const missingFields: BnplReadinessFieldPath[] = [];
  const reasonCodes: BnplReadinessReasonCode[] = [];

  if (!hasText(customer?.email)) {
    missingFields.push('customer.email');
    reasonCodes.push('missing_email');
  }
  if (!hasText(customer?.name)) {
    missingFields.push('customer.name');
    reasonCodes.push('missing_name');
  }

  if (input.provider === 'affirm') {
    const billing = inspectAddress(customer?.address, 'customer.address');
    if (!billing.present) {
      reasonCodes.push('missing_billing_address');
      missingFields.push(...billing.missingFields);
    } else if (billing.invalidCountry) {
      reasonCodes.push('invalid_billing_country');
      missingFields.push(...billing.missingFields);
    } else if (!billing.complete) {
      reasonCodes.push('incomplete_billing_address');
      missingFields.push(...billing.missingFields);
    }
  } else if (customer?.address != null) {
    // Klarna: billing optional; if supplied, reject malformed country / incomplete shapes.
    const billing = inspectAddress(customer.address, 'customer.address');
    if (billing.invalidCountry) {
      reasonCodes.push('invalid_billing_country');
      missingFields.push(...billing.missingFields);
    } else if (!billing.complete) {
      reasonCodes.push('incomplete_billing_address');
      missingFields.push(...billing.missingFields);
    }
  }

  if (shipping?.required === true) {
    if (!hasText(shipping.name)) {
      missingFields.push('shipping.name');
      reasonCodes.push('missing_shipping_name');
    }
    const shipAddr = inspectAddress(shipping.address, 'shipping.address');
    if (!shipAddr.present) {
      reasonCodes.push('missing_shipping_address');
      missingFields.push(...shipAddr.missingFields);
    } else if (shipAddr.invalidCountry) {
      reasonCodes.push('invalid_shipping_country');
      missingFields.push(...shipAddr.missingFields);
    } else if (!shipAddr.complete) {
      reasonCodes.push('incomplete_shipping_address');
      missingFields.push(...shipAddr.missingFields);
    }
  }

  const ready = missingFields.length === 0 && reasonCodes.length === 0;
  const uniqueMissing = uniquePreserveOrder(missingFields);
  const uniqueReasons = uniquePreserveOrder(reasonCodes) as BnplReadinessReasonCode[];

  if (ready) {
    return {
      ready: true,
      selectedFlow: 'direct',
      missingFields: [],
      reasonCodes: ['ready'],
    };
  }

  if (mode === 'direct') {
    return {
      ready: false,
      selectedFlow: 'configuration-error',
      missingFields: uniqueMissing,
      reasonCodes: uniquePreserveOrder([...uniqueReasons, 'direct_not_ready']) as BnplReadinessReasonCode[],
    };
  }

  // auto → Payment Element fallback when Direct readiness is incomplete.
  return {
    ready: false,
    selectedFlow: 'element',
    missingFields: uniqueMissing,
    reasonCodes: uniqueReasons,
  };
}
