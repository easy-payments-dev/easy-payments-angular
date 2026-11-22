import { isKnownPaymentMethod, interactionForMethod } from './headless-method-meta';
import { PAYMENT_METHOD_PROVIDER_MAP } from '../models/payment-method.model';

describe('Headless Alipay meta', () => {
  it('recognizes alipay as a known method', () => {
    expect(isKnownPaymentMethod('alipay')).toBeTrue();
  });

  it('uses confirm interaction for real Alipay and mock for mock mode', () => {
    expect(interactionForMethod('alipay', false)).toBe('confirm');
    expect(interactionForMethod('alipay', true)).toBe('mock');
  });

  it('maps alipay to alipay provider', () => {
    expect(PAYMENT_METHOD_PROVIDER_MAP.alipay).toBe('alipay');
  });
});
