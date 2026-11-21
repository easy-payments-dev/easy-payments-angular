import { isKnownPaymentMethod, interactionForMethod } from './headless-method-meta';
import { PAYMENT_METHOD_PROVIDER_MAP } from '../models/payment-method.model';

describe('Headless Amazon Pay meta', () => {
  it('recognizes amazon-pay as a known method', () => {
    expect(isKnownPaymentMethod('amazon-pay')).toBeTrue();
  });

  it('uses wallet-button interaction for real and mock Amazon Pay', () => {
    expect(interactionForMethod('amazon-pay', false)).toBe('wallet-button');
    expect(interactionForMethod('amazon-pay', true)).toBe('mock');
  });

  it('maps amazon-pay to amazonPay provider', () => {
    expect(PAYMENT_METHOD_PROVIDER_MAP['amazon-pay']).toBe('amazonPay');
  });
});
