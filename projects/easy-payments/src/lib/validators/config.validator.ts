import { inject, Injectable } from '@angular/core';
import {
  EasyPaymentsConfig,
  EasyPaymentsProviderConfig,
  PROVIDER_DISPLAY_NAMES,
  PROVIDER_REQUIRED_FIELD_LABEL,
  ProviderConfigStatus,
  ProviderValidationResult,
} from '../config/easy-payments.config';
import { EasyPaymentsConfigService } from '../config/easy-payments-config.service';
import { PaymentMethod, PAYMENT_METHOD_PROVIDER_MAP } from '../models';

const ALL_PROVIDERS = [
  'stripe',
  'paypal',
  'applePay',
  'googlePay',
  'klarna',
  'affirm',
  'usBankAccount',
  'cashAppPay',
  'afterpay',
  'venmo',
] as const satisfies ReadonlyArray<keyof EasyPaymentsProviderConfig>;

@Injectable({ providedIn: 'root' })
export class EasyPaymentsConfigValidator {
  private readonly configService = inject(EasyPaymentsConfigService);

  private get config(): EasyPaymentsConfig {
    return this.configService.getSnapshot();
  }

  validateProvider(
    provider: keyof EasyPaymentsProviderConfig,
    providerConfig: EasyPaymentsProviderConfig[keyof EasyPaymentsProviderConfig] | undefined,
  ): ProviderValidationResult {
    const required = PROVIDER_REQUIRED_FIELD_LABEL[provider];

    if (!providerConfig) {
      return {
        provider,
        status: 'missing',
        message: required,
      };
    }

    switch (provider) {
      case 'stripe': {
        const cfg = providerConfig as EasyPaymentsProviderConfig['stripe'];
        const key = cfg?.publishableKey?.trim() ?? '';
        if (!key) {
          return { provider, status: 'invalid', message: required };
        }
        if (/^sk_(test|live)_/i.test(key)) {
          return {
            provider,
            status: 'invalid',
            message: 'secret key is not allowed in the frontend',
          };
        }
        if (!/^pk_(test|live)_/i.test(key)) {
          return {
            provider,
            status: 'invalid',
            message: 'publishableKey appears invalid',
          };
        }
        break;
      }
      case 'paypal': {
        const cfg = providerConfig as EasyPaymentsProviderConfig['paypal'];
        if (!cfg?.clientId?.trim()) {
          return { provider, status: 'invalid', message: required };
        }
        break;
      }
      case 'applePay': {
        const cfg = providerConfig as EasyPaymentsProviderConfig['applePay'];
        // Presence of the applePay config object opts in.
        // Stripe publishableKey + createPaymentUrl are enforced by ApplePayAdapter.
        if (!cfg || typeof cfg !== 'object') {
          return { provider, status: 'invalid', message: required };
        }
        break;
      }
      case 'googlePay': {
        const cfg = providerConfig as EasyPaymentsProviderConfig['googlePay'];
        // Presence of the googlePay config object is enough to opt in.
        // Stripe publishableKey + backend URL are enforced at runtime by GooglePayAdapter.
        if (!cfg || typeof cfg !== 'object') {
          return { provider, status: 'invalid', message: required };
        }
        if ((cfg.environment ?? 'TEST') === 'PRODUCTION' && !cfg.merchantId?.trim()) {
          return {
            provider,
            status: 'invalid',
            message: 'merchantId required for PRODUCTION',
          };
        }
        break;
      }
      case 'klarna': {
        const cfg = providerConfig as EasyPaymentsProviderConfig['klarna'];
        // Presence of the klarna config object is enough to opt in.
        // Stripe publishableKey + klarnaCreatePaymentUrl are enforced at runtime by KlarnaAdapter.
        if (!cfg || typeof cfg !== 'object') {
          return { provider, status: 'invalid', message: required };
        }
        break;
      }
      case 'affirm': {
        const cfg = providerConfig as EasyPaymentsProviderConfig['affirm'];
        // Presence of the affirm config object is enough to opt in.
        // Stripe publishableKey + affirmCreatePaymentUrl are enforced at runtime by AffirmAdapter.
        if (!cfg || typeof cfg !== 'object') {
          return { provider, status: 'invalid', message: required };
        }
        break;
      }
      case 'usBankAccount': {
        const cfg = providerConfig as EasyPaymentsProviderConfig['usBankAccount'];
        // Presence of the usBankAccount config object is enough to opt in.
        // Stripe publishableKey + createUsBankAccountPaymentUrl are enforced at runtime.
        if (!cfg || typeof cfg !== 'object') {
          return { provider, status: 'invalid', message: required };
        }
        break;
      }
      case 'cashAppPay': {
        const cfg = providerConfig as EasyPaymentsProviderConfig['cashAppPay'];
        // Presence of the cashAppPay config object is enough to opt in.
        // Stripe publishableKey + cashAppPayCreatePaymentUrl are enforced at runtime.
        if (!cfg || typeof cfg !== 'object') {
          return { provider, status: 'invalid', message: required };
        }
        break;
      }
      case 'afterpay': {
        const cfg = providerConfig as EasyPaymentsProviderConfig['afterpay'];
        // Presence of the afterpay config object is enough to opt in.
        // Stripe publishableKey + afterpayCreatePaymentUrl are enforced at runtime.
        if (!cfg || typeof cfg !== 'object') {
          return { provider, status: 'invalid', message: required };
        }
        break;
      }
      case 'venmo': {
        const cfg = providerConfig as EasyPaymentsProviderConfig['venmo'];
        // Presence of the venmo config object is enough to opt in.
        // PayPal clientId + paypal create/capture URLs are enforced at runtime.
        if (!cfg || typeof cfg !== 'object') {
          return { provider, status: 'invalid', message: required };
        }
        if (cfg.sandboxBuyerCountry != null && cfg.sandboxBuyerCountry !== 'US') {
          return {
            provider,
            status: 'invalid',
            message: 'sandboxBuyerCountry must be "US" when set',
          };
        }
        break;
      }
    }

    return { provider, status: 'configured' };
  }

  validateAll(
    methods: PaymentMethod[] = [],
    config: EasyPaymentsConfig | null = this.config,
  ): ProviderValidationResult[] {
    const providers = config?.providers ?? {};
    const requestedProviders = new Set(
      methods.map((method) => PAYMENT_METHOD_PROVIDER_MAP[method]),
    );

    return ALL_PROVIDERS.map((provider) => {
      if (methods.length > 0 && !requestedProviders.has(provider)) {
        return { provider, status: 'not_requested' as ProviderConfigStatus };
      }
      return this.validateProvider(provider, providers[provider]);
    });
  }

  /**
   * Human-readable status lines. Never includes secret values such as keys.
   */
  getStatusSummary(
    methods: PaymentMethod[] = [],
    config: EasyPaymentsConfig | null = this.config,
  ): string[] {
    const mockMode = config?.enableMockMode === true;

    return this.validateAll(methods, config)
      .filter((result) => result.status !== 'not_requested')
      .map((result) => this.formatStatusLine(result, mockMode));
  }

  formatStatusLine(result: ProviderValidationResult, mockMode = false): string {
    const name = PROVIDER_DISPLAY_NAMES[result.provider];
    const demoSuffix = mockMode ? ' (demo mode)' : '';

    switch (result.status) {
      case 'configured':
        return `${name}: configured${demoSuffix}`;
      case 'missing':
      case 'invalid':
        return `${name}: ${result.message ?? 'invalid configuration'}${demoSuffix}`;
      default:
        return `${name}: ${result.status}${demoSuffix}`;
    }
  }
}
