import { appendMetadataSessionPart } from '../../metadata/merchant-metadata';
import { CheckoutOptions, PaymentProduct } from '../../models';

/**
 * Stable identity for PayPal button render sessions.
 * Theme is intentionally excluded — theme changes must not recreate orders or buttons.
 */
export function buildPayPalRenderKey(
  product: PaymentProduct,
  checkout?: CheckoutOptions,
): string {
  const quantity = product.quantity ?? 1;
  const currency = product.currency.trim().toUpperCase();
  const email = checkout?.customer?.email ?? '';
  const name = checkout?.customer?.name ?? '';
  const success = checkout?.successUrl ?? '';
  const cancel = checkout?.cancelUrl ?? '';
  return appendMetadataSessionPart(
    `${product.id}|${quantity}|${currency}|${email}|${name}|${success}|${cancel}`,
    product.metadata,
  );
}

export type PayPalUiState =
  | 'idle'
  | 'initializing'
  | 'ready'
  | 'creating-order'
  | 'waiting-approval'
  | 'capturing'
  | 'success'
  | 'cancelled'
  | 'error';

export interface PayPalButtonsHandle {
  render(selector: string | HTMLElement): Promise<void>;
  close?: () => Promise<void>;
}

/**
 * Official PayPal JS SDK funding source identifiers.
 * When set on Buttons(), the SDK renders only that single funding button.
 */
export type PayPalFundingSource =
  | 'paypal'
  | 'paylater'
  | 'card'
  | 'credit'
  | 'venmo'
  | 'sepa'
  | string;

/**
 * Subset of the PayPal JS SDK `style` object. The SDK validates types at runtime:
 * `height` must be a number (25–55) or `Buttons()` throws before rendering.
 * `tagline` is only valid with `layout: 'horizontal'`.
 */
export interface PayPalButtonsStyle {
  layout?: 'vertical' | 'horizontal';
  color?: 'gold' | 'blue' | 'silver' | 'white' | 'black';
  shape?: 'rect' | 'pill' | 'sharp';
  label?: 'paypal' | 'checkout' | 'buynow' | 'pay';
  height?: number;
  tagline?: boolean;
}

export interface PayPalButtonsOptions {
  style?: PayPalButtonsStyle;
  /**
   * When set (e.g. `'paypal'`), renders only that funding button.
   * Omit to let the SDK show all eligible funding sources (full checkout).
   */
  fundingSource?: PayPalFundingSource;
  createOrder: () => Promise<string>;
  onApprove: (data: { orderID: string }) => Promise<void>;
  onCancel?: () => void;
  onError?: (error: unknown) => void;
  onClick?: (
    data: unknown,
    actions: { reject: () => Promise<void>; resolve: () => Promise<void> },
  ) => void | Promise<void>;
}

export interface PayPalNamespace {
  Buttons(options: PayPalButtonsOptions): PayPalButtonsHandle;
  FUNDING?: {
    PAYPAL?: string;
    PAYLATER?: string;
    CARD?: string;
    CREDIT?: string;
    VENMO?: string;
    [key: string]: string | undefined;
  };
}
