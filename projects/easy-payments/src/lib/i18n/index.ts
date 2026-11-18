export type { EasyPaymentsLocale, EasyPaymentsResolvedLocale } from './locale.types';
export {
  EASY_PAYMENTS_DEFAULT_LOCALE,
  EASY_PAYMENTS_SUPPORTED_LOCALES,
} from './locale.types';
export {
  detectBrowserLocale,
  normalizeLanguageTag,
  resolveEffectiveLocale,
} from './locale-resolver';
export type {
  EasyPaymentsTranslationKey,
  EasyPaymentsTranslationOverrides,
  EasyPaymentsTranslations,
} from './translations.types';
export { interpolate } from './translations.types';
export { getDictionary, resolveMessages } from './resolve-messages';
export {
  toAffirmPreferredLocale,
  toGooglePayButtonLocale,
  toKlarnaPreferredLocale,
  toPayPalSdkLocale,
  toStripeBnplLocale,
  toStripeElementsLocale,
} from './provider-locale';
export { localizePaymentError } from './localize-payment-error';
export { EasyPaymentsI18nService } from './easy-payments-i18n.service';
export { EN_TRANSLATIONS } from './en';
export { ES_TRANSLATIONS } from './es';
export { FR_TRANSLATIONS } from './fr';
export { PT_TRANSLATIONS } from './pt';
