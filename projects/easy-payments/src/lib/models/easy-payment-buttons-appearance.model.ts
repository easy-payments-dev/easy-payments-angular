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

  /**
   * Library-owned Card / Klarna / Affirm selector chrome.
   * Omitted values keep the current default appearance.
   * These fields do not restyle PayPal, Google Pay, or Apple Pay SDK buttons.
   */
  selectorBackgroundColor?: string;
  selectorTextColor?: string;
  selectorFontFamily?: string;
  selectorFontSize?: string;
  selectorFontWeight?: string | number;
  /** CSS padding shorthand for library-owned selectors. */
  selectorPadding?: string;
  selectorHoverBackgroundColor?: string;
  selectorHoverTextColor?: string;
  selectorHoverBorderColor?: string;
  selectorSelectedBackgroundColor?: string;
  selectorSelectedTextColor?: string;
  selectorSelectedBorderColor?: string;
  selectorDisabledBackgroundColor?: string;
  selectorDisabledTextColor?: string;
  selectorLoadingBackgroundColor?: string;
  selectorLoadingTextColor?: string;
  selectorFocusOutlineColor?: string;

  /**
   * Plain-text labels for library-owned selectors.
   * Angular text binding escapes the value. HTML is rejected.
   * Wallet brand buttons are not relabelable.
   */
  selectorLabels?: EasyPaymentButtonsSelectorLabels;

  /**
   * Library brand mark beside a selector label.
   * Default `true`. Does not replace or restyle official wallet SDK chrome.
   */
  showSelectorIcon?: boolean;
}

/** Plain-text overrides for library-owned strip selectors. */
export interface EasyPaymentButtonsSelectorLabels {
  card?: string;
  klarna?: string;
  affirm?: string;
}

/** Who renders the Card / Klarna / Affirm triggers. Wallets stay official SDK buttons. */
export type EasyPaymentButtonsSelectorVisibility = 'library' | 'merchant';
