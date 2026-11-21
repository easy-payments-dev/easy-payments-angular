import { PAYMENT_METHOD_PROVIDER_MAP } from '../models';
import { interactionForMethod, isKnownPaymentMethod } from './headless-method-meta';

describe('headless method meta (Link)', () => {
  it('recognizes link as a known payment method', () => {
    expect(isKnownPaymentMethod('link')).toBeTrue();
  });

  it('uses the wallet-button interaction for Link (no confirm — buyer clicks the Link button)', () => {
    expect(interactionForMethod('link', false)).toBe('wallet-button');
    expect(interactionForMethod('apple-pay', false)).toBe('wallet-button');
    expect(interactionForMethod('link', true)).toBe('mock');
  });

  it('maps link to the link provider', () => {
    expect(PAYMENT_METHOD_PROVIDER_MAP['link']).toBe('link');
  });
});