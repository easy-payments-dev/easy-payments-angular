import {
  getPaymentMethodPresentation,
  listPaymentMethodPresentations,
} from './payment-method-presentation';
import { APPLE_PAY_MARK_DATA_URI, GOOGLE_PAY_MARK_DATA_URI } from './official-mark-data';

describe('payment method presentation', () => {
  it('uses a generic card icon (not a network brand)', () => {
    const card = getPaymentMethodPresentation('card', 'light');
    expect(card.source).toBe('generic');
    expect(card.markUrl).toBeNull();
    expect(card.markIncludesName).toBeFalse();
    expect(card.label).toBe('Card');
  });

  it('uses the official bundled Apple Pay mark', () => {
    const apple = getPaymentMethodPresentation('apple-pay', 'light');
    expect(apple.source).toBe('official-bundled');
    expect(apple.markUrl).toBe(APPLE_PAY_MARK_DATA_URI);
    expect(apple.markIncludesName).toBeTrue();
    expect(apple.markUrl?.startsWith('data:image/svg+xml')).toBeTrue();
  });

  it('uses the official bundled Google Pay mark', () => {
    const google = getPaymentMethodPresentation('google-pay', 'dark');
    expect(google.source).toBe('official-bundled');
    expect(google.markUrl).toBe(GOOGLE_PAY_MARK_DATA_URI);
  });

  it('uses PayPal CDN assets on light and dark', () => {
    const light = getPaymentMethodPresentation('paypal', 'light');
    const dark = getPaymentMethodPresentation('paypal', 'dark');
    expect(light.source).toBe('official-cdn');
    expect(light.markUrl).toContain('paypalobjects.com');
    expect(dark.markUrl).toBe(light.markUrl);
  });

  it('uses the official Klarna CDN badge', () => {
    const klarna = getPaymentMethodPresentation('klarna', 'light');
    expect(klarna.source).toBe('official-cdn');
    expect(klarna.markUrl).toContain('klarnacdn.net');
    expect(klarna.markIncludesName).toBeTrue();
  });

  it('uses Affirm CDN assets with a dark variant', () => {
    const light = getPaymentMethodPresentation('affirm', 'light');
    const dark = getPaymentMethodPresentation('affirm', 'dark');
    expect(light.markUrl).toContain('cdn-assets.affirm.com');
    expect(dark.markUrl).toContain('cdn-assets.affirm.com');
    expect(dark.markUrl).not.toBe(light.markUrl);
  });

  it('uses a generic bank-building icon for US bank account (not a card mark)', () => {
    const ach = getPaymentMethodPresentation('us-bank-account', 'light');
    const achDark = getPaymentMethodPresentation('us-bank-account', 'dark');
    expect(ach.source).toBe('generic');
    expect(ach.markUrl).toBeNull();
    expect(ach.markIncludesName).toBeFalse();
    expect(ach.label).toBe('US bank account');
    expect(achDark.source).toBe('generic');
    expect(achDark.markUrl).toBeNull();
  });

  it('uses the official Cash App Pay rounded green badge on light and dark', () => {
    const light = getPaymentMethodPresentation('cash-app-pay', 'light');
    const dark = getPaymentMethodPresentation('cash-app-pay', 'dark');
    expect(light.source).toBe('official-cdn');
    // Badge is the $ plate only — visible "Cash App Pay" label stays beside it.
    expect(light.markIncludesName).toBeFalse();
    expect(light.label).toBe('Cash App Pay');
    expect(light.markUrl).toContain('static.afterpaycdn.com');
    expect(light.markUrl).toContain('icon/color.svg');
    // Partner Assets publish the same green embed for “Green” and “Green On Dark”.
    expect(dark.markUrl).toBe(light.markUrl);
  });

  it('uses official Afterpay lockups with light/dark variants', () => {
    const light = getPaymentMethodPresentation('afterpay', 'light');
    const dark = getPaymentMethodPresentation('afterpay', 'dark');
    expect(light.source).toBe('official-cdn');
    expect(light.markIncludesName).toBeTrue();
    expect(light.label).toBe('Afterpay');
    expect(light.markUrl).toContain('lockup/new-color-black-32.svg');
    expect(dark.markUrl).toContain('lockup/new-color-white-32.svg');
    expect(dark.markUrl).not.toBe(light.markUrl);
  });

  it('uses official Afterpay lockups with light/dark variants', () => {
    const light = getPaymentMethodPresentation('afterpay', 'light');
    const dark = getPaymentMethodPresentation('afterpay', 'dark');
    expect(light.source).toBe('official-cdn');
    expect(light.markIncludesName).toBeTrue();
    expect(light.label).toBe('Afterpay');
    expect(light.markUrl).toContain('lockup/new-color-black-32.svg');
    expect(dark.markUrl).toContain('lockup/new-color-white-32.svg');
    expect(dark.markUrl).not.toBe(light.markUrl);
  });

  it('lists presentations for every supported method', () => {
    const list = listPaymentMethodPresentations('light');
    expect(list.map((entry) => entry.method)).toEqual([
      'card',
      'apple-pay',
      'google-pay',
      'paypal',
      'venmo',
      'klarna',
      'affirm',
      'us-bank-account',
      'cash-app-pay',
      'afterpay',
      'zip',
    ]);
  });

  it('uses official Zip wordmarks for light and dark themes', () => {
    const light = getPaymentMethodPresentation('zip', 'light');
    const dark = getPaymentMethodPresentation('zip', 'dark');
    expect(light.label).toBe('Zip');
    expect(dark.label).toBe('Zip');
    expect(light.source).toBe('official-cdn');
    expect(light.markIncludesName).toBeTrue();
    expect(light.markUrl).toContain('logos/zip/black.svg');
    expect(dark.markUrl).toContain('logos/zip/white.svg');
    expect(dark.markUrl).not.toBe(light.markUrl);
  });

  it('uses official Venmo wordmarks for light and dark themes', () => {
    const light = getPaymentMethodPresentation('venmo', 'light');
    const dark = getPaymentMethodPresentation('venmo', 'dark');
    expect(light.label).toBe('Venmo');
    expect(dark.label).toBe('Venmo');
    expect(light.source).toBe('official-cdn');
    expect(light.markIncludesName).toBeTrue();
    expect(light.markUrl).toContain('Venmo_Logo_Blue');
    expect(dark.markUrl).toContain('Venmo_Logo_White');
    expect(dark.markUrl).not.toBe(light.markUrl);
  });
});
