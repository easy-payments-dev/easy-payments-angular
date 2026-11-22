export type PaymentMethod =
  | 'apple-pay'
  | 'google-pay'
  | 'paypal'
  | 'venmo'
  | 'klarna'
  | 'affirm'
  | 'card'
  | 'us-bank-account'
  | 'cash-app-pay'
  | 'afterpay'
  | 'zip'
  | 'link'
  | 'amazon-pay'
  | 'alipay';

export type PaymentProviderName =
  | 'stripe'
  | 'paypal'
  | 'venmo'
  | 'applePay'
  | 'googlePay'
  | 'klarna'
  | 'affirm'
  | 'usBankAccount'
  | 'cashAppPay'
  | 'afterpay'
  | 'zip'
  | 'link'
  | 'amazonPay'
  | 'alipay';

export const PAYMENT_METHOD_PROVIDER_MAP: Record<PaymentMethod, PaymentProviderName> = {
  'apple-pay': 'applePay',
  'google-pay': 'googlePay',
  paypal: 'paypal',
  venmo: 'venmo',
  klarna: 'klarna',
  affirm: 'affirm',
  card: 'stripe',
  'us-bank-account': 'usBankAccount',
  'cash-app-pay': 'cashAppPay',
  afterpay: 'afterpay',
  zip: 'zip',
  link: 'link',
  'amazon-pay': 'amazonPay',
  alipay: 'alipay',
};

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  'apple-pay': 'Apple Pay',
  'google-pay': 'Google Pay',
  paypal: 'PayPal',
  venmo: 'Venmo',
  klarna: 'Klarna',
  affirm: 'Affirm',
  card: 'Card',
  'us-bank-account': 'US bank account',
  'cash-app-pay': 'Cash App Pay',
  afterpay: 'Afterpay',
  zip: 'Zip',
  link: 'Link',
  'amazon-pay': 'Amazon Pay',
  alipay: 'Alipay',
};
