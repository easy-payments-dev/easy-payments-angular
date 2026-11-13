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
 * Official Cash App Pay rounded payment badge (green / color).
 * Partner Assets lists the same embed for “Green” and “Green On Dark”.
 * SVG includes native rx corners — do not add CSS border-radius.
 * @see https://developers.cash.app/cash-app-pay-partner-api/guides/resources/cash-app-pay-assets
 */
const CASH_APP_PAY_BADGE_COLOR =
  'https://static.afterpaycdn.com/en-US/integration/logo/icon/color.svg';

/** Official Afterpay lockup (includes wordmark) for light surfaces. */
const AFTERPAY_MARK_LIGHT =
  'https://static.afterpaycdn.com/en-US/integration/logo/lockup/new-color-black-32.svg';

/** Official Afterpay lockup (includes wordmark) for dark surfaces. */
const AFTERPAY_MARK_DARK =
  'https://static.afterpaycdn.com/en-US/integration/logo/lockup/new-color-white-32.svg';

/**
 * Official Venmo wordmark (blue) for light surfaces — PayPal Newsroom brand assets.
 * @see https://newsroom.paypal-corp.com/
 */
const VENMO_MARK_LIGHT = 'https://newsroom.paypal-corp.com/image/Venmo_Logo_Blue.png';

/**
 * Official Venmo wordmark (white) for dark surfaces — PayPal Newsroom brand assets.
 * @see https://newsroom.paypal-corp.com/
 */
const VENMO_MARK_DARK = 'https://newsroom.paypal-corp.com/image/Venmo_Logo_White.png';

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

    case 'cash-app-pay':
      return {
        method,
        label,
        // Rounded badge is the official $ plate (no wordmark); tile keeps "Cash App Pay".
        markIncludesName: false,
        source: 'official-cdn',
        markUrl: CASH_APP_PAY_BADGE_COLOR,
        notes:
          'Official Cash App Pay rounded green payment badge from Cash App Pay Partner Assets (static.afterpaycdn.com). Same icon/color.svg embed for light and dark (“Green” / “Green On Dark”). Badge is decorative beside the visible Cash App Pay label; native SVG rx provides rounded corners.',
      };

    case 'afterpay':
      return {
        method,
        label,
        markIncludesName: true,
        source: 'official-cdn',
        markUrl: dark ? AFTERPAY_MARK_DARK : AFTERPAY_MARK_LIGHT,
        notes:
          'Official Afterpay lockup from Afterpay brand assets (static.afterpaycdn.com). Black lockup on light themes, white on dark. UK Clearpay naming is shown by Stripe Payment Element; selector uses Afterpay lockup.',
      };

    case 'venmo':
      return {
        method,
        label,
        markIncludesName: true,
        source: 'official-cdn',
        markUrl: dark ? VENMO_MARK_DARK : VENMO_MARK_LIGHT,
        notes:
          'Official Venmo wordmark from PayPal Newsroom brand assets. Blue lockup on light themes, white on dark. Accessible name remains “Venmo.” Buttons Only uses the PayPal JS SDK Venmo funding button (logo-only Label in paypal-checkout-components).',
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
    'venmo',
    'klarna',
    'affirm',
    'us-bank-account',
    'cash-app-pay',
    'afterpay',
  ];
  return methods.map((method) => getPaymentMethodPresentation(method, theme));
}
