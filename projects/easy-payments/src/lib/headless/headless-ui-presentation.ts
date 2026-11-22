import type { MethodReadinessState } from '../diagnostics/provider-diagnostics';
import { PaymentError, type PaymentErrorCode } from '../errors/payment-error';
import type { PaymentResult } from '../models';
import { localizePaymentError } from '../i18n/localize-payment-error';
import type { EasyPaymentsTranslations } from '../i18n/translations.types';
import type { HeadlessSessionState } from './headless.types';

/**
 * Buyer-facing Headless presentation kind derived from session signals.
 * Readiness (availableMethods) stays separate from payment outcome.
 */
export type HeadlessUiKind =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'processing'
  | 'pending'
  | 'success'
  | 'cancelled'
  | 'error'
  | 'unavailable'
  | 'destroyed';

/**
 * Host guidance for the next safe step. Never creates a charge by itself —
 * the host still calls `confirm()` / `recoverReturn()` / selects another method.
 */
export type HeadlessRecoveryAction =
  | 'none'
  /** Definitive payment failure — host may call `confirm()` again after remount if needed. */
  | 'retry-payment'
  /** Transient recoverReturn verification failure — call `recoverReturn()` again (no new PI). */
  | 'retry-recovery'
  /** Uncertain / processing — reconcile on backend; do not start another payment. */
  | 'reconcile'
  /** Merchant configuration / availability — choose another method; do not retry payment. */
  | 'choose-another-method';

export interface HeadlessUiPresentation {
  kind: HeadlessUiKind;
  /** Localized short title for host UI. */
  title: string;
  /** Localized buyer-safe body (never raw SDK / secret text). */
  body: string;
  recoveryAction: HeadlessRecoveryAction;
  /** Stable technical code when kind is `error` / `unavailable`. */
  errorCode?: PaymentErrorCode;
}

export interface DescribeHeadlessUiInput {
  state: HeadlessSessionState;
  messages: EasyPaymentsTranslations;
  lastError?: PaymentError | null;
  lastResult?: PaymentResult | null;
  /**
   * Optional readiness of the currently selected method.
   * When `unavailable` / `misconfigured` while the session is otherwise ready,
   * presentation switches to `unavailable` without collapsing payment outcomes.
   */
  selectedReadiness?: MethodReadinessState | null;
}

/**
 * Transient recoverReturn() verification failures that are safe to retry
 * without creating a new PaymentIntent.
 */
export function isHeadlessRecoveryRetryable(error: unknown): boolean {
  const code = paymentErrorCodeOf(error);
  return code === 'NETWORK_ERROR' || code === 'SDK_LOAD_FAILED';
}

/**
 * Whether a host may offer a payment retry for the current session error.
 * Never true for configuration failures, pending/processing, or cancelled success paths.
 */
export function isHeadlessPaymentRetryAllowed(
  state: HeadlessSessionState,
  error: PaymentError | null | undefined,
): boolean {
  if (state === 'pending' || state === 'processing' || state === 'success' || state === 'destroyed') {
    return false;
  }
  if (!error) {
    return state === 'error' || state === 'cancelled' || state === 'ready';
  }
  if (isConfigurationFailure(error.code) || isAvailabilityFailure(error.code)) {
    return false;
  }
  if (error.code === 'AUTHENTICATION_REQUIRED') {
    // Still needs customer action on the existing PaymentIntent — not a new charge.
    return false;
  }
  return state === 'error' || state === 'cancelled';
}

/**
 * Optional, UI-free helper: map Headless session signals to localized copy and
 * recovery guidance for **host-owned** UI. Does not render or inject chrome.
 *
 * Uses existing dictionary keys and {@link localizePaymentError}. Locale changes
 * only need a new `messages` object — no payment restart or outcome re-emit.
 */
export function describeHeadlessUi(input: DescribeHeadlessUiInput): HeadlessUiPresentation {
  const { state, messages, lastError = null, lastResult = null, selectedReadiness = null } =
    input;

  if (state === 'destroyed') {
    return {
      kind: 'destroyed',
      title: messages.errorTitle,
      body: messages.errorBody,
      recoveryAction: 'none',
    };
  }

  if (state === 'idle' || state === 'initializing') {
    return {
      kind: state === 'idle' ? 'idle' : 'loading',
      title: messages.processingTitle,
      body: messages.processingHint,
      recoveryAction: 'none',
    };
  }

  if (state === 'processing') {
    return {
      kind: 'processing',
      title: messages.processingTitle,
      body: messages.processingHint,
      recoveryAction: 'none',
    };
  }

  if (state === 'pending' || (state === 'ready' && lastResult?.status === 'processing')) {
    return {
      kind: 'pending',
      title: messages.pendingTitle,
      body: messages.pendingBody,
      recoveryAction: 'reconcile',
    };
  }

  if (state === 'success') {
    return {
      kind: 'success',
      title: messages.successTitle,
      body: messages.successBody,
      // Success is an outcome; hosts own confirmation UX. No payment retry.
      recoveryAction: 'none',
    };
  }

  if (state === 'cancelled') {
    return {
      kind: 'cancelled',
      title: messages.cancelledTitle,
      body: messages.cancelledBody,
      recoveryAction: 'retry-payment',
    };
  }

  if (state === 'error' || lastError) {
    const error = lastError;
    const code = error?.code;
    const body = localizePaymentError(code, messages, { method: error?.method });

    if (code && (isConfigurationFailure(code) || isAvailabilityFailure(code))) {
      return {
        kind: 'unavailable',
        title: messages.errorTitle,
        body,
        recoveryAction: 'choose-another-method',
        errorCode: code,
      };
    }

    if (code && isHeadlessRecoveryRetryable(error)) {
      return {
        kind: 'error',
        title: messages.errorTitle,
        body,
        recoveryAction: 'retry-recovery',
        errorCode: code,
      };
    }

    if (code === 'AUTHENTICATION_REQUIRED') {
      return {
        kind: 'error',
        title: messages.errorTitle,
        body,
        recoveryAction: 'reconcile',
        errorCode: code,
      };
    }

    return {
      kind: 'error',
      title: messages.errorTitle,
      body,
      recoveryAction: isHeadlessPaymentRetryAllowed(state, error) ? 'retry-payment' : 'none',
      errorCode: code,
    };
  }

  if (
    selectedReadiness === 'unavailable' ||
    selectedReadiness === 'misconfigured'
  ) {
    return {
      kind: 'unavailable',
      title: messages.errorTitle,
      body: messages.errorDetailUnavailable,
      recoveryAction: 'choose-another-method',
    };
  }

  return {
    kind: 'ready',
    title: messages.checkoutTitle,
    body: messages.checkoutSubtitle,
    recoveryAction: 'none',
  };
}

function isConfigurationFailure(code: PaymentErrorCode): boolean {
  return (
    code === 'CONFIG_MISSING' ||
    code === 'CONFIG_INVALID' ||
    code === 'PROVIDER_NOT_CONFIGURED' ||
    code === 'PROVIDER_NOT_IMPLEMENTED' ||
    code === 'PRODUCT_INVALID'
  );
}

/** Method cannot be used in this environment — choose another method, do not retry payment. */
function isAvailabilityFailure(code: PaymentErrorCode): boolean {
  return code === 'PROVIDER_UNAVAILABLE';
}

function paymentErrorCodeOf(error: unknown): PaymentErrorCode | null {
  if (error instanceof PaymentError) {
    return error.code;
  }
  if (!error || typeof error !== 'object') {
    return null;
  }
  if (!('code' in error)) {
    return null;
  }
  const code = String((error as { code?: unknown }).code ?? '');
  return (code || null) as PaymentErrorCode | null;
}
