import { resolveMessages } from './resolve-messages';
import { EN_TRANSLATIONS } from './en';
import { ES_TRANSLATIONS } from './es';
import { FR_TRANSLATIONS } from './fr';
import { PT_TRANSLATIONS } from './pt';
import { EASY_PAYMENTS_SUPPORTED_LOCALES } from './locale.types';
import { interpolate, type EasyPaymentsTranslationKey } from './translations.types';
import {
  toAffirmPreferredLocale,
  toGooglePayButtonLocale,
  toKlarnaPreferredLocale,
  toPayPalSdkLocale,
  toStripeBnplLocale,
  toStripeElementsLocale,
} from './provider-locale';
import { formatMoney } from '../utils/format-money';

const EN_KEYS = Object.keys(EN_TRANSLATIONS) as EasyPaymentsTranslationKey[];

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

  it('returns French dictionary for fr', () => {
    expect(resolveMessages('fr').successTitle).toBe(FR_TRANSLATIONS.successTitle);
    expect(resolveMessages('fr').payWithCard).toBe(FR_TRANSLATIONS.payWithCard);
    expect(resolveMessages('fr').checkoutTitle).toBe(FR_TRANSLATIONS.checkoutTitle);
    expect(resolveMessages('fr').checkoutSubtitle).toBe(FR_TRANSLATIONS.checkoutSubtitle);
  });

  it('covers every English key for all supported locales', () => {
    for (const locale of EASY_PAYMENTS_SUPPORTED_LOCALES) {
      const messages = resolveMessages(locale);
      for (const key of EN_KEYS) {
        expect(messages[key]?.trim().length).toBeGreaterThan(0);
      }
    }
    expect(Object.keys(FR_TRANSLATIONS).sort()).toEqual(Object.keys(EN_TRANSLATIONS).sort());
  });

  it('includes checkout heading keys for all supported locales', () => {
    for (const locale of EASY_PAYMENTS_SUPPORTED_LOCALES) {
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
    expect(resolveMessages('fr').pendingTitle).toBe('Paiement envoyé');
    expect(resolveMessages('fr').pendingBody).toBe(
      'Votre paiement est en cours de traitement. Vous n’avez pas besoin de payer à nouveau.',
    );
    for (const locale of EASY_PAYMENTS_SUPPORTED_LOCALES) {
      const body = resolveMessages(locale).pendingBody.toLowerCase();
      expect(body).not.toContain('stripe');
      expect(body).not.toContain('webhook');
      expect(body).not.toContain('backend');
    }
  });

  it('preserves interpolation tokens in French templates', () => {
    expect(FR_TRANSLATIONS.payAmount).toContain('{{amount}}');
    expect(FR_TRANSLATIONS.payWithMethod).toContain('{{method}}');
    expect(FR_TRANSLATIONS.payAmountWithMethodAria).toContain('{{amount}}');
    expect(FR_TRANSLATIONS.payAmountWithMethodAria).toContain('{{method}}');
    expect(FR_TRANSLATIONS.continueToMethod).toContain('{{method}}');
    expect(FR_TRANSLATIONS.demoWalletButtonAria).toContain('{{method}}');
    expect(FR_TRANSLATIONS.totalAmount).toContain('{{amount}}');
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

  it('falls back through French overrides to French then English', () => {
    const messages = resolveMessages('fr', {
      successTitle: 'Commande confirmée !',
    });
    expect(messages.successTitle).toBe('Commande confirmée !');
    expect(messages.errorTryAgain).toBe(FR_TRANSLATIONS.errorTryAgain);
    expect(messages.methodVenmo).toBe('Venmo');
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

  it('interpolates French templates', () => {
    expect(
      interpolate(FR_TRANSLATIONS.payAmountWithMethodAria, {
        amount: '10,00 $US',
        method: 'Carte',
      }),
    ).toBe('Payer 10,00 $US avec Carte');
  });
});

describe('provider-locale mappers', () => {
  it('maps Stripe Elements locales', () => {
    expect(toStripeElementsLocale('en')).toBe('en');
    expect(toStripeElementsLocale('es')).toBe('es');
    expect(toStripeElementsLocale('pt')).toBe('pt-BR');
    expect(toStripeElementsLocale('fr')).toBe('fr');
  });

  it('maps PayPal SDK locales', () => {
    expect(toPayPalSdkLocale('en')).toBe('en_US');
    expect(toPayPalSdkLocale('es')).toBe('es_ES');
    expect(toPayPalSdkLocale('pt')).toBe('pt_BR');
    expect(toPayPalSdkLocale('fr')).toBe('fr_FR');
  });

  it('maps BNPL locale hints', () => {
    expect(toStripeBnplLocale('en')).toBe('en-US');
    expect(toStripeBnplLocale('es')).toBe('es-ES');
    expect(toStripeBnplLocale('pt')).toBe('pt-BR');
    expect(toStripeBnplLocale('fr')).toBe('fr-FR');
  });

  it('maps Google Pay buttonLocale values', () => {
    expect(toGooglePayButtonLocale('en')).toBe('en');
    expect(toGooglePayButtonLocale('es')).toBe('es');
    expect(toGooglePayButtonLocale('pt')).toBe('pt');
    expect(toGooglePayButtonLocale('fr')).toBe('fr');
  });

  it('maps Klarna preferred_locale using purchase country', () => {
    expect(toKlarnaPreferredLocale('en', 'US')).toBe('en-US');
    expect(toKlarnaPreferredLocale('es', 'US')).toBe('es-US');
    expect(toKlarnaPreferredLocale('pt', 'US')).toBe('en-US');
    expect(toKlarnaPreferredLocale('pt', 'BR')).toBe('pt-BR');
    expect(toKlarnaPreferredLocale('es', 'ES')).toBe('es-ES');
    expect(toKlarnaPreferredLocale('fr', 'FR')).toBe('fr-FR');
    expect(toKlarnaPreferredLocale('fr', 'CA')).toBe('fr-CA');
    expect(toKlarnaPreferredLocale('fr', 'US')).toBe('en-US');
  });

  it('maps Affirm preferred_locale to officially supported Affirm page languages', () => {
    expect(toAffirmPreferredLocale('en', 'US')).toBe('en_US');
    expect(toAffirmPreferredLocale('es', 'US')).toBe('en_US');
    expect(toAffirmPreferredLocale('pt', 'US')).toBe('en_US');
    expect(toAffirmPreferredLocale('fr', 'US')).toBe('en_US');
    expect(toAffirmPreferredLocale('en', 'CA')).toBe('en_CA');
    expect(toAffirmPreferredLocale('fr', 'CA')).toBe('fr_CA');
  });
});

describe('formatMoney locale formatting', () => {
  it('keeps currency code while changing formatting locale', () => {
    const en = formatMoney(99, 'USD', 1, 'en');
    const es = formatMoney(99, 'USD', 1, 'es');
    const fr = formatMoney(99, 'USD', 1, 'fr');
    expect(en).toContain('99');
    expect(es).toContain('99');
    expect(fr).toContain('99');
    // Amount/currency stay USD — locale only changes presentation.
    expect(en.toUpperCase()).toMatch(/USD|\$/);
    expect(es.toUpperCase()).toMatch(/USD|\$|US\$/);
    expect(fr.toUpperCase()).toMatch(/USD|\$|US\$/);
  });
});
