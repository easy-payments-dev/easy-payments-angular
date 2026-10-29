import { inject, Injectable } from '@angular/core';
import { EasyPaymentsConfigService } from '../../config/easy-payments-config.service';
import { backendEndpointUrl } from '../../config/resolve-backend-url';
import {
  CheckoutOptions,
  PaymentContext,
  PaymentProduct,
  PaymentRequest,
  PaymentResult,
  normalizePaymentResult,
} from '../../models';
import { toPayPalCreateOrderRequest } from '../../models/create-payment.model';
import {
  assertMerchantMetadata,
  assertPayPalOrderReference,
  PAYPAL_ORDER_REFERENCE_KEY,
} from '../../metadata/merchant-metadata';
import { PaymentError } from '../../errors/payment-error';
import { SdkLoaderService } from '../../loaders/sdk-loader.service';
import { BackendService } from '../../services/backend.service';
import { BrowserGuard } from '../../utils/browser-guard';
import { toPayPalSdkLocale } from '../../i18n/provider-locale';
import type { EasyPaymentsResolvedLocale } from '../../i18n/locale.types';
import { BaseMockAdapter, BaseProviderAdapter } from '../base.adapter';
import { mapPayPalError } from './paypal-error.mapper';
import {
  PayPalButtonsHandle,
  PayPalButtonsOptions,
  PayPalNamespace,
} from './paypal.types';

declare global {
  interface Window {
    paypal?: PayPalNamespace;
  }
}

@Injectable({ providedIn: 'root' })
export class PayPalAdapter extends BaseProviderAdapter {
  readonly provider = 'paypal' as const;

  private readonly configService = inject(EasyPaymentsConfigService);
  private readonly backend = inject(BackendService);
  private readonly sdkLoader = inject(SdkLoaderService);
  private readonly browser = inject(BrowserGuard);

  private configReady = false;
  private loadPromise: Promise<PayPalNamespace> | null = null;
  /** PayPal SDK locale last successfully loaded (underscore form, e.g. en_US). */
  private loadedSdkLocale: string | null = null;
  /**
   * Per-host official Buttons mounts. Destroying one host must not close another's.
   * Keyed by opaque mount ids owned by PayPalPaymentComponent instances.
   */
  private readonly buttonMounts = new Map<string, PayPalButtonsHandle>();
  private nextMountId = 0;
  private creatingOrder = false;
  private capturing = false;
  private activeOrderId: string | null = null;

  /**
   * Validates frontend PayPal config only. Does not load the JS SDK until needed.
   */
  async initialize(): Promise<void> {
    const clientId = this.configService.getSnapshot().providers?.paypal?.clientId?.trim() ?? '';
    this.configReady = !!clientId;
    this.initialized = this.configReady;
  }

  async isAvailable(_context: PaymentContext): Promise<boolean> {
    const snapshot = this.configService.getSnapshot();
    const clientId = snapshot.providers?.paypal?.clientId?.trim() ?? '';
    if (!clientId || !this.configReady) {
      return false;
    }
    if (!backendEndpointUrl(snapshot.backend, snapshot.backend?.paypalCreateOrderUrl)) {
      return false;
    }
    if (!backendEndpointUrl(snapshot.backend, snapshot.backend?.paypalCaptureOrderUrl)) {
      return false;
    }
    return true;
  }

  /**
   * Interactive PayPal Buttons flow is handled by PayPalPaymentComponent.
   */
  async createPayment(_request: PaymentRequest): Promise<PaymentResult> {
    throw new PaymentError({
      code: 'PROVIDER_UNAVAILABLE',
      message:
        'PayPal payments require the official PayPal Buttons UI. Use the paypal method inside <easy-payments>.',
      method: 'paypal',
      provider: 'paypal',
    });
  }

  async ensureSdkLoaded(locale: EasyPaymentsResolvedLocale = 'en'): Promise<PayPalNamespace> {
    if (!this.browser.isBrowser) {
      throw new PaymentError({
        code: 'SDK_LOAD_FAILED',
        message: 'PayPal SDK can only load in the browser.',
        method: 'paypal',
        provider: 'paypal',
      });
    }

    const paypalLocale = toPayPalSdkLocale(locale);
    const scriptId = `easy-payments-paypal-sdk-${paypalLocale}`;

    if (this.loadedSdkLocale === paypalLocale) {
      const existing = this.browser.getWindow()?.paypal;
      if (existing?.Buttons) {
        return existing;
      }
      this.loadPromise = null;
    } else if (this.loadedSdkLocale) {
      this.unloadSdk(this.loadedSdkLocale);
      this.loadPromise = null;
    }

    if (this.loadPromise) {
      return this.loadPromise;
    }

    const paypalConfig = this.configService.getSnapshot().providers?.paypal;
    const clientId = paypalConfig?.clientId?.trim() ?? '';
    if (!clientId) {
      throw new PaymentError({
        code: 'CONFIG_MISSING',
        message: 'PayPal clientId is not configured.',
        method: 'paypal',
        provider: 'paypal',
      });
    }

    const currency = (paypalConfig?.currency ?? 'USD').trim().toUpperCase() || 'USD';
    const intent = paypalConfig?.intent ?? 'capture';

    this.loadPromise = (async () => {
      try {
        await this.sdkLoader.loadScript({
          id: scriptId,
          src: `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}&currency=${encodeURIComponent(currency)}&intent=${encodeURIComponent(intent)}&components=buttons&locale=${encodeURIComponent(paypalLocale)}`,
        });
      } catch (error) {
        this.loadPromise = null;
        throw mapPayPalError(error, 'SDK_LOAD_FAILED', 'PayPal SDK failed to load.');
      }

      const paypal = this.browser.getWindow()?.paypal;
      if (!paypal?.Buttons) {
        this.loadPromise = null;
        throw new PaymentError({
          code: 'SDK_LOAD_FAILED',
          message: 'PayPal SDK loaded but window.paypal.Buttons is unavailable.',
          method: 'paypal',
          provider: 'paypal',
        });
      }

      this.loadedSdkLocale = paypalLocale;
      return paypal;
    })();

    return this.loadPromise;
  }

  private unloadSdk(previousLocale: string): void {
    const win = this.browser.getWindow();
    if (win?.paypal) {
      delete win.paypal;
    }
    this.sdkLoader.unloadScript(`easy-payments-paypal-sdk-${previousLocale}`);
    // Legacy id from pre-locale builds.
    this.sdkLoader.unloadScript('easy-payments-paypal-sdk');
  }

  async createOrder(product: PaymentProduct, _checkout?: CheckoutOptions): Promise<string> {
    if (this.creatingOrder) {
      throw new PaymentError({
        code: 'PAYMENT_FAILED',
        message: 'A PayPal order is already being created.',
        method: 'paypal',
        provider: 'paypal',
      });
    }

    this.creatingOrder = true;
    try {
      const metadata = assertMerchantMetadata(product.metadata, 'paypal', 'paypal');
      const orderId = metadata?.[PAYPAL_ORDER_REFERENCE_KEY];
      const payload = toPayPalCreateOrderRequest({
        productId: product.id,
        quantity: product.quantity ?? 1,
        currency: product.currency,
        ...(orderId ? { orderReference: assertPayPalOrderReference(orderId) } : {}),
      });

      const response = await this.backend.createPayPalOrder(payload);
      this.activeOrderId = response.orderId;
      return response.orderId;
    } catch (error) {
      throw mapPayPalError(error, 'BACKEND_ERROR', 'Failed to create PayPal order.');
    } finally {
      this.creatingOrder = false;
    }
  }

  async captureOrder(orderId: string): Promise<PaymentResult> {
    if (this.capturing) {
      throw new PaymentError({
        code: 'PAYMENT_FAILED',
        message: 'A PayPal capture is already in progress.',
        method: 'paypal',
        provider: 'paypal',
      });
    }

    this.capturing = true;
    try {
      const response = await this.backend.capturePayPalOrder(orderId);
      return normalizePaymentResult({
        status: 'success',
        method: 'paypal',
        provider: 'paypal',
        transactionId: response.captureId,
        sessionId: response.orderId,
        message: 'PayPal payment completed.',
        metadata: {
          paypalStatus: response.status,
        },
      });
    } catch (error) {
      throw mapPayPalError(error, 'PAYMENT_FAILED', 'Failed to capture PayPal payment.');
    } finally {
      this.capturing = false;
    }
  }

  /**
   * Renders official PayPal Buttons into `container` under an ownership-scoped mount id.
   * Re-rendering with the same `mountId` replaces only that mount; other hosts stay intact.
   * @returns The mount id to pass to {@link destroyButtons} on host teardown.
   */
  async renderButtons(
    container: HTMLElement,
    options: Omit<PayPalButtonsOptions, 'style'> & { style?: Record<string, string> },
    locale: EasyPaymentsResolvedLocale = 'en',
    mountId?: string,
  ): Promise<string> {
    const id = mountId ?? this.allocateMountId();
    // Replace only this owner's previous Buttons instance.
    await this.destroyButtons(id);

    const paypal = await this.ensureSdkLoaded(locale);
    const buttons = paypal.Buttons({
      style: {
        layout: 'vertical',
        color: 'gold',
        shape: 'rect',
        label: 'paypal',
        ...(options.style ?? {}),
      },
      createOrder: options.createOrder,
      onApprove: options.onApprove,
      onCancel: options.onCancel,
      onError: options.onError,
      onClick: options.onClick,
    });

    this.buttonMounts.set(id, buttons);
    try {
      await buttons.render(container);
    } catch (error) {
      this.buttonMounts.delete(id);
      throw error;
    }
    return id;
  }

  /**
   * Closes one Buttons mount (host teardown) or all mounts when `mountId` is omitted
   * (adapter-wide destroy / orchestrator re-init).
   */
  async destroyButtons(mountId?: string): Promise<void> {
    if (mountId !== undefined) {
      const current = this.buttonMounts.get(mountId);
      this.buttonMounts.delete(mountId);
      await this.closeButtonsHandle(current);
      return;
    }

    const handles = Array.from(this.buttonMounts.values());
    this.buttonMounts.clear();
    for (const handle of handles) {
      await this.closeButtonsHandle(handle);
    }
  }

  /** Active ownership-scoped Buttons mounts (test / diagnostics). */
  getActiveButtonMountCount(): number {
    return this.buttonMounts.size;
  }

  isBusy(): boolean {
    return this.creatingOrder || this.capturing;
  }

  getActiveOrderId(): string | null {
    return this.activeOrderId;
  }

  /**
   * Full adapter reset: closes every Buttons mount and clears in-flight order flags.
   * Prefer {@link destroyButtons}(mountId) from individual payment hosts.
   */
  async destroy(): Promise<void> {
    await this.destroyButtons();
    this.activeOrderId = null;
    this.creatingOrder = false;
    this.capturing = false;
  }

  private allocateMountId(): string {
    this.nextMountId += 1;
    return `paypal-buttons-${this.nextMountId}`;
  }

  private async closeButtonsHandle(handle: PayPalButtonsHandle | undefined): Promise<void> {
    if (!handle?.close) {
      return;
    }
    try {
      await handle.close();
    } catch {
      // Ignore close failures during teardown.
    }
  }
}

@Injectable({ providedIn: 'root' })
export class PayPalMockAdapter extends BaseMockAdapter {
  readonly provider = 'paypal' as const;
  readonly method = 'paypal' as const;
}
