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
  PayPalButtonsStyle,
  PayPalNamespace,
} from './paypal.types';

/**
 * PayPal JS SDK rejects non-numeric `height` and `tagline` with vertical layout.
 * Coerce CSS-like values and drop incompatible fields before `Buttons()`.
 */
export function sanitizePayPalButtonStyle(style: PayPalButtonsStyle): PayPalButtonsStyle {
  const next: PayPalButtonsStyle = { ...style };
  if ('height' in next) {
    const raw = next.height as unknown;
    let height: number | undefined;
    if (typeof raw === 'number' && Number.isFinite(raw)) {
      height = raw;
    } else if (typeof raw === 'string') {
      const parsed = Number.parseInt(raw, 10);
      height = Number.isFinite(parsed) ? parsed : undefined;
    } else {
      height = undefined;
    }
    if (height === undefined) {
      delete next.height;
    } else {
      next.height = Math.min(55, Math.max(25, Math.round(height)));
    }
  }
  if ('borderRadius' in next) {
    const raw = next.borderRadius as unknown;
    let radius: number | undefined;
    if (typeof raw === 'number' && Number.isFinite(raw)) {
      radius = raw;
    } else if (typeof raw === 'string') {
      const parsed = Number.parseFloat(raw);
      radius = Number.isFinite(parsed) ? parsed : undefined;
    } else {
      radius = undefined;
    }
    if (radius === undefined || radius < 0) {
      delete next.borderRadius;
    } else {
      // Classic SDK treats borderRadius=0 as falsy and skips the CSS rule.
      // Callers should prefer shape:'sharp' for zero; still coerce valid positives.
      next.borderRadius = Math.round(radius);
    }
  }
  if (next.layout !== 'horizontal') {
    delete next.tagline;
  }
  return next;
}

declare global {
  interface Window {
    paypal?: PayPalNamespace;
  }
}

const LEGACY_PAYPAL_OWNER = 'paypal-legacy';

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
  /** Script fingerprint for locale + funding flags last successfully loaded. */
  private loadedSdkFingerprint: string | null = null;
  /**
   * Per-host official Buttons mounts. Destroying one host must not close another's.
   * Keyed by opaque mount ids owned by PayPalPaymentComponent instances.
   */
  private readonly buttonMounts = new Map<string, PayPalButtonsHandle>();
  private nextMountId = 0;
  private readonly creatingOwners = new Set<string>();
  private readonly capturingOrders = new Set<string>();
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
    const snapshot = this.configService.getSnapshot();
    const venmoConfig = snapshot.providers?.venmo;
    const enableVenmo = !!venmoConfig && typeof venmoConfig === 'object';
    const sandboxBuyerCountry =
      enableVenmo && venmoConfig.sandboxBuyerCountry === 'US' ? 'US' : null;
    const fundingFingerprint = [
      enableVenmo ? 'venmo' : 'none',
      sandboxBuyerCountry ?? 'no-buyer',
    ].join('+');
    const scriptId = `easy-payments-paypal-sdk-${paypalLocale}-${fundingFingerprint}`;
    const fingerprint = `${paypalLocale}|${fundingFingerprint}`;

    if (this.loadedSdkFingerprint === fingerprint) {
      const existing = this.browser.getWindow()?.paypal;
      if (existing?.Buttons) {
        return existing;
      }
      this.loadPromise = null;
    } else if (this.loadedSdkFingerprint || this.loadedSdkLocale) {
      this.unloadSdk(this.loadedSdkLocale ?? paypalLocale, this.loadedSdkFingerprint);
      this.loadPromise = null;
    }

    if (this.loadPromise) {
      return this.loadPromise;
    }

    const paypalConfig = snapshot.providers?.paypal;
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

    const params = new URLSearchParams({
      'client-id': clientId,
      currency,
      intent,
      components: 'buttons',
      locale: paypalLocale,
    });
    // Official Venmo docs: enable-funding=venmo so the Venmo button can render when eligible.
    // https://developer.paypal.com/platforms/checkout/pay-with-venmo/integrate
    if (enableVenmo) {
      params.set('enable-funding', 'venmo');
    }
    // Sandbox-only simulation of a US buyer. Never set in production.
    // https://developer.paypal.com/platforms/checkout/pay-with-venmo/test
    if (sandboxBuyerCountry) {
      params.set('buyer-country', sandboxBuyerCountry);
    }

    this.loadPromise = (async () => {
      try {
        await this.sdkLoader.loadScript({
          id: scriptId,
          src: `https://www.paypal.com/sdk/js?${params.toString()}`,
          // Surface hangs (adblock / DNS / captive portal) as a timeout instead of spinning forever.
          timeoutMs: 20_000,
        });
      } catch (error) {
        this.loadPromise = null;
        this.loadedSdkLocale = null;
        this.loadedSdkFingerprint = null;
        this.sdkLoader.unloadScript(scriptId);
        throw mapPayPalError(error, 'SDK_LOAD_FAILED', 'PayPal SDK script failed to load.');
      }

      const paypal = this.browser.getWindow()?.paypal;
      if (!paypal?.Buttons) {
        this.loadPromise = null;
        this.loadedSdkLocale = null;
        this.loadedSdkFingerprint = null;
        this.sdkLoader.unloadScript(scriptId);
        throw new PaymentError({
          code: 'SDK_LOAD_FAILED',
          message:
            'PayPal SDK script finished loading but window.paypal.Buttons is unavailable.',
          method: 'paypal',
          provider: 'paypal',
        });
      }

      this.loadedSdkLocale = paypalLocale;
      this.loadedSdkFingerprint = fingerprint;
      return paypal;
    })();

    return this.loadPromise;
  }

  private unloadSdk(previousLocale: string, previousFingerprint: string | null = null): void {
    const win = this.browser.getWindow();
    if (win?.paypal) {
      delete win.paypal;
    }
    if (previousFingerprint) {
      const localePart = previousFingerprint.split('|')[0] ?? previousLocale;
      const fundingPart = previousFingerprint.split('|')[1] ?? 'none+no-buyer';
      this.sdkLoader.unloadScript(`easy-payments-paypal-sdk-${localePart}-${fundingPart}`);
    }
    this.sdkLoader.unloadScript(`easy-payments-paypal-sdk-${previousLocale}`);
    // Legacy id from pre-locale builds.
    this.sdkLoader.unloadScript('easy-payments-paypal-sdk');
    this.loadedSdkFingerprint = null;
  }

  /**
   * Creates a PayPal order for one host. Concurrent creates are rejected per
   * `ownerId` only, so sibling hosts on the same page are independent.
   */
  async createOrder(
    product: PaymentProduct,
    _checkout?: CheckoutOptions,
    ownerId: string = LEGACY_PAYPAL_OWNER,
  ): Promise<string> {
    if (this.creatingOwners.has(ownerId)) {
      throw new PaymentError({
        code: 'PAYMENT_FAILED',
        message: 'A PayPal order is already being created.',
        method: 'paypal',
        provider: 'paypal',
      });
    }

    this.creatingOwners.add(ownerId);
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
      this.creatingOwners.delete(ownerId);
    }
  }

  /**
   * Captures one order. A second capture of the same order id is rejected (never double-captured).
   * Venmo reuses PayPal Orders v2; pass `method: 'venmo'` so outcomes are tagged correctly.
   */
  async captureOrder(
    orderId: string,
    options?: { method?: 'paypal' | 'venmo' },
  ): Promise<PaymentResult> {
    const method = options?.method === 'venmo' ? 'venmo' : 'paypal';
    const provider = method === 'venmo' ? 'venmo' : 'paypal';
    if (this.capturingOrders.has(orderId)) {
      throw new PaymentError({
        code: 'PAYMENT_FAILED',
        message:
          method === 'venmo'
            ? 'A Venmo capture is already in progress.'
            : 'A PayPal capture is already in progress.',
        method,
        provider,
      });
    }

    this.capturingOrders.add(orderId);
    try {
      const response = await this.backend.capturePayPalOrder(orderId);
      return normalizePaymentResult({
        status: 'success',
        method,
        provider,
        transactionId: response.captureId,
        sessionId: response.orderId,
        message:
          method === 'venmo' ? 'Venmo payment completed.' : 'PayPal payment completed.',
        metadata: {
          paypalStatus: response.status,
          ...(method === 'venmo' ? { fundingSource: 'venmo' } : {}),
        },
      });
    } catch (error) {
      throw mapPayPalError(
        error,
        'PAYMENT_FAILED',
        method === 'venmo'
          ? 'Failed to capture Venmo payment.'
          : 'Failed to capture PayPal payment.',
      );
    } finally {
      this.capturingOrders.delete(orderId);
    }
  }

  /**
   * Renders official PayPal Buttons into `container` under an ownership-scoped mount id.
   * Re-rendering with the same `mountId` replaces only that mount; other hosts stay intact.
   * @returns The mount id to pass to {@link destroyButtons} on host teardown.
   */
  async renderButtons(
    container: HTMLElement,
    options: PayPalButtonsOptions,
    locale: EasyPaymentsResolvedLocale = 'en',
    mountId?: string,
  ): Promise<string> {
    const id = mountId ?? this.allocateMountId();
    // Replace only this owner's previous Buttons instance.
    await this.destroyButtons(id);

    const paypal = await this.ensureSdkLoaded(locale);
    // When fundingSource is set (Buttons Only compact), PayPal renders one button.
    // Full checkout omits it so eligible Pay Later / card funding can still appear.
    const resolvedFunding =
      typeof options.fundingSource === 'string' && options.fundingSource.trim()
        ? options.fundingSource.trim()
        : undefined;

    const style = sanitizePayPalButtonStyle({
      layout: 'vertical',
      color: 'gold',
      shape: 'rect',
      label: 'paypal',
      ...(options.style ?? {}),
    });

    let buttons: PayPalButtonsHandle;
    try {
      buttons = paypal.Buttons({
        style,
        ...(resolvedFunding ? { fundingSource: resolvedFunding } : {}),
        createOrder: options.createOrder,
        onApprove: options.onApprove,
        onCancel: options.onCancel,
        onError: options.onError,
        onClick: options.onClick,
      });
    } catch (error) {
      throw mapPayPalError(
        error,
        'PROVIDER_UNAVAILABLE',
        'PayPal Buttons could not be created with the current options.',
      );
    }

    if (typeof buttons.isEligible === 'function' && !buttons.isEligible()) {
      const isVenmo = resolvedFunding === 'venmo';
      throw new PaymentError({
        code: 'PROVIDER_UNAVAILABLE',
        message: isVenmo
          ? 'Venmo Buttons are not eligible in this browser or funding configuration.'
          : 'PayPal Buttons are not eligible in this browser or funding configuration.',
        method: isVenmo ? 'venmo' : 'paypal',
        provider: isVenmo ? 'venmo' : 'paypal',
      });
    }

    this.buttonMounts.set(id, buttons);
    try {
      await buttons.render(container);
    } catch (error) {
      this.buttonMounts.delete(id);
      throw mapPayPalError(
        error,
        'PROVIDER_UNAVAILABLE',
        'PayPal Buttons failed to render.',
      );
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

  /**
   * With `ownerId`: true while that owner is creating an order or `orderId` is capturing.
   * Without arguments: true while any order is being created or captured (legacy).
   */
  isBusy(ownerId?: string, orderId?: string | null): boolean {
    if (ownerId === undefined && orderId === undefined) {
      return this.creatingOwners.size > 0 || this.capturingOrders.size > 0;
    }
    return (
      (ownerId !== undefined && this.creatingOwners.has(ownerId)) ||
      (!!orderId && this.capturingOrders.has(orderId))
    );
  }

  /** Most recent order created on the page (any host). Hosts should track their own order id. */
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
    this.creatingOwners.clear();
    this.capturingOrders.clear();
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
