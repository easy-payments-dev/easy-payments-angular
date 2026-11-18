import type { EasyPaymentsLocale, EasyPaymentsResolvedLocale } from './locale.types';

/**
 * Normalize a BCP 47 / browser language tag to a supported Easy Payments locale.
 * Unsupported languages resolve to English.
 */
export function normalizeLanguageTag(tag: string | null | undefined): EasyPaymentsResolvedLocale {
  if (!tag || typeof tag !== 'string') {
    return 'en';
  }

  const normalized = tag.trim().toLowerCase().replace(/_/g, '-');
  if (!normalized) {
    return 'en';
  }

  const base = normalized.split('-')[0] ?? '';
  if (base === 'es') {
    return 'es';
  }
  if (base === 'pt') {
    return 'pt';
  }
  if (base === 'fr') {
    return 'fr';
  }
  if (base === 'en') {
    return 'en';
  }
  return 'en';
}

/**
 * SSR-safe browser language detection.
 * Never touches navigator during evaluation unless it exists.
 */
export function detectBrowserLocale(
  languages?: readonly string[] | null,
  language?: string | null,
): EasyPaymentsResolvedLocale {
  const list =
    languages && languages.length > 0
      ? languages
      : language
        ? [language]
        : readNavigatorLanguages();

  for (const tag of list) {
    const resolved = normalizeLanguageTag(tag);
    // First tag wins after normalization (unsupported -> en still "wins" as English).
    if (tag && typeof tag === 'string' && tag.trim()) {
      return resolved;
    }
  }

  return 'en';
}

function readNavigatorLanguages(): readonly string[] {
  try {
    const nav = typeof navigator !== 'undefined' ? navigator : undefined;
    if (!nav) {
      return [];
    }
    if (Array.isArray(nav.languages) && nav.languages.length > 0) {
      return nav.languages;
    }
    if (typeof nav.language === 'string' && nav.language.trim()) {
      return [nav.language];
    }
  } catch {
    // Ignore — SSR / restricted environments.
  }
  return [];
}

/**
 * Resolve the effective dictionary locale from a requested locale input.
 */
export function resolveEffectiveLocale(
  requested: EasyPaymentsLocale | string | null | undefined,
  options?: {
    languages?: readonly string[] | null;
    language?: string | null;
  },
): EasyPaymentsResolvedLocale {
  if (requested == null || requested === '' || requested === 'auto') {
    return detectBrowserLocale(options?.languages, options?.language);
  }

  if (
    requested === 'en' ||
    requested === 'es' ||
    requested === 'pt' ||
    requested === 'fr'
  ) {
    return requested;
  }

  // Unexpected values (including regional tags passed by mistake) normalize safely.
  return normalizeLanguageTag(String(requested));
}
