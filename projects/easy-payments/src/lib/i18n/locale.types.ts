/**
 * Public locale API for Easy Payments.
 * `auto` resolves from the browser when available; otherwise English.
 */
export type EasyPaymentsLocale = 'auto' | 'en' | 'es' | 'pt' | 'fr';

/** Resolved dictionary locale (never `auto`). */
export type EasyPaymentsResolvedLocale = 'en' | 'es' | 'pt' | 'fr';

export const EASY_PAYMENTS_SUPPORTED_LOCALES: readonly EasyPaymentsResolvedLocale[] = [
  'en',
  'es',
  'pt',
  'fr',
] as const;

export const EASY_PAYMENTS_DEFAULT_LOCALE: EasyPaymentsLocale = 'auto';
