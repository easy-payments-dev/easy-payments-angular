/**
 * Shared CSS declaration-value sanitizers for host-bound custom properties.
 * Rejects injection payloads; keeps a single safe declaration value.
 */

const MAX_VALUE_LENGTH = 200;

const UNSAFE_CSS_VALUE =
  /[;{}<>]|\/\*|\*\/|url\s*\(|expression\s*\(|javascript:|@import|@charset|behavior\s*:/i;

const CSS_COLOR =
  /^(#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})|(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(\s*[^;{}()]+\s*\)|transparent|currentcolor|[a-z]{1,32})$/i;

const CSS_LENGTH =
  /^(0|[-+]?(?:\d*\.\d+|\d+)(?:px|rem|em|%|ch|ex|vh|vw|vmin|vmax|cm|mm|in|pt|pc))$/i;

const CSS_FONT_VAR = /^var\(\s*--[a-zA-Z_][\w-]*\s*\)$/;
const CSS_FONT_STACK = /^[a-z0-9\s,'"._-]+$/i;
const CSS_FONT_WEIGHT =
  /^(?:[1-9]00|1000|normal|bold|bolder|lighter|[1-9]|[1-9]\d{1,2})$/i;
const CSS_BORDER_STYLE =
  /^(?:none|hidden|dotted|dashed|solid|double|groove|ridge|inset|outset)$/i;
const CSS_TEXT_ALIGN = /^(?:left|center|right|start|end)$/i;

function trimOrEmpty(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function isSafeCssValue(value: string): boolean {
  if (!value || value.length > MAX_VALUE_LENGTH) {
    return false;
  }
  if (UNSAFE_CSS_VALUE.test(value)) {
    return false;
  }
  if (/[\u0000-\u001f\u007f]/.test(value)) {
    return false;
  }
  return true;
}

export function sanitizeColor(value: unknown): string | null {
  const raw = trimOrEmpty(value);
  if (!raw || !isSafeCssValue(raw) || !CSS_COLOR.test(raw)) {
    return null;
  }
  return raw;
}

export function sanitizeLength(value: unknown): string | null {
  const raw = trimOrEmpty(value);
  if (!raw || !isSafeCssValue(raw) || !CSS_LENGTH.test(raw)) {
    return null;
  }
  return raw;
}

export function sanitizeFontFamily(value: unknown): string | null {
  const raw = trimOrEmpty(value);
  if (!raw || !isSafeCssValue(raw)) {
    return null;
  }
  if (raw.toLowerCase() === 'inherit') {
    return 'inherit';
  }
  if (CSS_FONT_VAR.test(raw)) {
    return raw;
  }
  if (!CSS_FONT_STACK.test(raw)) {
    return null;
  }
  return raw;
}

export function sanitizeFontWeight(value: unknown): string | null {
  const raw =
    typeof value === 'number' && Number.isFinite(value)
      ? String(Math.round(value))
      : trimOrEmpty(value);
  if (!raw || !isSafeCssValue(raw) || !CSS_FONT_WEIGHT.test(raw)) {
    return null;
  }
  const asNum = Number(raw);
  if (!Number.isNaN(asNum) && (asNum < 1 || asNum > 1000)) {
    return null;
  }
  return raw;
}

export function sanitizeBorderStyle(value: unknown): string | null {
  const raw = trimOrEmpty(value).toLowerCase();
  if (!raw || !isSafeCssValue(raw) || !CSS_BORDER_STYLE.test(raw)) {
    return null;
  }
  return raw;
}

export function sanitizeTextAlign(value: unknown): string | null {
  const raw = trimOrEmpty(value).toLowerCase();
  if (!raw || !CSS_TEXT_ALIGN.test(raw)) {
    return null;
  }
  return raw;
}

/** 1–4 CSS length tokens (padding/margin shorthand). */
export function sanitizePaddingShorthand(value: unknown): string | null {
  const raw = trimOrEmpty(value);
  if (!raw || !isSafeCssValue(raw)) {
    return null;
  }
  const parts = raw.split(/\s+/);
  if (parts.length < 1 || parts.length > 4) {
    return null;
  }
  if (!parts.every((part) => CSS_LENGTH.test(part))) {
    return null;
  }
  return parts.join(' ');
}

/**
 * Plain-text CTA label: collapses whitespace, caps length, rejects markup.
 * Never treated as HTML.
 */
export function sanitizePlainLabel(value: unknown, maxLength = 80): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  if (/[<>]/.test(value) || /[\u0000-\u001f\u007f]/.test(value)) {
    return null;
  }
  const stripped = value.replace(/\s+/g, ' ').trim();
  if (!stripped || stripped.length > maxLength) {
    return null;
  }
  return stripped;
}
