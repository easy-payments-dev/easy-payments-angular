/**
 * Minimal typings for Zip US JS SDK (`window.quadpay.apiCheckout`).
 * @see https://docs.us.zip.co/docs/api-javascript-sdk.md
 */

export interface ZipCheckoutOrderResult {
  amount?: number;
  currency?: string;
  isSuccess?: boolean;
  isTest?: boolean;
  merchantId?: string;
  merchantReference?: string;
  orderId?: string;
  timestamp?: string;
}

export interface ZipCheckoutCompleteResult {
  customer?: Record<string, unknown>;
  order?: ZipCheckoutOrderResult;
  shippingAddress?: Record<string, unknown>;
  success?: boolean;
}

export interface ZipApiCheckout {
  openCheckout: (requestBody: Record<string, unknown>, signature: string) => void;
  onComplete: (callback: (result: ZipCheckoutCompleteResult) => void) => void;
  onClose: (callback: (message: string) => void) => void;
  onError: (callback: (errors: string[]) => void) => void;
  focusCheckout?: () => void;
  closeCheckout?: () => void;
}

export interface ZipQuadPayNamespace {
  apiCheckout?: ZipApiCheckout;
}

export interface ZipPreparedCheckout {
  merchantReference: string;
  merchantId: string;
  amount: number;
  currency: string;
  requestBody: Record<string, unknown>;
  signature: string;
  sdkScriptUrl: string;
}

export type ZipUiState =
  | 'idle'
  | 'preparing'
  | 'ready'
  | 'open'
  | 'verifying'
  | 'success'
  | 'cancelled'
  | 'error';

declare global {
  interface Window {
    quadpay?: ZipQuadPayNamespace;
  }
}
