import { Injectable } from '@angular/core';
import type { Stripe } from '@stripe/stripe-js';
/**
 * Use the public `/pure` entry so merely importing Easy Payments does not
 * auto-inject `js.stripe.com`. Stripe.js loads only when `load()` is called
 * (real adapters). Mock mode never calls `load()`.
 *
 * Types stay on the main package entry (`import type` is erased at compile time).
 *
 * @see https://github.com/stripe/stripe-js#ensuring-stripejs-is-available-everywhere
 */
import { loadStripe } from '@stripe/stripe-js/pure';

/**
 * Thin wrapper around official loadStripe so unit tests can stub SDK loading
 * without hitting the network.
 */
@Injectable({ providedIn: 'root' })
export class StripeSdkLoader {
  load(publishableKey: string): Promise<Stripe | null> {
    return loadStripe(publishableKey);
  }
}
