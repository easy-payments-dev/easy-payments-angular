/**
 * Postal address for checkout customer / shipping hints.
 *
 * `country` must be an ISO 3166-1 alpha-2 code (for example `US`, `CA`, `DE`).
 * Easy Payments does not yet send these fields to create-payment backends.
 */
export interface EasyPaymentsAddress {
  line1: string;
  line2?: string;
  city: string;
  state?: string;
  /** Postal / ZIP code. */
  postalCode: string;
  /** ISO 3166-1 alpha-2 country code (for example `US`). */
  country: string;
}
