import { appendMetadataSessionPart } from '../../metadata/merchant-metadata';

/** Google's documented TEST merchantId (numeric). Not a production merchant. */
export const GOOGLE_PAY_TEST_MERCHANT_ID = '12345678901234567890';

export const GOOGLE_PAY_API_VERSION = 2;
export const GOOGLE_PAY_API_VERSION_MINOR = 0;

/** Stripe gateway parameters required by Google Pay PAYMENT_GATEWAY tokenization. */
export const STRIPE_GOOGLE_PAY_GATEWAY = 'stripe';
/** API version string expected by Google's Stripe gateway parameters. */
export const STRIPE_GOOGLE_PAY_API_VERSION = '2018-10-31';

export type GooglePayUiState =
  | 'idle'
  | 'initializing'
  | 'ready'
  | 'creating-session'
  | 'awaiting-sheet'
  | 'processing'
  | 'success'
  | 'cancelled'
  | 'unavailable'
  | 'error';

export interface GooglePayPaymentsClient {
  isReadyToPay(request: GoogleIsReadyToPayRequest): Promise<GoogleIsReadyToPayResponse>;
  loadPaymentData(request: GooglePaymentDataRequest): Promise<GooglePaymentData>;
  createButton(options: GooglePayButtonOptions): HTMLElement;
}

export interface GoogleIsReadyToPayRequest {
  apiVersion: number;
  apiVersionMinor: number;
  allowedPaymentMethods: GooglePayAllowedPaymentMethod[];
  existingPaymentMethodRequired?: boolean;
}

export interface GoogleIsReadyToPayResponse {
  result: boolean;
  paymentMethodPresent?: boolean;
}

export interface GooglePayAllowedPaymentMethod {
  type: 'CARD';
  parameters: {
    allowedAuthMethods: string[];
    allowedCardNetworks: string[];
  };
  tokenizationSpecification: {
    type: 'PAYMENT_GATEWAY';
    parameters: Record<string, string>;
  };
}

export interface GooglePaymentDataRequest {
  apiVersion: number;
  apiVersionMinor: number;
  allowedPaymentMethods: GooglePayAllowedPaymentMethod[];
  transactionInfo: {
    countryCode: string;
    currencyCode: string;
    totalPriceStatus: 'FINAL';
    totalPrice: string;
  };
  merchantInfo: {
    merchantId?: string;
    merchantName: string;
  };
}

export interface GooglePaymentData {
  paymentMethodData?: {
    tokenizationData?: {
      type?: string;
      token?: string;
    };
    info?: {
      cardNetwork?: string;
      cardDetails?: string;
    };
  };
}

export interface GooglePayButtonOptions {
  onClick: (event: Event) => void;
  buttonColor?: 'default' | 'black' | 'white';
  /**
   * `short` is Google's legacy alias that renders the same logo-only button as `plain`.
   * pay.js still accepts it and never applies the signed-in "dynamic" card-info variant to it.
   */
  buttonType?:
    | 'book'
    | 'buy'
    | 'checkout'
    | 'donate'
    | 'order'
    | 'pay'
    | 'plain'
    | 'short'
    | 'subscribe';
  buttonSizeMode?: 'static' | 'fill';
  buttonLocale?: string;
}

export interface GooglePayNamespace {
  payments: {
    api: {
      PaymentsClient: new (options: {
        environment: 'TEST' | 'PRODUCTION';
        merchantInfo?: { merchantId?: string; merchantName?: string };
      }) => GooglePayPaymentsClient;
    };
  };
}

declare global {
  interface Window {
    google?: GooglePayNamespace;
  }
}

/** Format a major-unit total for Google Pay transactionInfo.totalPrice. */
export function formatGooglePayTotalPrice(unitAmount: number, quantity: number): string {
  const total = Number((unitAmount * quantity).toFixed(2));
  if (!Number.isFinite(total) || total < 0) {
    throw new Error('Invalid Google Pay total price.');
  }
  return total.toFixed(2);
}

/**
 * Stable key for Google Pay button host identity.
 * Theme is excluded — theme may restyle the button without starting payments.
 */
export function buildGooglePayRenderKey(product: {
  id: string;
  currency: string;
  quantity?: number;
  amount: number;
  metadata?: Record<string, string>;
}): string {
  const quantity = product.quantity ?? 1;
  return appendMetadataSessionPart(
    `${product.id}|${quantity}|${product.currency.trim().toUpperCase()}|${product.amount}`,
    product.metadata,
  );
}
