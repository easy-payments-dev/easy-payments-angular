import { inject, Injectable } from '@angular/core';
import { EasyPaymentsConfigService } from '../../config/easy-payments-config.service';
import { backendEndpointUrl } from '../../config/resolve-backend-url';
import {
  CheckoutOptions,
  PaymentContext,
  PaymentProduct,
  PaymentRequest,
  PaymentResult,
} from '../../models';
import { PaymentError } from '../../errors/payment-error';
import type { EasyPaymentsResolvedLocale } from '../../i18n/locale.types';
import { BaseMockAdapter, BaseProviderAdapter } from '../base.adapter';
import { PayPalAdapter } from '../paypal/paypal.adapter';
import type {
  PayPalButtonsOptions,
  PayPalNamespace,
} from '../paypal/paypal.types';

/**
 * Venmo via the PayPal JS SDK (`enable-funding=venmo` + `fundingSource: 'venmo'`).
 * Reuses PayPal Orders v2 create/capture endpoints — no separate Venmo Nest routes.
 *
 * @see https://developer.paypal.com/docs/checkout/pay-with-venmo/integrate/
 * @see https://developer.paypal.com/docs/checkout/pay-with-venmo/test/
 */
@Injectable({ providedIn: 'root' })
export class VenmoAdapter extends BaseProviderAdapter {
  readonly provider = 'venmo' as const;

  private readonly configService = inject(EasyPaymentsConfigService);
  private readonly paypal = inject(PayPalAdapter);

  private configReady = false;

  async initialize(): Promise<void> {
    const snapshot = this.configService.getSnapshot();
    const venmoConfigured =
      !!snapshot.providers?.venmo && typeof snapshot.providers.venmo === 'object';
    const clientId = snapshot.providers?.paypal?.clientId?.trim() ?? '';
    this.configReady = venmoConfigured && !!clientId;
    this.initialized = this.configReady;
  }

  async isAvailable(_context: PaymentContext): Promise<boolean> {
    const snapshot = this.configService.getSnapshot();
    const venmoConfigured =
      !!snapshot.providers?.venmo && typeof snapshot.providers.venmo === 'object';
    const clientId = snapshot.providers?.paypal?.clientId?.trim() ?? '';
    if (!venmoConfigured || !clientId || !this.configReady) {
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

  async createPayment(_request: PaymentRequest): Promise<PaymentResult> {
    throw new PaymentError({
      code: 'PROVIDER_UNAVAILABLE',
      message:
        'Venmo payments require the official Venmo Buttons UI. Use the venmo method inside <easy-payments>.',
      method: 'venmo',
      provider: 'venmo',
    });
  }

  ensureSdkLoaded(locale: EasyPaymentsResolvedLocale = 'en'): Promise<PayPalNamespace> {
    return this.paypal.ensureSdkLoaded(locale);
  }

  createOrder(
    product: PaymentProduct,
    checkout?: CheckoutOptions,
    ownerId?: string,
  ): Promise<string> {
    return this.paypal.createOrder(product, checkout, ownerId);
  }

  captureOrder(orderId: string): Promise<PaymentResult> {
    return this.paypal.captureOrder(orderId, { method: 'venmo' });
  }

  /**
   * Renders the official Venmo funding button. Always sets `fundingSource: 'venmo'`
   * and relies on PayPal SDK `Buttons().isEligible()` (enforced by PayPalAdapter).
   */
  renderButtons(
    container: HTMLElement,
    options: Omit<PayPalButtonsOptions, 'fundingSource'>,
    locale: EasyPaymentsResolvedLocale = 'en',
    mountId?: string,
  ): Promise<string> {
    return this.paypal.renderButtons(
      container,
      {
        ...options,
        fundingSource: 'venmo',
        // Classic Buttons + fundingSource=venmo: Venmo's SDK Label is empty, so the
        // rendered control is the Venmo wordmark (no "Pay with" text). Color blue is
        // the official Venmo primary button color in paypal-checkout-components.
        style: {
          layout: 'vertical',
          color: 'blue',
          shape: 'rect',
          ...(options.style ?? {}),
        },
      },
      locale,
      mountId,
    );
  }

  destroyButtons(mountId?: string): Promise<void> {
    return this.paypal.destroyButtons(mountId);
  }

  getActiveButtonMountCount(): number {
    return this.paypal.getActiveButtonMountCount();
  }

  isBusy(ownerId?: string, orderId?: string | null): boolean {
    return this.paypal.isBusy(ownerId, orderId);
  }

  getActiveOrderId(): string | null {
    return this.paypal.getActiveOrderId();
  }

  async destroy(): Promise<void> {
    // Shared PayPal adapter owns Buttons mounts — hosts must destroy their mount ids.
    // Do not call paypal.destroy() here (would tear down sibling PayPal hosts).
  }
}

@Injectable({ providedIn: 'root' })
export class VenmoMockAdapter extends BaseMockAdapter {
  readonly provider = 'venmo' as const;
  readonly method = 'venmo' as const;
}
