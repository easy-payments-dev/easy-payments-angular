import { mapPayPalError } from './paypal-error.mapper';
import { PaymentError } from '../../errors/payment-error';

describe('mapPayPalError', () => {
  it('preserves PaymentError instances', () => {
    const original = new PaymentError({
      code: 'BACKEND_ERROR',
      message: 'boom',
      method: 'paypal',
      provider: 'paypal',
    });
    expect(mapPayPalError(original)).toBe(original);
  });

  it('normalizes cancellation / popup closed', () => {
    const error = mapPayPalError(new Error('Popup closed by user'));
    expect(error.code).toBe('PAYMENT_CANCELLED');
    expect(error.method).toBe('paypal');
  });

  it('normalizes network failures', () => {
    expect(mapPayPalError(new Error('network timeout')).code).toBe('NETWORK_ERROR');
  });

  it('normalizes declined payments', () => {
    expect(mapPayPalError(new Error('INSTRUMENT_DECLINED')).code).toBe('PAYMENT_FAILED');
  });

  it('maps script load / timeout messages to SDK_LOAD_FAILED', () => {
    expect(
      mapPayPalError(
        new Error('Failed to load SDK: https://www.paypal.com/sdk/js?client-id=REDACTED'),
      ).code,
    ).toBe('SDK_LOAD_FAILED');
    expect(
      mapPayPalError(new Error('Timed out loading SDK after 20000ms: https://example.test')).code,
    ).toBe('SDK_LOAD_FAILED');
  });

  it('does not mislabel Buttons create/render failures as SDK_LOAD_FAILED', () => {
    expect(
      mapPayPalError(
        new Error('Expected height to be a number between 25 and 55'),
        'PROVIDER_UNAVAILABLE',
      ).code,
    ).toBe('PROVIDER_UNAVAILABLE');
  });
});
