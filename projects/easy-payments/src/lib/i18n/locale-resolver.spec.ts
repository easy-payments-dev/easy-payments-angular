import {
  detectBrowserLocale,
  normalizeLanguageTag,
  resolveEffectiveLocale,
} from './locale-resolver';

describe('locale-resolver', () => {
  describe('normalizeLanguageTag', () => {
    it('maps Spanish regional tags to es', () => {
      expect(normalizeLanguageTag('es-ES')).toBe('es');
      expect(normalizeLanguageTag('es-MX')).toBe('es');
      expect(normalizeLanguageTag('es-US')).toBe('es');
      expect(normalizeLanguageTag('es_AR')).toBe('es');
    });

    it('maps Portuguese regional tags to pt', () => {
      expect(normalizeLanguageTag('pt-BR')).toBe('pt');
      expect(normalizeLanguageTag('pt-PT')).toBe('pt');
    });

    it('maps French regional tags to fr', () => {
      expect(normalizeLanguageTag('fr-FR')).toBe('fr');
      expect(normalizeLanguageTag('fr-CA')).toBe('fr');
      expect(normalizeLanguageTag('fr-BE')).toBe('fr');
      expect(normalizeLanguageTag('fr_CH')).toBe('fr');
    });

    it('maps English regional tags to en', () => {
      expect(normalizeLanguageTag('en-US')).toBe('en');
      expect(normalizeLanguageTag('en-GB')).toBe('en');
      expect(normalizeLanguageTag('en-CA')).toBe('en');
    });

    it('falls back to English for unsupported languages', () => {
      expect(normalizeLanguageTag('de-DE')).toBe('en');
      expect(normalizeLanguageTag('zh-CN')).toBe('en');
      expect(normalizeLanguageTag('ja-JP')).toBe('en');
      expect(normalizeLanguageTag('ko-KR')).toBe('en');
      expect(normalizeLanguageTag('it-IT')).toBe('en');
    });

    it('falls back to English for empty or invalid values', () => {
      expect(normalizeLanguageTag(null)).toBe('en');
      expect(normalizeLanguageTag(undefined)).toBe('en');
      expect(normalizeLanguageTag('')).toBe('en');
      expect(normalizeLanguageTag('   ')).toBe('en');
    });
  });

  describe('detectBrowserLocale', () => {
    it('prefers navigator.languages over language', () => {
      expect(detectBrowserLocale(['es-MX', 'en-US'], 'de-DE')).toBe('es');
    });

    it('uses language when languages is empty', () => {
      expect(detectBrowserLocale([], 'pt-BR')).toBe('pt');
      expect(detectBrowserLocale([], 'fr-CA')).toBe('fr');
    });

    it('returns English when no navigator data is available', () => {
      expect(detectBrowserLocale([], null)).toBe('en');
      expect(detectBrowserLocale(null, null)).toBe('en');
    });
  });

  describe('resolveEffectiveLocale', () => {
    it('resolves explicit locales', () => {
      expect(resolveEffectiveLocale('en')).toBe('en');
      expect(resolveEffectiveLocale('es')).toBe('es');
      expect(resolveEffectiveLocale('pt')).toBe('pt');
      expect(resolveEffectiveLocale('fr')).toBe('fr');
    });

    it('resolves auto from provided browser languages', () => {
      expect(resolveEffectiveLocale('auto', { languages: ['de-DE'] })).toBe('en');
      expect(resolveEffectiveLocale('auto', { languages: ['es-ES'] })).toBe('es');
      expect(resolveEffectiveLocale('auto', { language: 'pt-BR' })).toBe('pt');
      expect(resolveEffectiveLocale('auto', { languages: ['fr-FR'] })).toBe('fr');
    });

    it('falls back to English for unexpected requested values', () => {
      expect(resolveEffectiveLocale('de' as never)).toBe('en');
      expect(resolveEffectiveLocale('')).toBe('en');
      expect(resolveEffectiveLocale(null)).toBe('en');
    });
  });
});
