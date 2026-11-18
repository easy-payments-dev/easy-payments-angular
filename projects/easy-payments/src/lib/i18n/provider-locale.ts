import type { EasyPaymentsResolvedLocale } from './locale.types';

/**
 * Stripe.js Elements `locale` option.
 * @see https://docs.stripe.com/js/appendix/supported_locales
 */
export function toStripeElementsLocale(locale: EasyPaymentsResolvedLocale): string {
  switch (locale) {
    case 'es':
      return 'es';
    case 'pt':
      return 'pt-BR';
    case 'fr':
      return 'fr';
    case 'en':
    default:
      return 'en';
  }
}

/**
 * PayPal JS SDK `locale` query parameter (underscore form).
 * @see https://developer.paypal.com/sdk/js/configuration/#locale
 */
export function toPayPalSdkLocale(locale: EasyPaymentsResolvedLocale): string {
  switch (locale) {
    case 'es':
      return 'es_ES';
    case 'pt':
      return 'pt_BR';
    case 'fr':
      return 'fr_FR';
    case 'en':
    default:
      return 'en_US';
  }
}

/**
 * Google Pay Web `ButtonOptions.buttonLocale` (ISO 639-1).
 * Controls official button text only — not the Google-hosted payment sheet.
 * @see https://developers.google.com/pay/api/web/reference/request-objects#ButtonOptions
 */
export function toGooglePayButtonLocale(locale: EasyPaymentsResolvedLocale): string {
  switch (locale) {
    case 'es':
      return 'es';
    case 'pt':
      return 'pt';
    case 'fr':
      return 'fr';
    case 'en':
    default:
      return 'en';
  }
}

/**
 * BCP-47 style language-region tags used as Stripe BNPL locale hints
 * (e.g. documentation / Affirm preferred_locale when underscore form is derived).
 */
export function toStripeBnplLocale(locale: EasyPaymentsResolvedLocale): string {
  switch (locale) {
    case 'es':
      return 'es-ES';
    case 'pt':
      return 'pt-BR';
    case 'fr':
      return 'fr-FR';
    case 'en':
    default:
      return 'en-US';
  }
}

/** Klarna purchase countries where French is a documented preferred language. */
const KLARNA_FRENCH_COUNTRIES = new Set(['FR', 'BE', 'CA', 'CH', 'LU']);

/**
 * Stripe Klarna `payment_method_options.klarna.preferred_locale`.
 * Must be a language-country pair Stripe accepts for the purchase/billing country.
 * Invalid combinations are ignored by Stripe (country default language wins).
 * @see https://docs.stripe.com/payments/klarna/accept-a-payment
 */
export function toKlarnaPreferredLocale(
  locale: EasyPaymentsResolvedLocale,
  purchaseCountry = 'US',
): string {
  const country = purchaseCountry.trim().toUpperCase() || 'US';
  if (locale === 'es') {
    return `es-${country}`;
  }
  if (locale === 'pt') {
    if (country === 'BR' || country === 'PT') {
      return `pt-${country}`;
    }
    // Portuguese is not a standard Klarna locale for most other countries (e.g. US).
    return `en-${country}`;
  }
  if (locale === 'fr') {
    if (KLARNA_FRENCH_COUNTRIES.has(country)) {
      return `fr-${country}`;
    }
    return `en-${country}`;
  }
  return `en-${country}`;
}

/**
 * Stripe Affirm `payment_method_options.affirm.preferred_locale`.
 * Affirm’s documented US/CA page languages are limited (typically `en_US` / `en_CA` / `fr_CA`).
 * Easy Payments does not invent unsupported Affirm locales for `es` / `pt`.
 * French maps to `fr_CA` only for Canada; US stays `en_US`.
 * @see https://docs.stripe.com/api/payment_intents/create#create_payment_intent-payment_method_options-affirm-preferred_locale
 */
export function toAffirmPreferredLocale(
  locale: EasyPaymentsResolvedLocale,
  purchaseCountry = 'US',
): string {
  const country = purchaseCountry.trim().toUpperCase() || 'US';
  if (country === 'CA') {
    return locale === 'fr' ? 'fr_CA' : 'en_CA';
  }
  void locale;
  return 'en_US';
}
