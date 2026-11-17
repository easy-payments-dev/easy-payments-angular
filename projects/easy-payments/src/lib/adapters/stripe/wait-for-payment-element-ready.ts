import type { StripePaymentElement } from '@stripe/stripe-js';
import { PaymentError } from '../../errors/payment-error';
import type { PaymentMethod, PaymentProviderName } from '../../models/payment-method.model';

/** Default wait for Stripe Payment Element `ready` before enabling Pay CTAs. */
export const PAYMENT_ELEMENT_READY_TIMEOUT_MS = 20_000;

export interface WaitForPaymentElementReadyOptions {
  /** Abort if this returns false (e.g. initGeneration changed). */
  isCurrent?: () => boolean;
  timeoutMs?: number;
  method?: PaymentMethod;
  provider?: PaymentProviderName;
  message?: string;
}

/**
 * Resolves when the Payment Element fires `ready`, so merchant CTAs are not
 * enabled against an empty iframe (common cause of blank Klarna/BNPL surfaces).
 * Rejects on `loaderror` or timeout as SDK_LOAD_FAILED.
 */
export function waitForPaymentElementReady(
  element: StripePaymentElement,
  options: WaitForPaymentElementReadyOptions = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? PAYMENT_ELEMENT_READY_TIMEOUT_MS;
  const method = options.method ?? 'card';
  const provider = options.provider ?? 'stripe';
  const message =
    options.message ?? 'Payment form did not become ready. Please try again or choose another method.';

  // Incomplete test doubles / already-destroyed elements: do not block mounts.
  if (typeof element?.on !== 'function') {
    return Promise.resolve();
  }

  return new Promise<void>((resolve, reject) => {
    let settled = false;

    const finish = (fn: () => void): void => {
      if (settled) {
        return;
      }
      settled = true;
      window.clearTimeout(timer);
      try {
        element.off?.('ready', onReady);
      } catch {
        // Element may already be destroyed.
      }
      try {
        element.off?.('loaderror', onLoadError);
      } catch {
        // Element may already be destroyed.
      }
      fn();
    };

    const onReady = (): void => {
      // Stale generation: resolve so mount awaits do not hang; callers ignore via isCurrent.
      finish(() => resolve());
    };

    const onLoadError = (event?: { error?: { message?: string } }): void => {
      if (options.isCurrent && !options.isCurrent()) {
        finish(() => resolve());
        return;
      }
      const detail = event?.error?.message?.trim();
      finish(() =>
        reject(
          new PaymentError({
            code: 'SDK_LOAD_FAILED',
            message: detail && detail.length > 0 ? detail : message,
            method,
            provider,
          }),
        ),
      );
    };

    const timer = window.setTimeout(() => {
      if (options.isCurrent && !options.isCurrent()) {
        finish(() => resolve());
        return;
      }
      finish(() =>
        reject(
          new PaymentError({
            code: 'SDK_LOAD_FAILED',
            message,
            method,
            provider,
          }),
        ),
      );
    }, timeoutMs);

    try {
      element.on('ready', onReady);
      element.on('loaderror', onLoadError);
    } catch (error) {
      finish(() =>
        reject(
          new PaymentError({
            code: 'SDK_LOAD_FAILED',
            message,
            method,
            provider,
            originalError: error,
          }),
        ),
      );
    }
  });
}
