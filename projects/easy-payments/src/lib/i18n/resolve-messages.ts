import type { EasyPaymentsResolvedLocale } from './locale.types';
import { EN_TRANSLATIONS } from './en';
import { ES_TRANSLATIONS } from './es';
import { FR_TRANSLATIONS } from './fr';
import { PT_TRANSLATIONS } from './pt';
import type {
  EasyPaymentsTranslationOverrides,
  EasyPaymentsTranslations,
} from './translations.types';

const DICTIONARIES: Record<EasyPaymentsResolvedLocale, EasyPaymentsTranslations> = {
  en: EN_TRANSLATIONS,
  es: ES_TRANSLATIONS,
  pt: PT_TRANSLATIONS,
  fr: FR_TRANSLATIONS,
};

export function getDictionary(locale: EasyPaymentsResolvedLocale): EasyPaymentsTranslations {
  return DICTIONARIES[locale] ?? EN_TRANSLATIONS;
}

/**
 * Priority: custom override → locale dictionary → English.
 */
export function resolveMessages(
  locale: EasyPaymentsResolvedLocale,
  overrides: EasyPaymentsTranslationOverrides = {},
): EasyPaymentsTranslations {
  const base = getDictionary(locale);
  const english = EN_TRANSLATIONS;
  const merged: EasyPaymentsTranslations = { ...english, ...base };

  for (const key of Object.keys(overrides) as (keyof EasyPaymentsTranslations)[]) {
    const value = overrides[key];
    if (typeof value === 'string' && value.trim()) {
      merged[key] = value;
    }
  }

  return merged;
}
