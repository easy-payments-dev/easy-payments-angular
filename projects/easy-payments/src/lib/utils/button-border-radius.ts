import type { PayPalButtonsStyle } from '../adapters/paypal/paypal.types';

/**
 * Parse a CSS length used by `buttonsAppearance.borderRadius` into whole pixels
 * for SDK numeric radius APIs. Accepts `0`, `4`, `4px`. Rejects rem/em/%/calc.
 */
export function parseCssLengthToPx(value: string | null | undefined): number | null {
  if (value == null) {
    return null;
  }
  const trimmed = String(value).trim();
  if (!trimmed) {
    return null;
  }
  const match = /^(\d+(?:\.\d+)?)(px)?$/i.exec(trimmed);
  if (!match) {
    return null;
  }
  const n = Number(match[1]);
  if (!Number.isFinite(n) || n < 0) {
    return null;
  }
  return Math.round(n);
}

/**
 * PayPal / Venmo Buttons style for a shared grid radius.
 * `borderRadius: 0` is unreliable in the classic SDK (falsy check) — use `shape: 'sharp'`.
 * When radius is omitted, keep the historical default `shape: 'rect'`.
 */
export function resolvePayPalBorderRadiusStyle(
  radiusPx: number | null | undefined,
): Pick<PayPalButtonsStyle, 'borderRadius' | 'shape'> {
  if (radiusPx == null) {
    return { shape: 'rect' };
  }
  if (radiusPx === 0) {
    return { shape: 'sharp' };
  }
  return { borderRadius: radiusPx };
}

/**
 * Google Pay `buttonRadius` max is half the button height (20 at the default 40px).
 * Pill-like host values (e.g. 999) are clamped — do not clip the official button with CSS.
 */
export function clampGooglePayButtonRadius(
  radiusPx: number,
  buttonHeightPx = 40,
): number {
  const max = Math.max(0, Math.floor(buttonHeightPx / 2));
  return Math.min(max, Math.max(0, Math.round(radiusPx)));
}
