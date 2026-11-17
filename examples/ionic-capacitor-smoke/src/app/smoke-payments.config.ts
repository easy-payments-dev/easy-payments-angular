import { EnvironmentProviders } from '@angular/core';
import {
  provideEasyPayments,
  type CheckoutOptions,
  type EasyPaymentsConfig,
} from '@easy-payments/angular';
import { Capacitor } from '@capacitor/core';
import { environment } from '../environments/environment';
import { resolveSmokeCheckoutOptionsFrom } from './capacitor-stripe-return';

export const smokeEnv = environment;

function resolveBackendBaseUrl(): string {
  const configured = smokeEnv.backendBaseUrl?.trim() ?? '';
  if (configured) {
    if (
      Capacitor.isNativePlatform() &&
      Capacitor.getPlatform() === 'android' &&
      (configured.includes('127.0.0.1') || configured.includes('localhost'))
    ) {
      return configured.replace('127.0.0.1', '10.0.2.2').replace('localhost', '10.0.2.2');
    }
    return configured;
  }
  if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android') {
    return 'http://10.0.2.2:3001';
  }
  return 'http://127.0.0.1:3001';
}

export function buildSmokePaymentsConfig(forceMock?: boolean): EasyPaymentsConfig {
  const useMock = forceMock === true || (forceMock !== false && smokeEnv.useMockMode !== false);
  if (useMock) {
    return { enableMockMode: true, providers: {} };
  }

  const baseUrl = resolveBackendBaseUrl();
  return {
    enableMockMode: false,
    providers: {
      ...(smokeEnv.stripePublishableKey?.startsWith('pk_')
        ? {
            stripe: { publishableKey: smokeEnv.stripePublishableKey },
            applePay: { merchantName: 'EP Ionic Smoke', countryCode: 'US' },
            googlePay: {
              environment: 'TEST' as const,
              merchantName: 'EP Ionic Smoke',
              countryCode: 'US',
            },
            klarna: { purchaseCountry: 'US' },
            affirm: { purchaseCountry: 'US' },
            usBankAccount: {},
            cashAppPay: {},
            afterpay: {},
          }
        : {}),
      ...(smokeEnv.paypalClientId?.trim()
        ? {
            paypal: {
              clientId: smokeEnv.paypalClientId.trim(),
              currency: 'USD',
              intent: 'capture' as const,
            },
            venmo: { sandboxBuyerCountry: 'US' as const },
          }
        : {}),
      // Zip opt-in object present; live Sandbox still pending merchant ZIP_* secrets.
      zip: {},
    },
    backend: {
      baseUrl,
      createPaymentUrl: smokeEnv.createPaymentUrl,
      paypalCreateOrderUrl: smokeEnv.paypalCreateOrderUrl,
      paypalCaptureOrderUrl: smokeEnv.paypalCaptureOrderUrl,
      klarnaCreatePaymentUrl: smokeEnv.klarnaCreatePaymentUrl,
      affirmCreatePaymentUrl: smokeEnv.affirmCreatePaymentUrl,
      createUsBankAccountPaymentUrl: smokeEnv.createUsBankAccountPaymentUrl,
      cashAppPayCreatePaymentUrl: smokeEnv.cashAppPayCreatePaymentUrl,
      afterpayCreatePaymentUrl: smokeEnv.afterpayCreatePaymentUrl,
      zipCreateCheckoutUrl: smokeEnv.zipCreateCheckoutUrl,
      zipVerifyReturnUrl: smokeEnv.zipVerifyReturnUrl,
      zipCaptureUrl: smokeEnv.zipCaptureUrl,
    },
  };
}

export function provideSmokeEasyPayments(forceMock?: boolean): EnvironmentProviders {
  return provideEasyPayments(buildSmokePaymentsConfig(forceMock));
}

/**
 * Browser: omit checkout so Stripe return_url stays on the current page (same-origin).
 * Native: use configured public HTTPS App Link + allowExternalHttpsReturnUrl.
 *
 * When native + sandbox (not mock) and the URL is missing, Klarna/Affirm leave-app
 * would fall back to https://localhost and fail in external Chrome — warn loudly.
 */
export function resolveSmokeCheckoutOptions(): CheckoutOptions | undefined {
  return resolveSmokeCheckoutOptionsFrom({
    isNative: Capacitor.isNativePlatform(),
    nativeStripeReturnUrl: smokeEnv.nativeStripeReturnUrl,
    useMockMode: smokeEnv.useMockMode,
  });
}

export { SMOKE_PRODUCT } from './smoke-catalog.product';

export const SMOKE_METHODS = [
  'card',
  'paypal',
  'apple-pay',
  'google-pay',
  'klarna',
  'affirm',
  'venmo',
  'us-bank-account',
  'cash-app-pay',
  'afterpay',
  'zip',
] as const;
