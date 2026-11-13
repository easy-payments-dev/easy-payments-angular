import { inject, Injectable } from '@angular/core';
import { PaymentError } from '../errors/payment-error';
import { validatePaymentProduct } from '../validators/product.validator';
import { PaymentOrchestratorService } from '../services/payment-orchestrator.service';
import { BrowserGuard } from '../utils/browser-guard';
import { createPaymentOwnerId } from '../utils/payment-owner-id';
import { isValidCheckoutInstanceId } from '../adapters/stripe/stripe-redirect-return';
import { EasyPaymentsConfigService } from '../config/easy-payments-config.service';
import { StripeCardAdapter } from '../adapters/stripe/stripe-card.adapter';
import { KlarnaAdapter } from '../adapters/klarna/klarna.adapter';
import { CashAppPayAdapter } from '../adapters/cash-app-pay/cash-app-pay.adapter';
import { AfterpayAdapter } from '../adapters/afterpay/afterpay.adapter';
import { AffirmAdapter } from '../adapters/affirm/affirm.adapter';
import { PayPalAdapter } from '../adapters/paypal/paypal.adapter';
import { VenmoAdapter } from '../adapters/venmo/venmo.adapter';
import { GooglePayAdapter } from '../adapters/google-pay/google-pay.adapter';
import { ApplePayAdapter } from '../adapters/apple-pay/apple-pay.adapter';
import { UsBankAccountAdapter } from '../adapters/us-bank-account/us-bank-account.adapter';
import { StripeRedirectRecoveryService } from '../adapters/stripe/stripe-redirect-recovery.service';
import type { PaymentMethod } from '../models/payment-method.model';
import { isKnownPaymentMethod } from './headless-method-meta';
import { HeadlessCheckoutSessionImpl } from './headless-checkout-session';
import { HeadlessSessionRegistry } from './headless-session-registry';
import type {
  HeadlessCheckoutSession,
  HeadlessSessionOptions,
} from './headless.types';

/**
 * Public factory for Headless Checkout sessions (v1.2.0+).
 *
 * H3.1: Stripe Card mount/confirm.
 * H3.2: Klarna + Affirm mount/confirm via existing Stripe Payment Element adapters.
 * H3.3: PayPal official Buttons (create/capture via backend; no session.confirm()).
 * H3.4: Google Pay official button (Stripe gateway; no session.confirm()).
 * H3.5: Apple Pay via Stripe Express Checkout Element (no session.confirm()).
 * H4.2: Headless Klarna/Affirm pending ownership markers.
 * H4.3: {@link HeadlessCheckoutSession.recoverReturn} via shared StripeRedirectRecoveryService.
 * 1.3.0: US bank account (ACH) mount/confirm via {@link UsBankAccountAdapter}.
 */
@Injectable({ providedIn: 'root' })
export class EasyPaymentsHeadless {
  private readonly orchestrator = inject(PaymentOrchestratorService);
  private readonly registry = inject(HeadlessSessionRegistry);
  private readonly browser = inject(BrowserGuard);
  private readonly config = inject(EasyPaymentsConfigService);
  private readonly stripeCard = inject(StripeCardAdapter);
  private readonly klarna = inject(KlarnaAdapter);
  private readonly affirm = inject(AffirmAdapter);
  private readonly usBankAccount = inject(UsBankAccountAdapter);
  private readonly cashAppPay = inject(CashAppPayAdapter);
  private readonly afterpay = inject(AfterpayAdapter);
  private readonly paypal = inject(PayPalAdapter);
  private readonly venmo = inject(VenmoAdapter);
  private readonly googlePay = inject(GooglePayAdapter);
  private readonly applePay = inject(ApplePayAdapter);
  private readonly stripeRedirectRecovery = inject(StripeRedirectRecoveryService);

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
    const { id, stableCheckoutIdentity } = resolveSessionIdentity(options.checkoutInstanceId);

    this.registry.claim(id);

    try {
      return new HeadlessCheckoutSessionImpl({
        id,
        stableCheckoutIdentity,
        product: options.product,
        methods,
        checkout: options.checkout,
        locale: options.locale,
        translations: options.translations,
        theme: options.theme,
        orchestrator: this.orchestrator,
        registry: this.registry,
        browser: this.browser,
        config: this.config,
        stripeCard: this.stripeCard,
        klarna: this.klarna,
        affirm: this.affirm,
        usBankAccount: this.usBankAccount,
        cashAppPay: this.cashAppPay,
        afterpay: this.afterpay,
        paypal: this.paypal,
        venmo: this.venmo,
        googlePay: this.googlePay,
        applePay: this.applePay,
        stripeRedirectRecovery: this.stripeRedirectRecovery,
      });
    } catch (error) {
      this.registry.release(id);
      throw error;
    }
  }
}

/**
 * Session `id` may be merchant-stable or auto-generated.
 * Klarna/Affirm redirect ownership only uses {@link stableCheckoutIdentity}
 * (merchant-supplied) — never a freshly minted runtime id after reload.
 */
function resolveSessionIdentity(checkoutInstanceId: string | null | undefined): {
  id: string;
  stableCheckoutIdentity: string | null;
} {
  if (checkoutInstanceId === null || checkoutInstanceId === undefined || checkoutInstanceId === '') {
    return { id: createPaymentOwnerId('headless'), stableCheckoutIdentity: null };
  }
  if (!isValidCheckoutInstanceId(checkoutInstanceId)) {
    throw new PaymentError({
      code: 'CONFIG_INVALID',
      message:
        'checkoutInstanceId must match ^[a-zA-Z0-9_.:-]{1,64}$ when provided.',
    });
  }
  return { id: checkoutInstanceId, stableCheckoutIdentity: checkoutInstanceId };
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
