import {
  ACH_RETURN_METHOD,
  buildAchReturnUrl,
  clearAchReturnParamsFromUrl,
  isAchReturnAttempt,
  readAchReturnParams,
} from './us-bank-account-return';

describe('us-bank-account-return helpers', () => {
  it('stamps ep_method=us-bank-account on return_url', () => {
    const href = buildAchReturnUrl(
      undefined,
      'https://shop.example/checkout?foo=1',
    );
    const url = new URL(href);
    expect(url.origin + url.pathname).toBe('https://shop.example/checkout');
    expect(url.searchParams.get('ep_method')).toBe(ACH_RETURN_METHOD);
  });

  it('detects ACH return attempts and reads PI params without exposing secrets in helpers', () => {
    const search =
      '?ep_method=us-bank-account&payment_intent=pi_return_1&payment_intent_client_secret=pi_return_1_secret_x&redirect_status=succeeded';
    expect(isAchReturnAttempt(search)).toBeTrue();
    const params = readAchReturnParams(search);
    expect(params.paymentIntentId).toBe('pi_return_1');
    expect(params.redirectStatus).toBe('succeeded');
    expect(params.clientSecret).toContain('secret');
  });

  it('ignores Stripe returns without ep_method=us-bank-account', () => {
    expect(
      isAchReturnAttempt(
        '?payment_intent=pi_x&payment_intent_client_secret=pi_x_secret_y&redirect_status=succeeded',
      ),
    ).toBeFalse();
  });

  it('clears ACH return params from the URL', () => {
    const path =
      `${window.location.pathname}?ep_method=us-bank-account&payment_intent=pi_1&payment_intent_client_secret=pi_1_secret_a&redirect_status=succeeded&keep=1`;
    window.history.replaceState({}, '', path);
    clearAchReturnParamsFromUrl();
    const next = new URL(window.location.href);
    expect(next.searchParams.get('ep_method')).toBeNull();
    expect(next.searchParams.get('payment_intent')).toBeNull();
    expect(next.searchParams.get('payment_intent_client_secret')).toBeNull();
    expect(next.searchParams.get('redirect_status')).toBeNull();
    expect(next.searchParams.get('keep')).toBe('1');
  });
});
