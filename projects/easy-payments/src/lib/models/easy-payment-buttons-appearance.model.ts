/**
 * Optional strip presentation for {@link EasyPaymentButtonsComponent}.
 *
 * Applies to library-owned selectors, placeholders, and the outer strip shell.
 * Official Apple Pay / Google Pay / PayPal SDK chrome is not restyled beyond
 * layout/gap constraints the SDKs already tolerate.
 *
 * Defaults favor a transparent, compact payment strip that sits inside the
 * merchant's own checkout UI.
 */
export interface EasyPaymentButtonsAppearance {
  /**
   * Gap between strip slots. CSS length. Default: `visualStyle.spacing` or `12px`.
   * Separators (when enabled) sit in this gap.
   */
  gap?: string;

  /** Optional padding inside the strip shell (CSS length or shorthand). Default: none. */
  padding?: string;

  /**
   * Visual dividers between strip slots.
   * - `none` (default) — no dividers
   * - `line` — hairline that follows layout orientation
   *
   * Not inserted inside a single PayPal SDK funding group (one slot).
   */
  separators?: 'none' | 'line';

  /** Optional CSS color for `separators: 'line'`. Default: theme border token. */
  separatorColor?: string;

  /**
   * Outer strip background. Default: `'transparent'` so the merchant page shows through.
   * Pass any CSS color when a filled strip is desired.
   */
  background?: 'transparent' | string;

  /**
   * Border treatment for library-owned Card / Klarna / Affirm selectors and placeholders.
   * Default: `'default'` (1px theme border). `'none'` removes the border.
   */
  border?: 'default' | 'none';

  /** Optional border color for library-owned selectors when `border` is not `'none'`. */
  borderColor?: string;

  /** Optional border width for library-owned selectors (e.g. `'1px'`, `'2px'`). */
  borderWidth?: string;

  /**
   * Corner radius for library-owned selectors / strip mock buttons.
   * Examples: `'0'`, `'8px'`, `'999px'` (pill). Default: theme `--ep-radius-md`.
   */
  borderRadius?: string;

  /** Target height for library-owned strip controls. Default: `40px`. */
  buttonHeight?: string;

  /**
   * Optional fixed width for every slot in a horizontal strip (selectors and
   * official wallet buttons alike). Default: `160px` slots that wrap.
   */
  buttonWidth?: string;

  /** Minimum width for library-owned strip controls. Default: `100px`. */
  buttonMinWidth?: string;
}
