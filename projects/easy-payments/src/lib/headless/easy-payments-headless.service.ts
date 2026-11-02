import { inject, Injectable } from '@angular/core';
import { PaymentError } from '../errors/payment-error';
import { validatePaymentProduct } from '../validators/product.validator';
import { PaymentOrchestratorService } from '../services/payment-orchestrator.service';
import { BrowserGuard } from '../utils/browser-guard';
import { createPaymentOwnerId } from '../utils/payment-owner-id';
import { isValidCheckoutInstanceId } from '../adapters/stripe/stripe-redirect-return';
import { StripeCardAdapter } from '../adapters/stripe/stripe-card.adapter';
import type { PaymentMethod } from '../models/payment-method.model';
import { isKnownPaymentMethod } from './headless-method-meta';
import { HeadlessCheckoutSessionImpl } from './headless-checkout-session';
import { HeadlessSessionRegistry } from './headless-session-registry';
import type {
  HeadlessCheckoutSession,
  HeadlessSessionOptions,
} from './headless.types';

/**
 * Public factory for Headless Checkout sessions (v1.2.0).
 *
 * H3.1: Stripe Card mount/confirm via the existing StripeCardAdapter.
 * Other providers remain not mountable until later milestones.
 */
@Injectable({ providedIn: 'root' })
export class EasyPaymentsHeadless {
  private readonly orchestrator = inject(PaymentOrchestratorService);
  private readonly registry = inject(HeadlessSessionRegistry);
  private readonly browser = inject(BrowserGuard);
  private readonly stripeCard = inject(StripeCardAdapter);

  createSession(options: HeadlessSessionOptions): HeadlessCheckoutSession {
    if (!options || typeof options !== 'object') {
      throw new PaymentError({
        code: 'CONFIG_INVALID',
        message: 'HeadlessSessionOptions are required.',
      });
    }

    const productResult = validatePaymentProduct(options.product);
    if (!productResult.valid) {
      throw new PaymentError({
        code: 'PRODUCT_INVALID',
        message: productResult.errors.join(' '),
      });
    }

    const methods = normalizeSessionMethods(options.methods);
    const id = resolveSessionId(options.checkoutInstanceId);

    this.registry.claim(id);

    try {
      return new HeadlessCheckoutSessionImpl({
        id,
        product: options.product,
        methods,
        checkout: options.checkout,
        locale: options.locale,
        translations: options.translations,
        theme: options.theme,
        orchestrator: this.orchestrator,
        registry: this.registry,
        browser: this.browser,
        stripeCard: this.stripeCard,
      });
    } catch (error) {
      this.registry.release(id);
      throw error;
    }
  }
}

function resolveSessionId(checkoutInstanceId: string | null | undefined): string {
  if (checkoutInstanceId === null || checkoutInstanceId === undefined || checkoutInstanceId === '') {
    return createPaymentOwnerId('headless');
  }
  if (!isValidCheckoutInstanceId(checkoutInstanceId)) {
    throw new PaymentError({
      code: 'CONFIG_INVALID',
      message:
        'checkoutInstanceId must match ^[a-zA-Z0-9_.:-]{1,64}$ when provided.',
    });
  }
  return checkoutInstanceId;
}

function normalizeSessionMethods(methods: PaymentMethod[] | undefined): PaymentMethod[] {
  if (!Array.isArray(methods) || methods.length === 0) {
    throw new PaymentError({
      code: 'CONFIG_INVALID',
      message: 'HeadlessSessionOptions.methods must be a non-empty array.',
    });
  }

  const seen = new Set<PaymentMethod>();
  const normalized: PaymentMethod[] = [];

  for (const method of methods) {
    if (typeof method !== 'string' || !isKnownPaymentMethod(method)) {
      throw new PaymentError({
        code: 'CONFIG_INVALID',
        message: `Unsupported payment method "${String(method)}".`,
      });
    }
    if (seen.has(method)) {
      throw new PaymentError({
        code: 'CONFIG_INVALID',
        message: `Duplicate payment method "${method}" in HeadlessSessionOptions.methods.`,
        method,
      });
    }
    seen.add(method);
    normalized.push(method);
  }

  return normalized;
}
