import { resolveMessages } from './resolve-messages';
import { EN_TRANSLATIONS } from './en';
import { ES_TRANSLATIONS } from './es';
import { PT_TRANSLATIONS } from './pt';
import { interpolate } from './translations.types';
import {
  toAffirmPreferredLocale,
  toGooglePayButtonLocale,
  toKlarnaPreferredLocale,
  toPayPalSdkLocale,
  toStripeBnplLocale,
  toStripeElementsLocale,
} from './provider-locale';
import { formatMoney } from '../utils/format-money';

describe('resolveMessages', () => {
  it('returns English dictionary for en', () => {
    expect(resolveMessages('en').successTitle).toBe(EN_TRANSLATIONS.successTitle);
  });

  it('returns Spanish dictionary for es', () => {
    expect(resolveMessages('es').successTitle).toBe(ES_TRANSLATIONS.successTitle);
    expect(resolveMessages('es').payWithCard).toBe(ES_TRANSLATIONS.payWithCard);
    expect(resolveMessages('es').checkoutTitle).toBe(ES_TRANSLATIONS.checkoutTitle);
    expect(resolveMessages('es').checkoutSubtitle).toBe(ES_TRANSLATIONS.checkoutSubtitle);
  });

  it('returns Portuguese dictionary for pt', () => {
    expect(resolveMessages('pt').successTitle).toBe(PT_TRANSLATIONS.successTitle);
    expect(resolveMessages('pt').checkoutTitle).toBe(PT_TRANSLATIONS.checkoutTitle);
    expect(resolveMessages('pt').checkoutSubtitle).toBe(PT_TRANSLATIONS.checkoutSubtitle);
  });

  it('includes checkout heading keys for all supported locales', () => {
    for (const locale of ['en', 'es', 'pt'] as const) {
      const messages = resolveMessages(locale);
      expect(messages.checkoutTitle.trim().length).toBeGreaterThan(0);
      expect(messages.checkoutSubtitle.trim().length).toBeGreaterThan(0);
      expect(messages.noPaymentMethodsAvailable.trim().length).toBeGreaterThan(0);
    }
  });

  it('keeps ACH pending copy customer-facing across locales (no Stripe/webhook jargon)', () => {
    expect(resolveMessages('en').pendingTitle).toBe('Payment submitted');
    expect(resolveMessages('en').pendingBody).toBe(
      "Your payment is being processed. You don't need to pay again.",
    );
    expect(resolveMessages('es').pendingTitle).toBe('Pago enviado');
    expect(resolveMessages('es').pendingBody).toBe(
      'Tu pago está en proceso. No necesitas volver a pagar.',
    );
    expect(resolveMessages('pt').pendingTitle).toBe('Pagamento enviado');
    expect(resolveMessages('pt').pendingBody).toBe(
      'Seu pagamento está sendo processado. Você não precisa pagar novamente.',
    );
    for (const locale of ['en', 'es', 'pt'] as const) {
      const body = resolveMessages(locale).pendingBody.toLowerCase();
      expect(body).not.toContain('stripe');
      expect(body).not.toContain('webhook');
      expect(body).not.toContain('backend');
    }
  });

  it('applies partial custom overrides with locale fallback for remaining keys', () => {
    const messages = resolveMessages('es', {
      successTitle: '¡Pedido confirmado!',
      successContinue: 'Seguir',
    });
    expect(messages.successTitle).toBe('¡Pedido confirmado!');
    expect(messages.successContinue).toBe('Seguir');
    expect(messages.errorTitle).toBe(ES_TRANSLATIONS.errorTitle);
  });

  it('ignores blank override values and keeps dictionary text', () => {
    const messages = resolveMessages('en', { successTitle: '   ' });
    expect(messages.successTitle).toBe(EN_TRANSLATIONS.successTitle);
  });
});

describe('interpolate', () => {
  it('replaces tokens', () => {
    expect(interpolate('Pay {{amount}} with {{method}}', { amount: '$10.00', method: 'Card' })).toBe(
      'Pay $10.00 with Card',
    );
  });
});

describe('provider-locale mappers', () => {
  it('maps Stripe Elements locales', () => {
    expect(toStripeElementsLocale('en')).toBe('en');
    expect(toStripeElementsLocale('es')).toBe('es');
    expect(toStripeElementsLocale('pt')).toBe('pt-BR');
  });

  it('maps PayPal SDK locales', () => {
    expect(toPayPalSdkLocale('en')).toBe('en_US');
    expect(toPayPalSdkLocale('es')).toBe('es_ES');
    expect(toPayPalSdkLocale('pt')).toBe('pt_BR');
  });

  it('maps BNPL locale hints', () => {
    expect(toStripeBnplLocale('en')).toBe('en-US');
    expect(toStripeBnplLocale('es')).toBe('es-ES');
    expect(toStripeBnplLocale('pt')).toBe('pt-BR');
  });

  it('maps Google Pay buttonLocale values', () => {
    expect(toGooglePayButtonLocale('en')).toBe('en');
    expect(toGooglePayButtonLocale('es')).toBe('es');
    expect(toGooglePayButtonLocale('pt')).toBe('pt');
  });

  it('maps Klarna preferred_locale using purchase country', () => {
    expect(toKlarnaPreferredLocale('en', 'US')).toBe('en-US');
    expect(toKlarnaPreferredLocale('es', 'US')).toBe('es-US');
    expect(toKlarnaPreferredLocale('pt', 'US')).toBe('en-US');
    expect(toKlarnaPreferredLocale('pt', 'BR')).toBe('pt-BR');
    expect(toKlarnaPreferredLocale('es', 'ES')).toBe('es-ES');
  });

  it('maps Affirm preferred_locale to officially supported Affirm page languages', () => {
    expect(toAffirmPreferredLocale('en', 'US')).toBe('en_US');
    expect(toAffirmPreferredLocale('es', 'US')).toBe('en_US');
    expect(toAffirmPreferredLocale('pt', 'US')).toBe('en_US');
    expect(toAffirmPreferredLocale('en', 'CA')).toBe('en_CA');
  });
});

describe('formatMoney locale formatting', () => {
  it('keeps currency code while changing formatting locale', () => {
    const en = formatMoney(99, 'USD', 1, 'en');
    const es = formatMoney(99, 'USD', 1, 'es');
    expect(en).toContain('99');
    expect(es).toContain('99');
    // Both remain USD — no conversion.
    expect(en.toUpperCase()).toMatch(/USD|\$/);
    expect(es.toUpperCase()).toMatch(/USD|\$|US\$/);
  });
});
