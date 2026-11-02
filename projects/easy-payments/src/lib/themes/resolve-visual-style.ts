import type { EasyPaymentsVisualStyle } from '../models/easy-payments-visual-style.model';
import {
  sanitizeColor,
  sanitizeFontFamily,
  sanitizeLength,
} from './css-value-sanitize';

/**
 * Exact default stack previously hardcoded on `:host`.
 * Kept as the `--ep-font-family` default so typography does not change
 * unless `visualStyle.fontFamily` is set.
 */
export const DEFAULT_EP_FONT_FAMILY =
  "'Segoe UI', system-ui, -apple-system, BlinkMacSystemFont, sans-serif";

/**
 * Host-bound CSS custom property values derived from {@link EasyPaymentsVisualStyle}.
 * `null` means “do not set inline” so SCSS theme defaults remain in effect.
 */
export interface VisualStyleHostCssVars {
  fontFamily: string | null;
  textColor: string | null;
  textSecondaryColor: string | null;
  backgroundColor: string | null;
  surfaceColor: string | null;
  accentColor: string | null;
  /** Derived soft fill for selected tiles; set only when `accentColor` is valid. */
  accentSoft: string | null;
  borderRadius: string | null;
  spacing: string | null;
}

const EMPTY_HOST_VARS: VisualStyleHostCssVars = {
  fontFamily: null,
  textColor: null,
  textSecondaryColor: null,
  backgroundColor: null,
  surfaceColor: null,
  accentColor: null,
  accentSoft: null,
  borderRadius: null,
  spacing: null,
};

/**
 * Soft accent fill derived from a sanitized accent color.
 * Used for selected-method tile backgrounds without inventing a second public API field.
 */
export function deriveAccentSoft(accentColor: string): string {
  return `color-mix(in srgb, ${accentColor} 14%, transparent)`;
}

/**
 * Map an optional {@link EasyPaymentsVisualStyle} to host CSS variable overrides.
 * Invalid or omitted fields become `null` (no inline override).
 */
export function resolveVisualStyleCssVars(
  style: EasyPaymentsVisualStyle | null | undefined,
): VisualStyleHostCssVars {
  if (style == null || typeof style !== 'object') {
    return { ...EMPTY_HOST_VARS };
  }

  const accentColor = sanitizeColor(style.accentColor);

  return {
    fontFamily: sanitizeFontFamily(style.fontFamily),
    textColor: sanitizeColor(style.textColor),
    textSecondaryColor: sanitizeColor(style.textSecondaryColor),
    backgroundColor: sanitizeColor(style.backgroundColor),
    surfaceColor: sanitizeColor(style.surfaceColor),
    accentColor,
    accentSoft: accentColor ? deriveAccentSoft(accentColor) : null,
    borderRadius: sanitizeLength(style.borderRadius),
    spacing: sanitizeLength(style.spacing),
  };
}
