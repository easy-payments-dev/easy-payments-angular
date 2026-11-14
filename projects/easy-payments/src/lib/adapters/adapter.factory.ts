import { inject, Injectable, Injector } from '@angular/core';
import { EasyPaymentsProviderConfig, PROVIDER_DISPLAY_NAMES } from '../config/easy-payments.config';
import { EasyPaymentsConfigService } from '../config/easy-payments-config.service';
import { AdapterRegistry } from '../core/adapter-registry';
import { PaymentProviderAdapter } from '../core/payment-provider.adapter';
import { PaymentProviderName } from '../models';
import {
  describeInitFailure,
  ProviderInitFailure,
  warnProviderDiagnostic,
} from '../diagnostics/provider-diagnostics';
import { EasyPaymentsConfigValidator } from '../validators/config.validator';
import { StripeCardAdapter, StripeCardMockAdapter } from './stripe/stripe-card.adapter';
import { PayPalAdapter, PayPalMockAdapter } from './paypal/paypal.adapter';
import { ApplePayAdapter, ApplePayMockAdapter } from './apple-pay/apple-pay.adapter';
import { GooglePayAdapter, GooglePayMockAdapter } from './google-pay/google-pay.adapter';
import { KlarnaAdapter, KlarnaMockAdapter } from './klarna/klarna.adapter';
import { AffirmAdapter, AffirmMockAdapter } from './affirm/affirm.adapter';
import {
  UsBankAccountAdapter,
  UsBankAccountMockAdapter,
} from './us-bank-account/us-bank-account.adapter';
import { CashAppPayAdapter, CashAppPayMockAdapter } from './cash-app-pay/cash-app-pay.adapter';
import { AfterpayAdapter, AfterpayMockAdapter } from './afterpay/afterpay.adapter';
import { VenmoAdapter, VenmoMockAdapter } from './venmo/venmo.adapter';
import { ZipAdapter, ZipMockAdapter } from './zip/zip.adapter';

type ProviderKey = keyof EasyPaymentsProviderConfig;

const REAL_ADAPTERS: Record<PaymentProviderName, new (...args: never[]) => PaymentProviderAdapter> = {
  stripe: StripeCardAdapter,
  paypal: PayPalAdapter,
  venmo: VenmoAdapter,
  applePay: ApplePayAdapter,
  googlePay: GooglePayAdapter,
  klarna: KlarnaAdapter,
  affirm: AffirmAdapter,
  usBankAccount: UsBankAccountAdapter,
  cashAppPay: CashAppPayAdapter,
  afterpay: AfterpayAdapter,
  zip: ZipAdapter,
};

const MOCK_ADAPTERS: Record<PaymentProviderName, new (...args: never[]) => PaymentProviderAdapter> = {
  stripe: StripeCardMockAdapter,
  paypal: PayPalMockAdapter,
  venmo: VenmoMockAdapter,
  applePay: ApplePayMockAdapter,
  googlePay: GooglePayMockAdapter,
  klarna: KlarnaMockAdapter,
  affirm: AffirmMockAdapter,
  usBankAccount: UsBankAccountMockAdapter,
  cashAppPay: CashAppPayMockAdapter,
  afterpay: AfterpayMockAdapter,
  zip: ZipMockAdapter,
};

const CONFIG_KEY_MAP: Record<PaymentProviderName, ProviderKey> = {
  stripe: 'stripe',
  paypal: 'paypal',
  venmo: 'venmo',
  applePay: 'applePay',
  googlePay: 'googlePay',
  klarna: 'klarna',
  affirm: 'affirm',
  usBankAccount: 'usBankAccount',
  cashAppPay: 'cashAppPay',
  afterpay: 'afterpay',
  zip: 'zip',
};

@Injectable({ providedIn: 'root' })
export class AdapterFactory {
  private readonly configService = inject(EasyPaymentsConfigService);
  private readonly registry = inject(AdapterRegistry);
  private readonly validator = inject(EasyPaymentsConfigValidator);
  private readonly injector = inject(Injector);
  private readonly initFailures = new Map<PaymentProviderName, ProviderInitFailure>();

  getInitializationFailure(provider: PaymentProviderName): ProviderInitFailure | undefined {
    return this.initFailures.get(provider);
  }

  async initializeAdapters(): Promise<void> {
    for (const adapter of this.registry.getAll()) {
      await adapter.destroy?.();
    }
    this.registry.clear();
    this.initFailures.clear();

    const providers = Object.keys(REAL_ADAPTERS) as PaymentProviderName[];

    // One provider's initialize() must not reject the rest of checkout.
    await Promise.all(
      providers.map(async (provider) => {
        let adapter: PaymentProviderAdapter | undefined;
        try {
          adapter = this.createAdapter(provider);
          this.registry.register(adapter);
          await adapter.initialize();
        } catch (error) {
          if (adapter && !this.registry.get(provider)) {
            this.registry.register(adapter);
          }
          const failure = describeInitFailure(error);
          this.initFailures.set(provider, failure);
          const configKey = CONFIG_KEY_MAP[provider];
          warnProviderDiagnostic(
            PROVIDER_DISPLAY_NAMES[configKey],
            failure.code,
            error instanceof Error ? error.message : undefined,
          );
        }
      }),
    );
  }

  createAdapter(provider: PaymentProviderName): PaymentProviderAdapter {
    const config = this.configService.getSnapshot();
    const configKey = CONFIG_KEY_MAP[provider];
    const validation = this.validator.validateProvider(
      configKey,
      config.providers?.[configKey],
    );

    // Mock adapters are an explicit demo mode. A missing or invalid provider
    // stays on its real adapter so it reports unavailable instead of looking payable.
    const useMock = config.enableMockMode === true;

    if (!useMock && validation.status === 'invalid') {
      warnProviderDiagnostic(
        PROVIDER_DISPLAY_NAMES[configKey],
        'CONFIG_INVALID',
        validation.message,
      );
    }

    const AdapterClass = useMock ? MOCK_ADAPTERS[provider] : REAL_ADAPTERS[provider];
    return this.injector.get(AdapterClass);
  }

  getAdapter(provider: PaymentProviderName): PaymentProviderAdapter | undefined {
    return this.registry.get(provider);
  }
}
