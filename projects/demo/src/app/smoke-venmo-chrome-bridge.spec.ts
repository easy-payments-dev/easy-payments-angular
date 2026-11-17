import {
  buildSmokeVenmoAndroidIntentUrl,
  buildSmokeVenmoAppLinkReturn,
  buildSmokeVenmoReturnLinks,
  parseSmokeVenmoChromeBridge,
  SMOKE_VENMO_ANDROID_PACKAGE,
} from './smoke-venmo-chrome-bridge';

describe('smoke-venmo-chrome-bridge', () => {
  it('parses opt-in smoke query params only', () => {
    expect(parseSmokeVenmoChromeBridge('')).toBeNull();
    expect(
      parseSmokeVenmoChromeBridge(
        '?ep_smoke_venmo=1&ep_smoke_attempt=abcdefghijklmnop&ep_smoke_return=https://www.easy-payments.dev/capacitor-return',
      ),
    ).toEqual({
      attemptId: 'abcdefghijklmnop',
      returnUrl: 'https://www.easy-payments.dev/capacitor-return',
      orderId: null,
      productName: null,
      amount: null,
      currency: null,
    });
    expect(
      parseSmokeVenmoChromeBridge(
        '?ep_smoke_venmo=1&ep_smoke_attempt=short&ep_smoke_return=https://www.easy-payments.dev/capacitor-return',
      ),
    ).toBeNull();
  });

  it('builds HTTPS App Link and Android Intent (not a same-tab web navigation target)', () => {
    const links = buildSmokeVenmoReturnLinks({
      returnUrl: 'https://www.easy-payments.dev/capacitor-return',
      attemptId: 'abcdefghijklmnop',
      result: 'approved',
      orderId: '5O190127TN364715T',
    });
    expect(links).toBeTruthy();
    expect(links!.httpsAppLink).toContain('ep_method=venmo');
    expect(links!.httpsAppLink).toContain('ep_result=approved');
    expect(links!.httpsAppLink).toContain('ep_paypal_order=5O190127TN364715T');
    expect(links!.destinationHost).toBe('www.easy-payments.dev');
    expect(links!.destinationPath).toBe('/capacitor-return');
    expect(links!.androidIntentUrl).toContain('intent://www.easy-payments.dev/capacitor-return');
    expect(links!.androidIntentUrl).toContain(`package=${SMOKE_VENMO_ANDROID_PACKAGE}`);
    expect(links!.androidIntentUrl).toContain('scheme=https');

    const cancelled = buildSmokeVenmoAppLinkReturn({
      returnUrl: 'https://www.easy-payments.dev/capacitor-return',
      attemptId: 'abcdefghijklmnop',
      result: 'cancelled',
    });
    expect(cancelled).toContain('ep_result=cancelled');
    expect(cancelled).not.toContain('ep_paypal_order');
  });

  it('rejects non-https intent conversion', () => {
    expect(buildSmokeVenmoAndroidIntentUrl('http://example.com/x')).toBeNull();
  });
});
