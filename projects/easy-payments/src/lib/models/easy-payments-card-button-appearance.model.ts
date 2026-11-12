/**
 * Optional presentation for the Easy Payments–owned Card / ACH confirmation CTA
 * (`.ep-stripe-card__pay` / `.ep-ach__pay`).
 *
 * Applies to the library button that confirms a Stripe Payment Element payment in
 * both `<easy-payments>` (Full Checkout) and `<easy-payment-buttons>` (Buttons Only).
 * Buttons Only forwards the same input to Card and US bank account panels.
 * It does **not** restyle the Stripe Payment Element iframe or official
 * PayPal / Google Pay / Apple Pay SDK buttons.
 *
 * All fields are optional. Omitted or invalid values leave theme defaults in place
 * (`--ep-cta-*` light/dark tokens and existing localization).
 */
export interface EasyPaymentsCardButtonAppearance {
  /**
   * Plain-text label override for the idle CTA.
   * When set, replaces the localized default (`Pay {{amount}}` in Full Checkout;
   * `Pay with card` / `Pay with US bank account` in Buttons Only).
   * Processing/loading copy still uses i18n (`processingPayment`) unless you
   * also customize loading styles only. Buttons Only closes the ACH panel after
   * a verified pending/success; the host consumes `(pending)` / `(success)`.
   */
  label?: string;

  /** Idle background (maps to `--ep-card-cta-bg`, falls back to `--ep-cta-bg`). */
  backgroundColor?: string;
  /** Idle text color (maps to `--ep-card-cta-text`, falls back to `--ep-cta-text`). */
  textColor?: string;

  /** CSS `font-family` for the CTA, or `'inherit'`. */
  fontFamily?: string;
  /** CSS font size (e.g. `'15px'`, `'1rem'`). */
  fontSize?: string;
  /** CSS font weight (e.g. `650`, `'bold'`, `'600'`). */
  fontWeight?: string | number;
  /** Horizontal text alignment inside the button. */
  textAlign?: 'left' | 'center' | 'right' | 'start' | 'end';

  /**
   * Border treatment shortcut.
   * - `'default'` — keep library default (no border)
   * - `'none'` — force `border: none`
   * Individual `borderWidth` / `borderStyle` / `borderColor` still apply when
   * `border` is not `'none'`.
   */
  border?: 'default' | 'none';
  /** CSS border width (e.g. `'1px'`). Ignored when `border: 'none'`. */
  borderWidth?: string;
  /** CSS border style (e.g. `'solid'`, `'dashed'`). Ignored when `border: 'none'`. */
  borderStyle?: string;
  /** CSS border color. Ignored when `border: 'none'`. */
  borderColor?: string;
  /** Corner radius (e.g. `'8px'`, `'999px'`). */
  borderRadius?: string;

  /** Minimum button height (e.g. `'44px'`). */
  minHeight?: string;
  /**
   * Button width. CSS length or `%` (e.g. `'100%'`, `'220px'`).
   * Prefer `%` / lengths that fit the panel; avoid values that overflow the strip.
   */
  width?: string;
  /** CSS padding shorthand (1–4 length values). */
  padding?: string;

  /** Hover background when the CTA is enabled. */
  hoverBackgroundColor?: string;
  /** Hover text color when the CTA is enabled. */
  hoverTextColor?: string;

  /** Disabled background (overrides the default muted color-mix). */
  disabledBackgroundColor?: string;
  /** Disabled text color. */
  disabledTextColor?: string;

  /** Background while confirming (`aria-busy="true"`). */
  loadingBackgroundColor?: string;
  /** Text color while confirming. */
  loadingTextColor?: string;

  /** `:focus-visible` outline color (defaults to `--ep-focus` / accent). */
  focusOutlineColor?: string;
  /** `:focus-visible` outline width (e.g. `'2px'`). */
  focusOutlineWidth?: string;
  /** `:focus-visible` outline offset (e.g. `'2px'`). */
  focusOutlineOffset?: string;
}
