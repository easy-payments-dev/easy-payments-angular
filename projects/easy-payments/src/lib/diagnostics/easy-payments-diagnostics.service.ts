import { computed, inject, Injectable, Signal } from '@angular/core';
import { PaymentMethod, PAYMENT_METHOD_PROVIDER_MAP, type PaymentProviderName } from '../models';
import {
  PaymentOrchestratorService,
  type AvailablePaymentMethod,
} from '../services/payment-orchestrator.service';
import { MethodReadinessState, sanitizeDiagnosticText } from './provider-diagnostics';

/**
 * Stable diagnostic codes Easy Payments may attach to a method snapshot.
 * `BACKEND_BASE_URL_INVALID` and `BACKEND_ENDPOINT_INVALID` are also emitted as
 * development-console warnings. Availability currently reports the affected
 * method as `PROVIDER_MISCONFIGURED` and does not include the raw URL.
 */
export const EASY_PAYMENTS_DIAGNOSTIC_CODES = [
  'PROVIDER_AVAILABILITY_PENDING',
  'PROVIDER_UNAVAILABLE',
  'PROVIDER_MISCONFIGURED',
  'PROVIDER_NOT_CONFIGURED',
  'STRIPE_INITIALIZATION_FAILED',
  'CONFIG_MISSING',
  'CONFIG_INVALID',
  'SDK_LOAD_FAILED',
  'BACKEND_ERROR',
  'BACKEND_BASE_URL_INVALID',
  'BACKEND_ENDPOINT_INVALID',
  'PROVIDER_NOT_IMPLEMENTED',
  'NETWORK_ERROR',
  'AUTHENTICATION_REQUIRED',
  'AUTHENTICATION_FAILED',
  'PRODUCT_INVALID',
  'PAYMENT_FAILED',
  'CARD_DECLINED',
  'PAYMENT_CANCELLED',
  'UNKNOWN',
] as const;

/** Machine-readable diagnostic code. Values in this union are stable. */
export type EasyPaymentsDiagnosticCode = (typeof EASY_PAYMENTS_DIAGNOSTIC_CODES)[number];

/**
 * Read-only readiness for one payment method.
 * Messages are fixed developer text. Snapshots never include credentials,
 * client secrets, raw provider errors, or request headers.
 */
export interface PaymentMethodDiagnostic {
  readonly method: PaymentMethod;
  readonly provider: PaymentProviderName;
  readonly readiness: MethodReadinessState;
  readonly code?: EasyPaymentsDiagnosticCode;
  readonly message: string;
  readonly mock: boolean;
}

/**
 * Immutable view of checkout readiness.
 * `published` is false until `PaymentOrchestratorService.refreshAvailability`
 * completes, and false again after `reinitialize()` until the next refresh.
 * An empty method list before publication is not a ready checkout.
 *
 * This snapshot is **global / last-refresh**: it mirrors the root orchestrator,
 * not a specific `<easy-payments>` instance. Concurrent checkouts keep
 * independent tile visibility via per-instance availability sessions; inject
 * diagnostics for app-wide developer readiness, not per-host UI state.
 */
export interface EasyPaymentsDiagnosticsSnapshot {
  readonly published: boolean;
  readonly methods: readonly PaymentMethodDiagnostic[];
}

const DIAGNOSTIC_CODE_SET = new Set<string>(EASY_PAYMENTS_DIAGNOSTIC_CODES);

const DIAGNOSTIC_MESSAGES: Record<EasyPaymentsDiagnosticCode, string> = {
  PROVIDER_AVAILABILITY_PENDING: 'This payment method is still checking availability.',
  PROVIDER_UNAVAILABLE: 'This payment method is unavailable in the current environment.',
  PROVIDER_MISCONFIGURED: 'This payment method is misconfigured.',
  PROVIDER_NOT_CONFIGURED: 'No payment provider is configured for this method.',
  STRIPE_INITIALIZATION_FAILED: 'Stripe failed to initialize. Other providers are unaffected.',
  CONFIG_MISSING: 'Required provider configuration is missing.',
  CONFIG_INVALID: 'Provider configuration is invalid.',
  SDK_LOAD_FAILED: 'The payment provider SDK could not be loaded.',
  BACKEND_ERROR: 'The payment backend could not complete the request.',
  BACKEND_BASE_URL_INVALID: 'backend.baseUrl must be an absolute http or https URL.',
  BACKEND_ENDPOINT_INVALID:
    'A backend endpoint must be a relative path or an absolute http(s) URL.',
  PROVIDER_NOT_IMPLEMENTED: 'This payment provider is not implemented.',
  NETWORK_ERROR: 'A network error occurred while preparing this payment method.',
  AUTHENTICATION_REQUIRED: 'Additional authentication is required for this payment method.',
  AUTHENTICATION_FAILED: 'Authentication failed for this payment method.',
  PRODUCT_INVALID: 'The payment product is invalid.',
  PAYMENT_FAILED: 'The payment could not be completed.',
  CARD_DECLINED: 'The card was declined.',
  PAYMENT_CANCELLED: 'The payment was cancelled.',
  UNKNOWN: 'This payment method is unavailable.',
};

const READY_MESSAGE = 'This payment method is ready.';
const LOADING_MESSAGE = 'This payment method is still loading.';
const UNAVAILABLE_MESSAGE = 'This payment method is unavailable.';
const MISCONFIGURED_MESSAGE = 'This payment method is misconfigured.';

/**
 * Public, read-only view of payment-method readiness.
 *
 * Projects the root `PaymentOrchestratorService` availability snapshot (the
 * latest `refreshAvailability` call in the app). It does not calculate a
 * second readiness result, poll, or read browser globals. Per-checkout tile
 * visibility is owned by each component's local availability session and may
 * differ from this global projection when multiple hosts are mounted.
 */
@Injectable({ providedIn: 'root' })
export class EasyPaymentsDiagnosticsService {
  private readonly orchestrator = inject(PaymentOrchestratorService);

  /** Updates when availability is published or cleared. */
  readonly diagnostics: Signal<EasyPaymentsDiagnosticsSnapshot> = computed(() =>
    this.freezeSnapshot(this.projectSnapshot()),
  );

  /** Frozen copy of the current snapshot. */
  snapshot(): EasyPaymentsDiagnosticsSnapshot {
    return this.freezeSnapshot(this.diagnostics());
  }

  /** Frozen copy of one method, or undefined when that method is not in the snapshot. */
  method(method: PaymentMethod): PaymentMethodDiagnostic | undefined {
    const found = this.diagnostics().methods.find((entry) => entry.method === method);
    return found ? this.cloneDiagnostic(found) : undefined;
  }

  private projectSnapshot(): EasyPaymentsDiagnosticsSnapshot {
    return {
      published: this.orchestrator.availabilityPublished(),
      methods: this.orchestrator.availableMethods().map((entry) => this.toDiagnostic(entry)),
    };
  }

  private toDiagnostic(entry: AvailablePaymentMethod): PaymentMethodDiagnostic {
    const readiness = this.readinessOf(entry);
    const code = readiness === 'ready' ? undefined : this.knownCode(entry.diagnosticCode);
    return {
      method: entry.method,
      provider: PAYMENT_METHOD_PROVIDER_MAP[entry.method],
      readiness,
      ...(code ? { code } : {}),
      message: this.messageFor(readiness, code),
      mock: entry.isMock,
    };
  }

  private readinessOf(entry: AvailablePaymentMethod): MethodReadinessState {
    if (entry.readiness) {
      return entry.readiness;
    }
    if (entry.status === 'checking') {
      return 'loading';
    }
    if (entry.available || entry.status === 'available') {
      return 'ready';
    }
    return 'unavailable';
  }

  private knownCode(code: string | undefined): EasyPaymentsDiagnosticCode | undefined {
    if (code && DIAGNOSTIC_CODE_SET.has(code)) {
      return code as EasyPaymentsDiagnosticCode;
    }
    return undefined;
  }

  private messageFor(
    readiness: MethodReadinessState,
    code: EasyPaymentsDiagnosticCode | undefined,
  ): string {
    if (readiness === 'ready') {
      return READY_MESSAGE;
    }
    if (code) {
      return sanitizeDiagnosticText(DIAGNOSTIC_MESSAGES[code]);
    }
    if (readiness === 'loading') {
      return LOADING_MESSAGE;
    }
    if (readiness === 'misconfigured') {
      return MISCONFIGURED_MESSAGE;
    }
    return UNAVAILABLE_MESSAGE;
  }

  private cloneDiagnostic(entry: PaymentMethodDiagnostic): PaymentMethodDiagnostic {
    return Object.freeze({
      method: entry.method,
      provider: entry.provider,
      readiness: entry.readiness,
      ...(entry.code ? { code: entry.code } : {}),
      message: entry.message,
      mock: entry.mock,
    });
  }

  private freezeSnapshot(snapshot: EasyPaymentsDiagnosticsSnapshot): EasyPaymentsDiagnosticsSnapshot {
    return Object.freeze({
      published: snapshot.published,
      methods: Object.freeze(snapshot.methods.map((entry) => this.cloneDiagnostic(entry))),
    });
  }
}
