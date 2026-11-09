/**
 * Buttons Only BNPL Direct demo controls (session-scoped).
 * Survives Klarna/Affirm redirect remounts in the same tab.
 * Stores only demo form values — never secrets, client secrets, or PaymentIntent ids.
 */

import type { BnplConfirmMode } from '@easy-payments/angular';

export const DEMO_BNPL_BUTTONS_STORAGE_KEY = 'easy-payments-demo-bnpl-buttons';

export interface DemoBnplButtonsPersistedState {
  bnplConfirmMode: BnplConfirmMode;
  customerEmail: string;
  customerName: string;
  customerPhone: string;
  billingLine1: string;
  billingLine2: string;
  billingCity: string;
  billingState: string;
  billingPostalCode: string;
  billingCountry: string;
  shippingRequired: boolean;
  shippingName: string;
  shippingLine1: string;
  shippingLine2: string;
  shippingCity: string;
  shippingState: string;
  shippingPostalCode: string;
  shippingCountry: string;
}

const MODES: readonly BnplConfirmMode[] = ['element', 'auto', 'direct'];

const EMPTY_STATE: DemoBnplButtonsPersistedState = {
  bnplConfirmMode: 'element',
  customerEmail: '',
  customerName: '',
  customerPhone: '',
  billingLine1: '',
  billingLine2: '',
  billingCity: '',
  billingState: '',
  billingPostalCode: '',
  billingCountry: '',
  shippingRequired: false,
  shippingName: '',
  shippingLine1: '',
  shippingLine2: '',
  shippingCity: '',
  shippingState: '',
  shippingPostalCode: '',
  shippingCountry: '',
};

/** Stripe docs–style TEST fixture placeholders (not real personal data). */
export const DEMO_BNPL_TEST_SAMPLE: Omit<DemoBnplButtonsPersistedState, 'bnplConfirmMode'> = {
  customerEmail: 'jenny.rosen@example.com',
  customerName: 'Jenny Rosen',
  customerPhone: '+15555550100',
  billingLine1: '510 Townsend St',
  billingLine2: '',
  billingCity: 'San Francisco',
  billingState: 'CA',
  billingPostalCode: '94103',
  billingCountry: 'US',
  shippingRequired: false,
  shippingName: 'Jenny Rosen',
  shippingLine1: '510 Townsend St',
  shippingLine2: '',
  shippingCity: 'San Francisco',
  shippingState: 'CA',
  shippingPostalCode: '94103',
  shippingCountry: 'US',
};

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asBoolean(value: unknown): boolean {
  return value === true;
}

function asMode(value: unknown): BnplConfirmMode {
  return typeof value === 'string' && (MODES as readonly string[]).includes(value)
    ? (value as BnplConfirmMode)
    : 'element';
}

export function defaultDemoBnplButtonsState(): DemoBnplButtonsPersistedState {
  return { ...EMPTY_STATE };
}

export function readPersistedDemoBnplButtons(
  storage?: Storage,
): DemoBnplButtonsPersistedState {
  const store =
    storage ?? (typeof sessionStorage !== 'undefined' ? sessionStorage : undefined);
  if (!store || typeof store.getItem !== 'function') {
    return defaultDemoBnplButtonsState();
  }
  try {
    const raw = store.getItem(DEMO_BNPL_BUTTONS_STORAGE_KEY);
    if (!raw) {
      return defaultDemoBnplButtonsState();
    }
    const parsed = JSON.parse(raw) as Partial<DemoBnplButtonsPersistedState>;
    return {
      bnplConfirmMode: asMode(parsed.bnplConfirmMode),
      customerEmail: asString(parsed.customerEmail),
      customerName: asString(parsed.customerName),
      customerPhone: asString(parsed.customerPhone),
      billingLine1: asString(parsed.billingLine1),
      billingLine2: asString(parsed.billingLine2),
      billingCity: asString(parsed.billingCity),
      billingState: asString(parsed.billingState),
      billingPostalCode: asString(parsed.billingPostalCode),
      billingCountry: asString(parsed.billingCountry),
      shippingRequired: asBoolean(parsed.shippingRequired),
      shippingName: asString(parsed.shippingName),
      shippingLine1: asString(parsed.shippingLine1),
      shippingLine2: asString(parsed.shippingLine2),
      shippingCity: asString(parsed.shippingCity),
      shippingState: asString(parsed.shippingState),
      shippingPostalCode: asString(parsed.shippingPostalCode),
      shippingCountry: asString(parsed.shippingCountry),
    };
  } catch {
    return defaultDemoBnplButtonsState();
  }
}

export function persistDemoBnplButtons(
  state: DemoBnplButtonsPersistedState,
  storage?: Storage,
): void {
  const store =
    storage ?? (typeof sessionStorage !== 'undefined' ? sessionStorage : undefined);
  if (!store || typeof store.setItem !== 'function') {
    return;
  }
  try {
    store.setItem(DEMO_BNPL_BUTTONS_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Ignore quota / private-mode failures.
  }
}
