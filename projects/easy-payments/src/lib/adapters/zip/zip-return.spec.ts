import {
  buildZipReturnUrl,
  clearZipPendingReturn,
  isZipCancelReturn,
  isZipReturnAttempt,
  markZipPendingReturn,
  readZipPendingReturn,
  readZipReturnParams,
  ZIP_PENDING_STORAGE_KEY,
  ZIP_RETURN_METHOD_PARAM,
} from './zip-return';

describe('zip-return', () => {
  let storage: Storage;

  beforeEach(() => {
    const map = new Map<string, string>();
    storage = {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => {
        map.set(k, v);
      },
      removeItem: (k: string) => {
        map.delete(k);
      },
      clear: () => map.clear(),
      key: () => null,
      length: 0,
    };
  });

  it('builds confirm and cancel return URLs', () => {
    const confirm = buildZipReturnUrl(
      'confirm',
      'http://localhost:4200/checkout?x=1',
    );
    expect(confirm).toContain(`${ZIP_RETURN_METHOD_PARAM}=confirm`);
    const cancel = buildZipReturnUrl('cancel', 'http://localhost:4200/checkout');
    expect(cancel).toContain(`${ZIP_RETURN_METHOD_PARAM}=cancel`);
  });

  it('parses an approval return query', () => {
    const params = readZipReturnParams(
      `?${ZIP_RETURN_METHOD_PARAM}=confirm&merchantReference=ref-1&orderId=ord-1&success=True&X-QP-Signature=sig`,
    );
    expect(params.mode).toBe('confirm');
    expect(params.merchantReference).toBe('ref-1');
    expect(params.orderId).toBe('ord-1');
    expect(params.success).toBe(true);
    expect(params.signature).toBe('sig');
    expect(isZipReturnAttempt(params.rawQuery ? `?${params.rawQuery}` : undefined)).toBe(true);
  });

  it('detects cancellation returns', () => {
    expect(
      isZipCancelReturn(`?${ZIP_RETURN_METHOD_PARAM}=cancel`),
    ).toBe(true);
    expect(isZipCancelReturn('?success=False&merchantReference=ref-1')).toBe(true);
  });

  it('rejects invalid / empty returns without pending', () => {
    expect(isZipReturnAttempt('')).toBe(false);
    expect(isZipReturnAttempt('?foo=bar')).toBe(false);
  });

  it('stores and clears pending return state', () => {
    markZipPendingReturn('premium-plan', 'ref-abc', storage);
    const pending = readZipPendingReturn(storage);
    expect(pending?.merchantReference).toBe('ref-abc');
    expect(storage.getItem(ZIP_PENDING_STORAGE_KEY)).toBeTruthy();
    clearZipPendingReturn(storage);
    expect(readZipPendingReturn(storage)).toBeNull();
  });
});
