import type { EasyPaymentsCardButtonAppearance } from '../models/easy-payments-card-button-appearance.model';
import {
  sanitizeBorderStyle,
  sanitizeColor,
  sanitizeFontFamily,
  sanitizeFontWeight,
  sanitizeLength,
  sanitizePaddingShorthand,
  sanitizePlainLabel,
  sanitizeTextAlign,
} from './css-value-sanitize';

/**
 * Host-bound CSS custom properties for the Stripe Card CTA.
 * `null` means “do not set inline” so theme `--ep-cta-*` defaults remain.
 */
export interface CardButtonAppearanceCssVars {
  backgroundColor: string | null;
  textColor: string | null;
  fontFamily: string | null;
  fontSize: string | null;
  fontWeight: string | null;
  textAlign: string | null;
  borderWidth: string | null;
  borderStyle: string | null;
  borderColor: string | null;
  borderRadius: string | null;
  minHeight: string | null;
  width: string | null;
  padding: string | null;
  hoverBackgroundColor: string | null;
  hoverTextColor: string | null;
  disabledBackgroundColor: string | null;
  disabledTextColor: string | null;
  loadingBackgroundColor: string | null;
  loadingTextColor: string | null;
  focusOutlineColor: string | null;
  focusOutlineWidth: string | null;
  focusOutlineOffset: string | null;
}

export interface ResolvedCardButtonAppearance {
  /** Sanitized plain-text label override, or `null` to keep localized default. */
  label: string | null;
  cssVars: CardButtonAppearanceCssVars;
}

const EMPTY_CSS_VARS: CardButtonAppearanceCssVars = {
  backgroundColor: null,
  textColor: null,
  fontFamily: null,
  fontSize: null,
  fontWeight: null,
  textAlign: null,
  borderWidth: null,
  borderStyle: null,
  borderColor: null,
  borderRadius: null,
  minHeight: null,
  width: null,
  padding: null,
  hoverBackgroundColor: null,
  hoverTextColor: null,
  disabledBackgroundColor: null,
  disabledTextColor: null,
  loadingBackgroundColor: null,
  loadingTextColor: null,
  focusOutlineColor: null,
  focusOutlineWidth: null,
  focusOutlineOffset: null,
};

const EMPTY_RESOLVED: ResolvedCardButtonAppearance = {
  label: null,
  cssVars: { ...EMPTY_CSS_VARS },
};

/**
 * Map optional {@link EasyPaymentsCardButtonAppearance} to a sanitized label
 * and host CSS variable overrides. Invalid fields are ignored.
 */
export function resolveCardButtonAppearance(
  appearance: EasyPaymentsCardButtonAppearance | null | undefined,
): ResolvedCardButtonAppearance {
  if (appearance == null || typeof appearance !== 'object') {
    return {
      label: null,
      cssVars: { ...EMPTY_CSS_VARS },
    };
  }

  const borderNone = appearance.border === 'none';

  return {
    label: sanitizePlainLabel(appearance.label),
    cssVars: {
      backgroundColor: sanitizeColor(appearance.backgroundColor),
      textColor: sanitizeColor(appearance.textColor),
      fontFamily: sanitizeFontFamily(appearance.fontFamily),
      fontSize: sanitizeLength(appearance.fontSize),
      fontWeight: sanitizeFontWeight(appearance.fontWeight),
      textAlign: sanitizeTextAlign(appearance.textAlign),
      borderWidth: borderNone ? '0px' : sanitizeLength(appearance.borderWidth),
      borderStyle: borderNone ? 'none' : sanitizeBorderStyle(appearance.borderStyle),
      borderColor: borderNone ? 'transparent' : sanitizeColor(appearance.borderColor),
      borderRadius: sanitizeLength(appearance.borderRadius),
      minHeight: sanitizeLength(appearance.minHeight),
      width: sanitizeLength(appearance.width),
      padding: sanitizePaddingShorthand(appearance.padding),
      hoverBackgroundColor: sanitizeColor(appearance.hoverBackgroundColor),
      hoverTextColor: sanitizeColor(appearance.hoverTextColor),
      disabledBackgroundColor: sanitizeColor(appearance.disabledBackgroundColor),
      disabledTextColor: sanitizeColor(appearance.disabledTextColor),
      loadingBackgroundColor: sanitizeColor(appearance.loadingBackgroundColor),
      loadingTextColor: sanitizeColor(appearance.loadingTextColor),
      focusOutlineColor: sanitizeColor(appearance.focusOutlineColor),
      focusOutlineWidth: sanitizeLength(appearance.focusOutlineWidth),
      focusOutlineOffset: sanitizeLength(appearance.focusOutlineOffset),
    },
  };
}

export function emptyCardButtonAppearance(): ResolvedCardButtonAppearance {
  return {
    label: EMPTY_RESOLVED.label,
    cssVars: { ...EMPTY_CSS_VARS },
  };
}
