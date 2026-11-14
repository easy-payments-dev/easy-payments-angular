/**
 * Optional strip presentation for {@link EasyPaymentButtonsComponent}.
 *
 * Applies to library-owned selectors, placeholders, mock strip buttons, and
 * (via each provider's styling API) mounted PayPal / Venmo / Google Pay /
 * Apple Pay SDK buttons in the Buttons Only grid. Do not clip SDK iframes
 * with CSS overflow/radius — radius is forwarded through official options.
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
   * Border treatment for library-owned Card / Klarna / Affirm / ACH selectors and placeholders.
   * Default: `'default'` (1px theme border). `'none'` removes the border.
   */
  border?: 'default' | 'none';

  /** Optional border color for library-owned selectors when `border` is not `'none'`. */
  borderColor?: string;

  /** Optional border width for library-owned selectors (e.g. `'1px'`, `'2px'`). */
  borderWidth?: string;

  /**
   * Shared corner radius for the entire Buttons Only payment grid.
   * Examples: `'0'`, `'4px'`, `'8px'`, `'999px'` (pill for library/mock).
   * Default: theme `--ep-radius-md` for library/mock chrome; SDK buttons keep
   * provider defaults until this is set.
   *
   * Forwarded as:
   * - CSS `--ep-buttons-radius` (library selectors + mock strip buttons)
   * - PayPal / Venmo `style.borderRadius` (px number; `0` → `shape: 'sharp'`)
   * - Google Pay `buttonRadius` (clamped to ≤ half button height, max 20 at 40px)
   * - Apple Pay Stripe ECE Appearance `variables.borderRadius`
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
   * Library-owned Card / Klarna / Affirm / ACH selector chrome.
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

/**
 * Plain-text overrides for library-owned selectors.
 * Used by Buttons Only (`buttonsAppearance.selectorLabels`) and Full Checkout
 * (`[selectorLabels]`). Blank / omitted keys keep localized defaults.
 * Accessible names follow the visible label. Confirm CTAs are independent
 * (`cardButtonAppearance.label`).
 */
export interface EasyPaymentButtonsSelectorLabels {
  /** Override for the Card selector label. */
  card?: string;
  klarna?: string;
  affirm?: string;
  /** Override for the US bank account (ACH) selector label. */
  usBankAccount?: string;
  /** Override for the Cash App Pay selector label. */
  cashAppPay?: string;
  /** Override for the Afterpay selector label. */
  afterpay?: string;
  /** Optional Venmo selector label (Full Checkout tiles use the official wordmark by default). */
  venmo?: string;
  /** Optional Zip selector label (Full Checkout tiles use the official wordmark by default). */
  zip?: string;
}

/** Who renders the Card / Klarna / Affirm / ACH / Cash App Pay / Afterpay triggers. Wallets stay official SDK buttons. */
export type EasyPaymentButtonsSelectorVisibility = 'library' | 'merchant';
