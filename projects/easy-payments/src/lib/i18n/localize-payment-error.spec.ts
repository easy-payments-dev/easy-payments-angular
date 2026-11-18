import { localizePaymentError } from './localize-payment-error';
import { EN_TRANSLATIONS } from './en';
import { ES_TRANSLATIONS } from './es';
import { FR_TRANSLATIONS } from './fr';
import { PT_TRANSLATIONS } from './pt';

describe('localizePaymentError', () => {
  it('never returns English diagnostics for Spanish locale codes', () => {
    expect(localizePaymentError('PAYMENT_FAILED', ES_TRANSLATIONS)).toBe(ES_TRANSLATIONS.errorBody);
    expect(localizePaymentError('CARD_DECLINED', ES_TRANSLATIONS)).toBe(
      ES_TRANSLATIONS.errorDetailCardDeclined,
    );
    expect(localizePaymentError('BACKEND_ERROR', ES_TRANSLATIONS)).toBe(
      ES_TRANSLATIONS.errorDetailBackend,
    );
    expect(localizePaymentError('PAYMENT_FAILED', ES_TRANSLATIONS)).not.toContain('Klarna');
  });

  it('localizes known codes for Portuguese', () => {
    expect(localizePaymentError('NETWORK_ERROR', PT_TRANSLATIONS)).toBe(
      PT_TRANSLATIONS.errorDetailNetwork,
    );
    expect(localizePaymentError('SDK_LOAD_FAILED', PT_TRANSLATIONS)).toBe(
      PT_TRANSLATIONS.errorDetailSdkLoad,
    );
  });

  it('uses Zip-specific unavailable copy for CONFIG_MISSING / CONFIG_INVALID', () => {
    expect(
      localizePaymentError('CONFIG_MISSING', PT_TRANSLATIONS, { method: 'zip' }),
    ).toBe(PT_TRANSLATIONS.zipUnavailable);
    expect(
      localizePaymentError('CONFIG_INVALID', FR_TRANSLATIONS, { method: 'zip' }),
    ).toBe(FR_TRANSLATIONS.zipUnavailable);
    expect(localizePaymentError('CONFIG_MISSING', EN_TRANSLATIONS, { method: 'zip' })).not.toBe(
      EN_TRANSLATIONS.errorDetailConfig,
    );
    expect(localizePaymentError('CONFIG_MISSING', EN_TRANSLATIONS)).toBe(
      EN_TRANSLATIONS.errorDetailConfig,
    );
  });

  it('falls back to errorBody for unknown / generic failures in English', () => {
    expect(localizePaymentError('UNKNOWN', EN_TRANSLATIONS)).toBe(EN_TRANSLATIONS.errorBody);
    expect(localizePaymentError(undefined, EN_TRANSLATIONS)).toBe(EN_TRANSLATIONS.errorBody);
  });
});
