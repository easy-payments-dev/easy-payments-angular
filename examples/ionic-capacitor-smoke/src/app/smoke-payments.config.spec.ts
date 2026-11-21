import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  resetSmokeCheckoutOptionsCacheForTests,
  resolveSmokeCheckoutOptionsFrom,
} from './capacitor-stripe-return';
import {
  SMOKE_CATALOG_CURRENCY,
  SMOKE_CATALOG_UNIT_AMOUNT,
  SMOKE_PRODUCT,
} from './smoke-catalog.product';
import { SMOKE_METHODS } from './smoke-methods';

describe('SMOKE_METHODS experimental Zip visibility', () => {
  it('omits Zip from the default smoke method list while keeping other methods', () => {
    expect(SMOKE_METHODS).not.toContain('zip');
    expect(SMOKE_METHODS).toContain('card');
    expect(SMOKE_METHODS).toContain('venmo');
    expect(SMOKE_METHODS).toContain('afterpay');
    expect(SMOKE_METHODS).toContain('link');
    expect(SMOKE_METHODS.length).toBe(11);
  });
});

describe('SMOKE_PRODUCT catalog alignment', () => {
  it('matches Nest premium-plan unit amount and currency (server-authoritative)', () => {
    // Keep Pay button / summary in sync with Klarna, PayPal, Affirm installment math.
    expect(SMOKE_PRODUCT.id).toBe('premium-plan');
    expect(SMOKE_PRODUCT.amount).toBe(SMOKE_CATALOG_UNIT_AMOUNT);
    expect(SMOKE_PRODUCT.amount).toBe(99);
    expect(SMOKE_PRODUCT.currency).toBe(SMOKE_CATALOG_CURRENCY);
    expect(SMOKE_PRODUCT.quantity).toBe(1);
  });
});

describe('resolveSmokeCheckoutOptionsFrom', () => {
  beforeEach(() => {
    resetSmokeCheckoutOptionsCacheForTests();
  });

  it('returns undefined on browser so same-origin checkout is preserved', () => {
    expect(
      resolveSmokeCheckoutOptionsFrom({
        isNative: false,
        nativeStripeReturnUrl: 'https://www.easy-payments.dev/capacitor-return',
        useMockMode: false,
      }),
    ).toBeUndefined();
  });

  it('returns App Link checkout options on native when nativeStripeReturnUrl is set', () => {
    expect(
      resolveSmokeCheckoutOptionsFrom({
        isNative: true,
        nativeStripeReturnUrl: 'https://www.easy-payments.dev/capacitor-return',
        useMockMode: false,
      }),
    ).toEqual({
      successUrl: 'https://www.easy-payments.dev/capacitor-return',
      allowExternalHttpsReturnUrl: true,
    });
  });

  it('returns the same object reference across repeated resolutions with the same inputs', () => {
    const input = {
      isNative: true as const,
      nativeStripeReturnUrl: 'https://www.easy-payments.dev/capacitor-return',
      useMockMode: false,
    };
    const first = resolveSmokeCheckoutOptionsFrom(input);
    const second = resolveSmokeCheckoutOptionsFrom({ ...input });
    const third = resolveSmokeCheckoutOptionsFrom({
      isNative: true,
      nativeStripeReturnUrl: 'https://www.easy-payments.dev/capacitor-return',
      useMockMode: false,
    });
    expect(first).toBeTruthy();
    expect(second).toBe(first);
    expect(third).toBe(first);
  });

  it('recomputes only when native return URL inputs change', () => {
    const first = resolveSmokeCheckoutOptionsFrom({
      isNative: true,
      nativeStripeReturnUrl: 'https://www.easy-payments.dev/capacitor-return',
      useMockMode: false,
    });
    const browser = resolveSmokeCheckoutOptionsFrom({
      isNative: false,
      nativeStripeReturnUrl: 'https://www.easy-payments.dev/capacitor-return',
      useMockMode: false,
    });
    const again = resolveSmokeCheckoutOptionsFrom({
      isNative: true,
      nativeStripeReturnUrl: 'https://www.easy-payments.dev/capacitor-return',
      useMockMode: false,
    });
    expect(browser).toBeUndefined();
    expect(again).toEqual(first);
    expect(again).not.toBe(first);
  });

  it('returns undefined on native when nativeStripeReturnUrl is empty and warns in sandbox', () => {
    const warn = vi.fn();
    expect(
      resolveSmokeCheckoutOptionsFrom({
        isNative: true,
        nativeStripeReturnUrl: '',
        useMockMode: false,
        warn,
      }),
    ).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    // Cached miss must not re-warn on every Angular change-detection pass.
    expect(
      resolveSmokeCheckoutOptionsFrom({
        isNative: true,
        nativeStripeReturnUrl: '',
        useMockMode: false,
        warn,
      }),
    ).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    const message = String(warn.mock.calls[0]?.[0] ?? '');
    expect(message).toContain('nativeStripeReturnUrl');
    expect(message).not.toContain('pk_');
    expect(message).not.toContain('secret');
  });
});
