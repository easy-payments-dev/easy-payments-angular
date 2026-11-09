import { PaymentError } from '../../errors/payment-error';
import { buildStripeReturnUrl } from './stripe-redirect-return';

const PAGE = 'https://shop.example/pay?existing=1';

function parsed(baseUrl: string | undefined, locationHref = PAGE, attemptId?: string): URL {
  return new URL(buildStripeReturnUrl('klarna', baseUrl, locationHref, attemptId));
}

describe('buildStripeReturnUrl', () => {
  it('accepts a same-origin absolute HTTPS URL', () => {
    const url = parsed('https://shop.example/checkout');
    expect(url.origin).toBe('https://shop.example');
    expect(url.pathname).toBe('/checkout');
    expect(url.searchParams.get('ep_method')).toBe('klarna');
  });

  it('resolves a same-origin relative path against the current page', () => {
    const url = parsed('/checkout/return');
    expect(url.href).toContain('https://shop.example/checkout/return');
    expect(url.searchParams.get('ep_method')).toBe('klarna');
  });

  it('preserves an existing query string', () => {
    const url = parsed('https://shop.example/checkout?utm=spring&plan=premium');
    expect(url.searchParams.get('utm')).toBe('spring');
    expect(url.searchParams.get('plan')).toBe('premium');
    expect(url.searchParams.get('ep_method')).toBe('klarna');
  });

  it('preserves an existing fragment', () => {
    const url = parsed('https://shop.example/checkout?utm=1#payment');
    expect(url.searchParams.get('utm')).toBe('1');
    expect(url.hash).toBe('#payment');
    expect(url.searchParams.get('ep_method')).toBe('klarna');
  });

  it('accepts HTTP localhost during development', () => {
    const url = parsed(
      'http://localhost:4200/checkout?debug=1#pay',
      'http://localhost:4200/app',
    );
    expect(url.origin).toBe('http://localhost:4200');
    expect(url.pathname).toBe('/checkout');
    expect(url.searchParams.get('debug')).toBe('1');
    expect(url.hash).toBe('#pay');
    expect(url.searchParams.get('ep_method')).toBe('klarna');
  });

  it('stamps the Stripe return markers without dropping merchant params', () => {
    const url = parsed('https://shop.example/checkout?utm=1#done', PAGE, 'abc12345');
    expect(url.searchParams.get('ep_method')).toBe('klarna');
    expect(url.searchParams.get('ep_attempt')).toBe('abc12345');
    expect(url.searchParams.get('utm')).toBe('1');
    expect(url.hash).toBe('#done');
  });

  it('uses the current page when successUrl is omitted', () => {
    const url = parsed(undefined);
    expect(url.origin).toBe('https://shop.example');
    expect(url.pathname).toBe('/pay');
    expect(url.searchParams.get('existing')).toBe('1');
    expect(url.searchParams.get('ep_method')).toBe('klarna');
  });

  it('rejects javascript, data, and file URLs', () => {
    for (const value of ['javascript:alert(1)', 'data:text/html,hi', 'file:///tmp/return']) {
      expect(() => parsed(value)).toThrowError(PaymentError, /same-origin http/);
    }
  });

  it('rejects a blob URL', () => {
    expect(() => parsed('blob:https://shop.example/11111111-1111-1111-1111-111111111111')).toThrowError(
      PaymentError,
      /same-origin http/,
    );
  });

  it('rejects a cross-origin HTTPS URL', () => {
    expect(() => parsed('https://evil.example/checkout')).toThrowError(PaymentError, /same-origin http/);
  });

  it('rejects a protocol-relative cross-origin URL', () => {
    expect(() => parsed('//evil.example/checkout')).toThrowError(PaymentError, /same-origin http/);
  });

  it('rejects a malformed URL', () => {
    expect(() => parsed('https://')).toThrowError(PaymentError, /same-origin http/);
    expect(() => parsed('http://[')).toThrowError(PaymentError, /same-origin http/);
  });

  it('rejects credentials in an otherwise same-origin URL', () => {
    expect(() => parsed('https://user:secret@shop.example/checkout')).toThrowError(
      PaymentError,
      /same-origin http/,
    );
  });

  it('does not include a client secret in the configuration error', () => {
    const secret = 'pi_test_secret_do_not_leak';
    try {
      parsed(`https://evil.example/return?payment_intent_client_secret=${secret}`);
      fail('expected configuration error');
    } catch (error) {
      expect(error).toBeInstanceOf(PaymentError);
      const paymentError = error as PaymentError;
      expect(paymentError.code).toBe('CONFIG_INVALID');
      expect(paymentError.method).toBe('klarna');
      expect(paymentError.message).not.toContain(secret);
      expect(paymentError.message).not.toContain('payment_intent_client_secret');
      expect(paymentError.message).not.toContain('evil.example');
    }
  });
});
