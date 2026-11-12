export type PaymentMethod =
  | 'apple-pay'
  | 'google-pay'
  | 'paypal'
  | 'klarna'
  | 'affirm'
  | 'card'
  | 'us-bank-account';

export type PaymentProviderName =
  | 'stripe'
  | 'paypal'
  | 'applePay'
  | 'googlePay'
  | 'klarna'
  | 'affirm'
  | 'usBankAccount';

export const PAYMENT_METHOD_PROVIDER_MAP: Record<PaymentMethod, PaymentProviderName> = {
  'apple-pay': 'applePay',
  'google-pay': 'googlePay',
  paypal: 'paypal',
  klarna: 'klarna',
  affirm: 'affirm',
  card: 'stripe',
  'us-bank-account': 'usBankAccount',
};

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  'apple-pay': 'Apple Pay',
  'google-pay': 'Google Pay',
  paypal: 'PayPal',
  klarna: 'Klarna',
  affirm: 'Affirm',
  card: 'Card',
  'us-bank-account': 'US bank account',
};
