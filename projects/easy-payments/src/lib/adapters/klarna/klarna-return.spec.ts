import {
  buildKlarnaReturnUrl,
  clearKlarnaPendingReturn,
  clearStripeReturnParamsFromUrl,
  isKlarnaReturnAttempt,
  isKlarnaStripeReturn,
  KLARNA_PENDING_STORAGE_KEY,
  KLARNA_RETURN_METHOD_PARAM,
  markKlarnaPendingReturn,
  readKlarnaPendingReturn,
  readStripeReturnParams,
} from './klarna-return';
import { resetTestLocation, setTestLocation } from '../../testing/test-history';

describe('klarna-return helpers', () => {
  let memory: Record<string, string>;
  let storage: Storage;

  beforeEach(() => {
    memory = {};
    storage = {
      getItem: (key: string) => (key in memory ? memory[key] : null),
      setItem: (key: string, value: string) => {
        memory[key] = value;
      },
      removeItem: (key: string) => {
        delete memory[key];
      },
      clear: () => {
        memory = {};
      },
      key: () => null,
      length: 0,
    };
  });

  it('builds a return_url that stamps ep_method=klarna', () => {
    const url = buildKlarnaReturnUrl(
      'https://shop.example/checkout?utm=1',
      'https://shop.example/checkout?utm=1',
    );
    const parsed = new URL(url);
    expect(parsed.searchParams.get(KLARNA_RETURN_METHOD_PARAM)).toBe('klarna');
    expect(parsed.searchParams.get('utm')).toBe('1');
  });

  it('reads Stripe return query params', () => {
    const params = readStripeReturnParams(
      '?payment_intent=pi_123&payment_intent_client_secret=pi_123_secret_abc&redirect_status=succeeded&ep_method=klarna',
    );
    expect(params.paymentIntentId).toBe('pi_123');
    expect(params.clientSecret).toBe('pi_123_secret_abc');
    expect(params.redirectStatus).toBe('succeeded');
  });

  it('detects Klarna return via ep_method', () => {
    expect(
      isKlarnaStripeReturn(
        '?payment_intent_client_secret=sec&ep_method=klarna',
        storage,
      ),
    ).toBeTrue();
  });

  it('detects Klarna return attempt even without client secret', () => {
    expect(isKlarnaReturnAttempt('?ep_method=klarna', storage)).toBeTrue();
    expect(isKlarnaStripeReturn('?ep_method=klarna', storage)).toBeFalse();
  });

  it('detects Klarna return via pending session marker when ep_method is absent', () => {
    markKlarnaPendingReturn('premium-plan', storage);
    expect(isKlarnaStripeReturn('?payment_intent_client_secret=sec', storage)).toBeTrue();
    expect(readKlarnaPendingReturn(storage)?.productId).toBe('premium-plan');
  });

  it('does not treat unrelated Stripe returns as Klarna', () => {
    expect(isKlarnaStripeReturn('?payment_intent_client_secret=sec', storage)).toBeFalse();
  });

  it('clears pending marker without storing secrets', () => {
    markKlarnaPendingReturn('premium-plan', storage);
    expect(storage.getItem(KLARNA_PENDING_STORAGE_KEY)).toContain('premium-plan');
    expect(storage.getItem(KLARNA_PENDING_STORAGE_KEY)).not.toContain('secret');
    clearKlarnaPendingReturn(storage);
    expect(readKlarnaPendingReturn(storage)).toBeNull();
  });

  it('strips Stripe return params from a URL', () => {
    const before = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    const next = clearStripeReturnParamsFromUrl(
      'https://shop.example/checkout?payment_intent=pi_1&payment_intent_client_secret=sec&redirect_status=succeeded&ep_method=klarna&ep_attempt=a1b2c3d4e5f60718&keep=1',
    );
    expect(next).toContain('keep=1');
    expect(next).toContain('https://shop.example/checkout');
    expect(next).not.toContain('payment_intent=');
    expect(next).not.toContain('payment_intent_client_secret');
    expect(next).not.toContain('ep_method');
    expect(next).not.toContain('ep_attempt');
    expect(next).not.toContain('redirect_status');
    expect(`${window.location.pathname}${window.location.search}${window.location.hash}`).toBe(before);
  });

  it('strips Stripe return params from the live page without changing its path', () => {
    const path = window.location.pathname === '/context.html' ? '/' : window.location.pathname;
    setTestLocation(
      `${path}?payment_intent=pi_live&payment_intent_client_secret=sec_live&ep_method=klarna&ep_attempt=a1b2c3d4e5f60718&keep=1`,
    );
    clearStripeReturnParamsFromUrl();
    expect(window.location.pathname).toBe(path);
    expect(window.location.search).toContain('keep=1');
    expect(window.location.search).not.toContain('payment_intent');
    expect(window.location.search).not.toContain('ep_method');
    expect(window.location.search).not.toContain('ep_attempt');
    resetTestLocation();
  });
});
