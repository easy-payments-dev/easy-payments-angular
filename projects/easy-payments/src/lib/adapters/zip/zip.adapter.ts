import { inject, Injectable } from '@angular/core';
import { EasyPaymentsConfigService } from '../../config/easy-payments-config.service';
import { backendEndpointUrl } from '../../config/resolve-backend-url';
import {
  PaymentContext,
  PaymentProduct,
  PaymentRequest,
  PaymentResult,
  normalizePaymentResult,
} from '../../models';
import {
  CreateZipCheckoutResponse,
  ZipVerifyReturnResponse,
  toZipCreateCheckoutRequest,
} from '../../models/create-payment.model';
import { assertMerchantMetadata } from '../../metadata/merchant-metadata';
import { PaymentError } from '../../errors/payment-error';
import { SdkLoaderService } from '../../loaders/sdk-loader.service';
import { BackendService } from '../../services/backend.service';
import { BrowserGuard } from '../../utils/browser-guard';
import { BaseMockAdapter, BaseProviderAdapter } from '../base.adapter';
import {
  buildZipReturnUrl,
  clearZipPendingReturn,
  clearZipReturnParamsFromUrl,
  isZipCancelReturn,
  isZipReturnAttempt,
  markZipPendingReturn,
  readZipPendingReturn,
  readZipReturnParams,
} from './zip-return';
import type {
  ZipApiCheckout,
  ZipCheckoutCompleteResult,
  ZipPreparedCheckout,
} from './zip.types';

const ZIP_CURRENCY = 'USD';
const ZIP_SDK_SCRIPT_ID = 'easy-payments-zip-sdk';
/** HTTP create/verify must not hang the preparing spinner forever. */
const ZIP_HTTP_TIMEOUT_MS = 20_000;
/**
 * If openCheckout does not open a hosted session (popup blocked / silent no-op),
 * fail fast. Buyers who leave for Zip checkout are not timed out here — blur cancels
 * this guard so they can take as long as they need.
 */
const ZIP_OPEN_GUARD_MS = 4_000;

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new PaymentError({
          code: 'NETWORK_ERROR',
          message,
          method: 'zip',
          provider: 'zip',
        }),
      );
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

@Injectable({ providedIn: 'root' })
export class ZipAdapter extends BaseProviderAdapter {
  readonly provider = 'zip' as const;

  private readonly configService = inject(EasyPaymentsConfigService);
  private readonly backend = inject(BackendService);
  private readonly sdkLoader = inject(SdkLoaderService);
  private readonly browser = inject(BrowserGuard);

  private configReady = false;
  private loadPromise: Promise<ZipApiCheckout> | null = null;
  private callbacksWired = false;
  private prepared: ZipPreparedCheckout | null = null;
  /** Merchant references already reported as a terminal outcome (success/cancel/error). */
  private readonly reportedOutcomes = new Set<string>();
  private completeHandler: ((result: PaymentResult) => void) | null = null;
  private cancelHandler: ((result: PaymentResult) => void) | null = null;
  private errorHandler: ((error: PaymentError) => void) | null = null;
  private activeProduct: PaymentProduct | null = null;
  /** True while Zip hosted checkout may still be open for the current attempt. */
  private checkoutOpen = false;
  private openGuardTimer: ReturnType<typeof setTimeout> | null = null;
  private openGuardBlurHandler: (() => void) | null = null;
  /** Attempt that may have been authorized — reconcile before a new submission. */
  private pendingReconcileRef: string | null = null;

  async initialize(): Promise<void> {
    const snapshot = this.configService.getSnapshot();
    if (snapshot.enableMockMode === true) {
      this.configReady = true;
      this.initialized = true;
      return;
    }
    const zip = snapshot.providers?.zip;
    if (!zip || typeof zip !== 'object') {
      this.configReady = false;
      this.initialized = false;
      return;
    }
    this.configReady = true;
    this.initialized = true;
  }

  async isAvailable(context: PaymentContext): Promise<boolean> {
    const snapshot = this.configService.getSnapshot();
    if (snapshot.enableMockMode === true) {
      return context.product.currency?.trim().toUpperCase() === ZIP_CURRENCY;
    }
    if (!snapshot.providers?.zip || !this.configReady) {
      return false;
    }
    if (!backendEndpointUrl(snapshot.backend, snapshot.backend?.zipCreateCheckoutUrl)) {
      return false;
    }
    if (!backendEndpointUrl(snapshot.backend, snapshot.backend?.zipVerifyReturnUrl)) {
      return false;
    }
    if (context.product.currency?.trim().toUpperCase() !== ZIP_CURRENCY) {
      return false;
    }
    const total = context.product.amount * (context.product.quantity ?? 1);
    if (!Number.isFinite(total) || total < 0.01) {
      return false;
    }
    return true;
  }

  /**
   * Interactive Zip checkout is handled by ZipPaymentComponent.
   * Mock mode may call this via the orchestrator / MockMethodPanel path is preferred.
   */
  async createPayment(request: PaymentRequest): Promise<PaymentResult> {
    if (this.configService.getSnapshot().enableMockMode === true) {
      return this.completeMockPayment(request.context.product);
    }
    throw new PaymentError({
      code: 'PROVIDER_UNAVAILABLE',
      message:
        'Zip payments require the Zip checkout UI. Use the zip method inside <easy-payments>.',
      method: 'zip',
      provider: 'zip',
    });
  }

  setOutcomeHandlers(handlers: {
    onComplete?: (result: PaymentResult) => void;
    onCancel?: (result: PaymentResult) => void;
    onError?: (error: PaymentError) => void;
  }): void {
    this.completeHandler = handlers.onComplete ?? null;
    this.cancelHandler = handlers.onCancel ?? null;
    this.errorHandler = handlers.onError ?? null;
  }

  getPreparedCheckout(): ZipPreparedCheckout | null {
    return this.prepared;
  }

  /** True while a hosted Zip attempt is open (spinner should stay until outcome). */
  isCheckoutOpen(): boolean {
    return this.checkoutOpen;
  }

  async ensureSdkLoaded(sdkScriptUrl?: string): Promise<ZipApiCheckout> {
    if (!this.browser.isBrowser) {
      throw new PaymentError({
        code: 'SDK_LOAD_FAILED',
        message: 'Zip SDK can only load in the browser.',
        method: 'zip',
        provider: 'zip',
      });
    }

    const existing = this.browser.getWindow()?.quadpay?.apiCheckout;
    if (existing?.openCheckout) {
      this.wireSdkCallbacks(existing);
      return existing;
    }

    if (this.loadPromise) {
      return this.loadPromise;
    }

    const src = sdkScriptUrl?.trim() || 'https://cdn.sand.us.zip.co/v1/zip.js';

    this.loadPromise = (async () => {
      try {
        await this.sdkLoader.loadScript({
          id: ZIP_SDK_SCRIPT_ID,
          src,
          async: true,
          timeoutMs: ZIP_HTTP_TIMEOUT_MS,
        });
        const api = this.browser.getWindow()?.quadpay?.apiCheckout;
        if (!api?.openCheckout) {
          throw new PaymentError({
            code: 'SDK_LOAD_FAILED',
            message:
              'Zip JS SDK loaded but window.quadpay.apiCheckout is unavailable. Check the Zip CDN script URL and network.',
            method: 'zip',
            provider: 'zip',
          });
        }
        this.wireSdkCallbacks(api);
        return api;
      } catch (error) {
        this.loadPromise = null;
        if (error instanceof PaymentError) {
          throw error;
        }
        throw new PaymentError({
          code: 'SDK_LOAD_FAILED',
          message:
            error instanceof Error && error.message
              ? error.message
              : 'Zip JS SDK failed to load. Check network access to cdn.sand.us.zip.co / cdn.us.zip.co.',
          method: 'zip',
          provider: 'zip',
          originalError: error,
        });
      }
    })();

    return this.loadPromise;
  }

  /**
   * Prefetch signed authorize body. Must complete before the buyer click so
   * `openCheckout` can run synchronously in the click handler.
   */
  async prepareCheckout(product: PaymentProduct): Promise<ZipPreparedCheckout> {
    this.clearOpenGuard();
    this.checkoutOpen = false;

    if (this.configService.getSnapshot().enableMockMode === true) {
      const prepared = this.buildMockPrepared(product);
      this.prepared = prepared;
      this.activeProduct = product;
      return prepared;
    }

    if (this.pendingReconcileRef) {
      await this.reconcilePendingAttempt();
    }

    const snapshot = this.configService.getSnapshot();
    if (!snapshot.providers?.zip || typeof snapshot.providers.zip !== 'object') {
      throw new PaymentError({
        code: 'CONFIG_MISSING',
        message:
          'Zip is not configured. Opt in with providers.zip: {} and set zipCreateCheckoutUrl + zipVerifyReturnUrl.',
        method: 'zip',
        provider: 'zip',
      });
    }
    if (!backendEndpointUrl(snapshot.backend, snapshot.backend?.zipCreateCheckoutUrl)) {
      throw new PaymentError({
        code: 'CONFIG_MISSING',
        message: 'Backend zipCreateCheckoutUrl is not configured.',
        method: 'zip',
        provider: 'zip',
      });
    }
    if (!backendEndpointUrl(snapshot.backend, snapshot.backend?.zipVerifyReturnUrl)) {
      throw new PaymentError({
        code: 'CONFIG_MISSING',
        message: 'Backend zipVerifyReturnUrl is not configured.',
        method: 'zip',
        provider: 'zip',
      });
    }

    const metadata = assertMerchantMetadata(product.metadata, 'zip', 'zip');
    const redirectConfirmUrl = buildZipReturnUrl('confirm');
    const redirectCancelUrl = buildZipReturnUrl('cancel');
    if (!redirectConfirmUrl || !redirectCancelUrl) {
      throw new PaymentError({
        code: 'PROVIDER_UNAVAILABLE',
        message: 'Unable to build Zip redirect URLs in this environment.',
        method: 'zip',
        provider: 'zip',
      });
    }

    const body = toZipCreateCheckoutRequest({
      productId: product.id,
      quantity: product.quantity ?? 1,
      currency: product.currency,
      redirectConfirmUrl,
      redirectCancelUrl,
      ...(metadata ? { metadata } : {}),
    });

    let response: CreateZipCheckoutResponse;
    try {
      response = await withTimeout(
        this.backend.createZipCheckout(body),
        ZIP_HTTP_TIMEOUT_MS,
        'Zip create-checkout timed out. Check that the payments API is reachable.',
      );
    } catch (error) {
      if (error instanceof PaymentError) {
        throw error;
      }
      throw new PaymentError({
        code: 'BACKEND_ERROR',
        message: 'Failed to create Zip checkout on backend.',
        method: 'zip',
        provider: 'zip',
        originalError: error,
      });
    }
    this.assertValidCreateResponse(response);

    if (response.mock === true) {
      throw new PaymentError({
        code: 'CONFIG_MISSING',
        message:
          'Zip sandbox credentials are not configured on the server. Set ZIP_MERCHANT_ID and ZIP_API_SECRET in server/.env (from the Zip Merchant Portal), then restart the API. Demo Mode does not need Zip credentials.',
        method: 'zip',
        provider: 'zip',
      });
    }

    const prepared: ZipPreparedCheckout = {
      merchantReference: response.merchantReference,
      merchantId: response.merchantId,
      amount: response.amount,
      currency: response.currency,
      requestBody: response.requestBody,
      signature: response.signature,
      sdkScriptUrl: response.sdkScriptUrl,
    };
    this.prepared = prepared;
    this.activeProduct = product;
    // Fresh attempt — allow outcomes for this new merchantReference.
    this.reportedOutcomes.delete(prepared.merchantReference);
    this.reportedOutcomes.delete(`${prepared.merchantReference}:success`);
    markZipPendingReturn(product.id, prepared.merchantReference);
    await this.ensureSdkLoaded(prepared.sdkScriptUrl);
    return prepared;
  }

  /**
   * Must be called synchronously from a user gesture (click).
   * Uses the last prepared requestBody + signature.
   */
  startCheckout(): void {
    if (this.configService.getSnapshot().enableMockMode === true) {
      const product = this.activeProduct;
      if (!product) {
        throw new PaymentError({
          code: 'PROVIDER_UNAVAILABLE',
          message: 'Zip mock checkout is not prepared.',
          method: 'zip',
          provider: 'zip',
        });
      }
      // Synchronous start from click; settle mock outcome on the next macrotask
      // so the UI can enter the open/busy state first (mirrors hosted flow).
      this.checkoutOpen = true;
      setTimeout(() => {
        const result = this.completeMockPayment(product);
        this.checkoutOpen = false;
        this.completeHandler?.(result);
      }, 0);
      return;
    }

    const prepared = this.prepared;
    if (!prepared) {
      throw new PaymentError({
        code: 'PROVIDER_UNAVAILABLE',
        message: 'Zip checkout is not prepared. Call prepareCheckout first.',
        method: 'zip',
        provider: 'zip',
      });
    }

    // New submission against a prior open attempt: reconcile first (async path
    // must have run in prepareCheckout). Clear stale reported flags for retry.
    this.reportedOutcomes.delete(prepared.merchantReference);
    this.reportedOutcomes.delete(`${prepared.merchantReference}:success`);
    this.pendingReconcileRef = prepared.merchantReference;

    const api = this.browser.getWindow()?.quadpay?.apiCheckout;
    if (!api?.openCheckout) {
      throw new PaymentError({
        code: 'SDK_LOAD_FAILED',
        message:
          'Zip SDK is not ready. Wait for prepare to finish, or check that zip.js loaded from the Zip CDN.',
        method: 'zip',
        provider: 'zip',
      });
    }

    this.wireSdkCallbacks(api);
    this.checkoutOpen = true;
    this.armOpenGuard(prepared.merchantReference);
    // CRITICAL: keep openCheckout in the same synchronous click stack.
    api.openCheckout(prepared.requestBody, prepared.signature);
  }

  /**
   * Recover from a Zip redirect return (confirm/cancel query params).
   * Verifies on the server before reporting success.
   */
  async recoverReturn(search?: string): Promise<PaymentResult | null> {
    if (!isZipReturnAttempt(search)) {
      return null;
    }

    if (isZipCancelReturn(search)) {
      const pending = readZipPendingReturn();
      const merchantReference =
        readZipReturnParams(search).merchantReference || pending?.merchantReference || '';
      clearZipPendingReturn();
      clearZipReturnParamsFromUrl();
      this.finishOpenAttempt();
      if (merchantReference && this.reportedOutcomes.has(merchantReference)) {
        return null;
      }
      if (merchantReference) {
        this.reportedOutcomes.add(merchantReference);
      }
      this.pendingReconcileRef = null;
      const cancelled = normalizePaymentResult({
        status: 'cancelled',
        method: 'zip',
        provider: 'zip',
        message: 'Zip checkout was cancelled.',
        metadata: merchantReference ? { merchantReference } : undefined,
      });
      this.cancelHandler?.(cancelled);
      return cancelled;
    }

    const params = readZipReturnParams(search);
    const pending = readZipPendingReturn();
    const merchantReference =
      params.merchantReference?.trim() || pending?.merchantReference?.trim() || '';
    if (!merchantReference) {
      clearZipReturnParamsFromUrl();
      this.finishOpenAttempt();
      throw new PaymentError({
        code: 'PAYMENT_FAILED',
        message: 'Zip return is missing merchantReference.',
        method: 'zip',
        provider: 'zip',
      });
    }

    if (this.reportedOutcomes.has(merchantReference)) {
      clearZipPendingReturn();
      clearZipReturnParamsFromUrl();
      this.finishOpenAttempt();
      return null;
    }

    const verified = await withTimeout(
      this.backend.verifyZipReturn({
        provider: 'zip',
        merchantReference,
        ...(params.orderId ? { orderId: params.orderId } : {}),
        returnQuery: params.rawQuery,
      }),
      ZIP_HTTP_TIMEOUT_MS,
      'Zip verify-return timed out. Check that the payments API is reachable.',
    );

    clearZipPendingReturn();
    clearZipReturnParamsFromUrl();
    this.pendingReconcileRef = null;
    return this.applyVerifiedResult(verified);
  }

  async destroy(): Promise<void> {
    this.clearOpenGuard();
    this.checkoutOpen = false;
    this.prepared = null;
    this.activeProduct = null;
    this.completeHandler = null;
    this.cancelHandler = null;
    this.errorHandler = null;
    this.callbacksWired = false;
    this.loadPromise = null;
    this.pendingReconcileRef = null;
  }

  private buildMockPrepared(product: PaymentProduct): ZipPreparedCheckout {
    const merchantReference = `mock_zip_${Date.now()}`;
    return {
      merchantReference,
      merchantId: 'mock-merchant',
      amount: product.amount * (product.quantity ?? 1),
      currency: product.currency,
      requestBody: { merchantReference, mock: true },
      signature: 'mock-signature',
      sdkScriptUrl: '',
    };
  }

  private completeMockPayment(product: PaymentProduct): PaymentResult {
    const ref = this.prepared?.merchantReference ?? `mock_zip_${Date.now()}`;
    this.reportedOutcomes.add(ref);
    this.reportedOutcomes.add(`${ref}:success`);
    this.pendingReconcileRef = null;
    return normalizePaymentResult({
      status: 'success',
      method: 'zip',
      provider: 'zip',
      transactionId: `mock_zip_${Date.now()}`,
      message: '[DEMO] Mock Zip payment completed. This is not a real transaction. No real payment was processed.',
      metadata: {
        mock: true,
        productId: product.id,
        merchantReference: ref,
        amount: product.amount,
        currency: product.currency,
      },
    });
  }

  /**
   * After a stalled open / timeout, ask the server whether the attempt already
   * succeeded before allowing another submission.
   */
  private async reconcilePendingAttempt(): Promise<void> {
    const ref = this.pendingReconcileRef;
    if (!ref) {
      return;
    }
    this.pendingReconcileRef = null;
    if (this.reportedOutcomes.has(ref) || this.reportedOutcomes.has(`${ref}:success`)) {
      return;
    }
    try {
      const verified = await withTimeout(
        this.backend.verifyZipReturn({
          provider: 'zip',
          merchantReference: ref,
          clientResult: { merchantReference: ref },
        }),
        ZIP_HTTP_TIMEOUT_MS,
        'Zip reconcile timed out. Check that the payments API is reachable.',
      );
      if (verified.success) {
        this.applyVerifiedResult(verified);
      }
    } catch {
      // Unknown order / declined — safe to start a new create on the next prepare.
    }
  }

  private armOpenGuard(merchantReference: string): void {
    this.clearOpenGuard();
    const win = this.browser.getWindow();
    // If the document loses focus, assume Zip checkout opened — cancel the guard
    // so the buyer is never timed out while completing hosted checkout.
    this.openGuardBlurHandler = () => {
      this.clearOpenGuard(/* keepCheckoutOpen */ true);
    };
    win?.addEventListener?.('blur', this.openGuardBlurHandler);

    this.openGuardTimer = setTimeout(() => {
      this.openGuardTimer = null;
      if (!this.checkoutOpen) {
        return;
      }
      // Still focused → popup likely blocked or openCheckout was a no-op.
      const stillFocused = win?.document?.hasFocus?.() ?? true;
      if (!stillFocused) {
        return;
      }
      this.finishOpenAttempt();
      this.pendingReconcileRef = merchantReference;
      void this.reconcileThenFailOpen(
        new PaymentError({
          code: 'PROVIDER_UNAVAILABLE',
          message:
            'Zip checkout did not open. Allow pop-ups for this site, confirm Zip sandbox credentials, and try again.',
          method: 'zip',
          provider: 'zip',
        }),
      );
    }, ZIP_OPEN_GUARD_MS);
  }

  private async reconcileThenFailOpen(error: PaymentError): Promise<void> {
    await this.reconcilePendingAttempt();
    if (this.checkoutOpen) {
      return;
    }
    // If reconcile already reported success/cancel, handlers ran — do not also error.
    const ref = this.prepared?.merchantReference;
    if (ref && (this.reportedOutcomes.has(ref) || this.reportedOutcomes.has(`${ref}:success`))) {
      return;
    }
    this.errorHandler?.(error);
  }

  private clearOpenGuard(keepCheckoutOpen = false): void {
    if (this.openGuardTimer !== null) {
      clearTimeout(this.openGuardTimer);
      this.openGuardTimer = null;
    }
    if (this.openGuardBlurHandler) {
      this.browser.getWindow()?.removeEventListener?.('blur', this.openGuardBlurHandler);
      this.openGuardBlurHandler = null;
    }
    if (!keepCheckoutOpen) {
      // no-op on checkoutOpen — callers decide
    }
  }

  private finishOpenAttempt(): void {
    this.clearOpenGuard();
    this.checkoutOpen = false;
  }

  private wireSdkCallbacks(api: ZipApiCheckout): void {
    if (this.callbacksWired) {
      return;
    }
    this.callbacksWired = true;

    api.onComplete((result) => {
      void this.handleSdkComplete(result);
    });
    api.onClose((message) => {
      this.handleSdkClose(message);
    });
    api.onError((errors) => {
      this.finishOpenAttempt();
      const error = new PaymentError({
        code: 'PAYMENT_FAILED',
        message: errors?.length ? errors.join('; ') : 'Zip checkout validation failed.',
        method: 'zip',
        provider: 'zip',
      });
      this.errorHandler?.(error);
    });
  }

  private async handleSdkComplete(result: ZipCheckoutCompleteResult): Promise<void> {
    this.finishOpenAttempt();
    const prepared = this.prepared;
    const merchantReference =
      result.order?.merchantReference?.trim() || prepared?.merchantReference || '';
    if (!merchantReference) {
      this.errorHandler?.(
        new PaymentError({
          code: 'PAYMENT_FAILED',
          message: 'Zip completion missing merchantReference.',
          method: 'zip',
          provider: 'zip',
        }),
      );
      return;
    }

    if (this.reportedOutcomes.has(merchantReference)) {
      return;
    }

    this.pendingReconcileRef = merchantReference;

    try {
      const verified = await withTimeout(
        this.backend.verifyZipReturn({
          provider: 'zip',
          merchantReference,
          ...(result.order?.orderId ? { orderId: result.order.orderId } : {}),
          clientResult: result as unknown as Record<string, unknown>,
        }),
        ZIP_HTTP_TIMEOUT_MS,
        'Zip verify-return timed out. Check that the payments API is reachable.',
      );
      clearZipPendingReturn();
      this.pendingReconcileRef = null;
      this.applyVerifiedResult(verified);
    } catch (error) {
      const mapped =
        error instanceof PaymentError
          ? error
          : new PaymentError({
              code: 'BACKEND_ERROR',
              message: 'Failed to verify Zip return.',
              method: 'zip',
              provider: 'zip',
              originalError: error,
            });
      this.errorHandler?.(mapped);
    }
  }

  private handleSdkClose(message: string): void {
    this.finishOpenAttempt();
    const merchantReference = this.prepared?.merchantReference;
    if (merchantReference && this.reportedOutcomes.has(`${merchantReference}:success`)) {
      return;
    }
    if (merchantReference && this.reportedOutcomes.has(merchantReference)) {
      // Already reported cancel/error for this ref — still notify UI if a new
      // open left the spinner running (retry after cancel).
      const cancelled = normalizePaymentResult({
        status: 'cancelled',
        method: 'zip',
        provider: 'zip',
        message: message?.trim() || 'Zip checkout was closed.',
        metadata: { merchantReference },
      });
      this.cancelHandler?.(cancelled);
      return;
    }
    if (merchantReference) {
      this.reportedOutcomes.add(merchantReference);
    }
    this.pendingReconcileRef = null;
    clearZipPendingReturn();
    const cancelled = normalizePaymentResult({
      status: 'cancelled',
      method: 'zip',
      provider: 'zip',
      message: message?.trim() || 'Zip checkout was closed.',
      metadata: merchantReference ? { merchantReference } : undefined,
    });
    this.cancelHandler?.(cancelled);
  }

  private applyVerifiedResult(verified: ZipVerifyReturnResponse): PaymentResult | null {
    this.finishOpenAttempt();
    const ref = verified.merchantReference;
    if (verified.alreadyReported || this.reportedOutcomes.has(ref)) {
      this.reportedOutcomes.add(ref);
      return null;
    }

    if (!verified.success) {
      this.reportedOutcomes.add(ref);
      this.pendingReconcileRef = null;
      if (verified.status === 'abandoned') {
        const cancelled = normalizePaymentResult({
          status: 'cancelled',
          method: 'zip',
          provider: 'zip',
          message: 'Zip checkout was abandoned.',
          metadata: {
            merchantReference: ref,
            orderId: verified.orderId,
          },
        });
        this.cancelHandler?.(cancelled);
        return cancelled;
      }
      const error = new PaymentError({
        code: 'PAYMENT_FAILED',
        message: 'Zip payment was declined.',
        method: 'zip',
        provider: 'zip',
      });
      this.errorHandler?.(error);
      return null;
    }

    this.reportedOutcomes.add(ref);
    this.reportedOutcomes.add(`${ref}:success`);
    this.pendingReconcileRef = null;
    const success = normalizePaymentResult({
      status: 'success',
      method: 'zip',
      provider: 'zip',
      transactionId: verified.orderId,
      message: 'Zip payment confirmed.',
      metadata: {
        merchantReference: ref,
        orderId: verified.orderId,
        amount: verified.amount,
        currency: verified.currency,
        productId: this.activeProduct?.id,
      },
    });
    this.completeHandler?.(success);
    return success;
  }

  private assertValidCreateResponse(response: CreateZipCheckoutResponse): void {
    if (
      response?.provider !== 'zip' ||
      typeof response.merchantReference !== 'string' ||
      !response.merchantReference.trim() ||
      typeof response.signature !== 'string' ||
      !response.signature.trim() ||
      !response.requestBody ||
      typeof response.requestBody !== 'object'
    ) {
      throw new PaymentError({
        code: 'BACKEND_ERROR',
        message: 'Invalid Zip create-checkout response from backend.',
        method: 'zip',
        provider: 'zip',
      });
    }
  }
}

@Injectable({ providedIn: 'root' })
export class ZipMockAdapter extends BaseMockAdapter {
  readonly provider = 'zip' as const;
  readonly method = 'zip' as const;
}
