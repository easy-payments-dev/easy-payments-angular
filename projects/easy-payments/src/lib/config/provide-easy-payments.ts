import { EnvironmentProviders, makeEnvironmentProviders } from '@angular/core';
import { EasyPaymentsConfig } from './easy-payments.config';
import { EasyPaymentsConfigService } from './easy-payments-config.service';
import { EASY_PAYMENTS_CONFIG } from './easy-payments-config.token';

export { EASY_PAYMENTS_CONFIG } from './easy-payments-config.token';

/**
 * Registers Easy Payments configuration for the application injector.
 * Also provides {@link EasyPaymentsConfigService} in the same environment
 * (do not rely on `providedIn: 'root'` for that service — see Ionic/Capacitor NG0203).
 */
export function provideEasyPayments(config: EasyPaymentsConfig): EnvironmentProviders {
  return makeEnvironmentProviders([
    {
      provide: EASY_PAYMENTS_CONFIG,
      useValue: config,
    },
    EasyPaymentsConfigService,
  ]);
}
