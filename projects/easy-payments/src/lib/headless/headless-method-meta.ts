import type { PaymentMethod } from '../models/payment-method.model';
import type { AvailablePaymentMethod } from '../services/payment-orchestrator.service';
import { PAYMENT_METHOD_PROVIDER_MAP } from '../models/payment-method.model';
import type {
  HeadlessMethodInteraction,
  HeadlessMethodStatus,
} from './headless.types';
import type { MethodReadinessState } from '../diagnostics/provider-diagnostics';

const ALL_METHODS = new Set<PaymentMethod>([
  'apple-pay',
  'google-pay',
  'paypal',
  'klarna',
  'affirm',
  'card',
]);

export function isKnownPaymentMethod(value: string): value is PaymentMethod {
  return ALL_METHODS.has(value as PaymentMethod);
}

export function interactionForMethod(
  method: PaymentMethod,
  isMock: boolean,
): HeadlessMethodInteraction {
  if (isMock) {
    return 'mock';
  }
  switch (method) {
    case 'paypal':
      return 'paypal-buttons';
    case 'google-pay':
    case 'apple-pay':
      return 'wallet-button';
    case 'card':
    case 'klarna':
    case 'affirm':
      return 'confirm';
    case 'us-bank-account':
      // ACH is Full Checkout only in 1.3.0 — Headless rejects this method at session create.
      return 'confirm';
    default: {
      const _exhaustive: never = method;
      return _exhaustive;
    }
  }
}

export function readinessOf(entry: AvailablePaymentMethod): MethodReadinessState {
  if (entry.readiness) {
    return entry.readiness;
  }
  if (entry.status === 'checking') {
    return 'loading';
  }
  if (entry.available || entry.status === 'available') {
    return 'ready';
  }
  if (
    entry.diagnosticCode === 'CONFIG_MISSING' ||
    entry.diagnosticCode === 'CONFIG_INVALID' ||
    entry.diagnosticCode === 'PROVIDER_NOT_CONFIGURED' ||
    entry.diagnosticCode === 'PROVIDER_MISCONFIGURED'
  ) {
    return 'misconfigured';
  }
  return 'unavailable';
}

/**
 * Maps orchestrator availability into Headless method status.
 * Apple Pay `checking` / loading is preserved — H2 does not invent unavailability.
 */
export function toHeadlessMethodStatus(entry: AvailablePaymentMethod): HeadlessMethodStatus {
  const readiness = readinessOf(entry);
  const interaction = interactionForMethod(entry.method, entry.isMock);
  const status: HeadlessMethodStatus = {
    method: entry.method,
    provider: PAYMENT_METHOD_PROVIDER_MAP[entry.method],
    readiness,
    available: entry.available === true && readiness === 'ready',
    requiresMount: true,
    interaction,
    mock: entry.isMock,
  };

  if (entry.diagnosticCode) {
    status.diagnosticCode = entry.diagnosticCode;
  }

  if (entry.method === 'apple-pay' && (readiness === 'loading' || entry.status === 'checking')) {
    status.readinessNote =
      'Apple Pay eligibility is confirmed after mount("apple-pay") renders the Stripe Express Checkout Element.';
  }

  return status;
}
