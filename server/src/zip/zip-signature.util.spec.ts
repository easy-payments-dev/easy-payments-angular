import {
  parseZipQueryParams,
  signZipJsonBody,
  signZipKeyValues,
  verifyZipJsonBody,
  verifyZipQueryString,
  verifyZipSignature,
  ZIP_SIGNATURE_HEADER,
} from './zip-signature.util';

describe('zip-signature.util', () => {
  const secret = 'test-zip-api-secret';

  it('signs JSON bodies with HMAC-SHA256 base64', () => {
    const body = JSON.stringify({ merchantId: 'm1', amount: 10 });
    const sig = signZipJsonBody(secret, body);
    expect(sig).toMatch(/^[A-Za-z0-9+/=]+$/);
    expect(verifyZipJsonBody(secret, body, sig)).toBe(true);
    expect(verifyZipJsonBody(secret, body, 'bad')).toBe(false);
  });

  it('signs query key+values alphabetically excluding X-QP-Signature', () => {
    const values = {
      b: 'beta',
      c: 'charlie',
      a: 'alpha',
      [ZIP_SIGNATURE_HEADER]: 'ignored',
    };
    const sig = signZipKeyValues(secret, values);
    // data string must be aalphabbetaccharlie per Zip docs
    const expectedDataSig = signZipKeyValues(secret, {
      a: 'alpha',
      b: 'beta',
      c: 'charlie',
    });
    expect(sig).toBe(expectedDataSig);
  });

  it('verifies return query signatures', () => {
    const base = {
      merchantReference: 'ref-1',
      orderId: 'ord-1',
      success: 'True',
      amount: '99.00',
      currency: 'USD',
      merchantId: 'mid',
    };
    const signature = signZipKeyValues(secret, base);
    const query = new URLSearchParams({
      ...base,
      [ZIP_SIGNATURE_HEADER]: signature,
    }).toString();
    const result = verifyZipQueryString(secret, query);
    expect(result.valid).toBe(true);
    expect(result.params.merchantReference).toBe('ref-1');
  });

  it('rejects invalid return signatures', () => {
    const query = 'merchantReference=ref-1&success=True&X-QP-Signature=not-valid';
    expect(verifyZipQueryString(secret, query).valid).toBe(false);
  });

  it('parses query strings with leading ?', () => {
    expect(parseZipQueryParams('?a=1&b=2')).toEqual({ a: '1', b: '2' });
  });

  it('uses timing-safe comparison for equal-length signatures', () => {
    expect(verifyZipSignature('abc', 'abc')).toBe(true);
    expect(verifyZipSignature('abc', 'abd')).toBe(false);
    expect(verifyZipSignature('abc', 'ab')).toBe(false);
  });
});
