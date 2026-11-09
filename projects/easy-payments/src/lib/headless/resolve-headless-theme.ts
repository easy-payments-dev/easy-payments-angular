import type { PaymentTheme, ResolvedPaymentTheme } from '../models';

/**
 * Resolves a Headless session theme without mutating the root ThemeService
 * (multi-session isolation).
 */
export function resolveHeadlessTheme(
  theme: PaymentTheme | undefined,
  prefersDark: boolean,
): ResolvedPaymentTheme {
  if (theme === 'light' || theme === 'dark') {
    return theme;
  }
  // `system` or omitted
  return prefersDark ? 'dark' : 'light';
}
