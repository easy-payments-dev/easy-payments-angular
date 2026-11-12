import { PaymentMethod, PAYMENT_METHOD_LABELS } from '../models';
import type { ResolvedPaymentTheme } from '../models';
import { APPLE_PAY_MARK_DATA_URI, GOOGLE_PAY_MARK_DATA_URI } from './official-mark-data';

/**
 * Internal presentation metadata for payment-method selector tiles.
 * Not part of the public npm API.
 */
export type PaymentMarkSource =
  | 'official-bundled'
  | 'official-cdn'
  | 'generic'
  | 'text-fallback';

export interface PaymentMethodPresentation {
  method: PaymentMethod;
  /** Accessible name (always set). */
  label: string;
  /**
   * When true, the mark already communicates the brand name,
   * so a visible duplicate label under the mark is omitted.
   */
  markIncludesName: boolean;
  source: PaymentMarkSource;
  /**
   * Official mark URL or data URI for the active theme.
   * Null when only a text/generic fallback is used.
   */
  markUrl: string | null;
  /** Human-readable note for maintainers / README. */
  notes: string;
}

/** Official Klarna checkout badge (documented by Klarna for merchant checkout). */
const KLARNA_BADGE =
  'https://x.klarnacdn.net/payment-method/assets/badges/generic/klarna.svg';

/** PayPal primary full-color wordmark hosted on paypalobjects.com (transparent). */
const PAYPAL_MARK =
  'https://www.paypalobjects.com/digitalassets/c/website/logo/full-text/pp_fc_hl.svg';

/** Affirm black logo (transparent) for light surfaces — Affirm CDN. */
const AFFIRM_MARK_LIGHT =
  'https://cdn-assets.affirm.com/images/black_logo-transparent_bg.svg';

/** Affirm white logo (transparent PNG) for dark surfaces — Affirm CDN. */
const AFFIRM_MARK_DARK =
  'https://cdn-assets.affirm.com/images/white_logo-transparent_bg.png';

/**
 * Build presentation for a payment method + theme.
 * Uses only provider-approved assets or intentional fallbacks.
 */
export function getPaymentMethodPresentation(
  method: PaymentMethod,
  theme: ResolvedPaymentTheme = 'light',
): PaymentMethodPresentation {
  const label = PAYMENT_METHOD_LABELS[method];
  const dark = theme === 'dark';

  switch (method) {
    case 'card':
      return {
        method,
        label,
        markIncludesName: false,
        source: 'generic',
        markUrl: null,
        notes: 'Generic neutral card icon (not a card-network brand).',
      };

    case 'apple-pay':
      return {
        method,
        label,
        markIncludesName: true,
        source: 'official-bundled',
        markUrl: APPLE_PAY_MARK_DATA_URI,
        notes:
          'Official Apple Pay mark from Apple’s Apple-Pay-Mark.zip (developer.apple.com/apple-pay/marketing/).',
      };

    case 'google-pay':
      return {
        method,
        label,
        markIncludesName: true,
        source: 'official-bundled',
        markUrl: GOOGLE_PAY_MARK_DATA_URI,
        notes:
          'Official Google Pay mark from Google-Pay-Acceptance.zip (developers.google.com brand guidelines).',
      };

    case 'paypal':
      return {
        method,
        label,
        markIncludesName: true,
        source: 'official-cdn',
        // Full-color transparent SVG works on light and dark tiles without a white plate.
        markUrl: PAYPAL_MARK,
        notes: 'PayPal-hosted logo assets on paypalobjects.com.',
      };

    case 'klarna':
      return {
        method,
        label,
        markIncludesName: true,
        source: 'official-cdn',
        markUrl: KLARNA_BADGE,
        notes:
          'Official Klarna badge from Klarna CDN (payment_method_categories / checkout styling docs).',
      };

    case 'affirm':
      return {
        method,
        label,
        markIncludesName: true,
        source: 'official-cdn',
        markUrl: dark ? AFFIRM_MARK_DARK : AFFIRM_MARK_LIGHT,
        notes:
          'Affirm-hosted logo assets (cdn-assets.affirm.com). Merchant toolkit recommends Affirm-hosted assets.',
      };

    case 'us-bank-account':
      return {
        method,
        label,
        markIncludesName: false,
        source: 'generic',
        markUrl: null,
        notes:
          'Generic bank-building icon via currentColor (decorative; tile keeps a visible label). No official ACH mark in this release.',
      };

    default: {
      const _exhaustive: never = method;
      return _exhaustive;
    }
  }
}

export function listPaymentMethodPresentations(
  theme: ResolvedPaymentTheme = 'light',
): PaymentMethodPresentation[] {
  const methods: PaymentMethod[] = [
    'card',
    'apple-pay',
    'google-pay',
    'paypal',
    'klarna',
    'affirm',
    'us-bank-account',
  ];
  return methods.map((method) => getPaymentMethodPresentation(method, theme));
}
