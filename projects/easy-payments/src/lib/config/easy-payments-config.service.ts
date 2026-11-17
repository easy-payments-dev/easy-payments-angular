import { Inject, Injectable, Optional } from '@angular/core';
import { EasyPaymentsConfig } from './easy-payments.config';
import { EASY_PAYMENTS_CONFIG } from './easy-payments-config.token';

/**
 * Mutable runtime config so demos (and hosts) can switch mock ↔ real Stripe
 * without rebuilding the injector tree.
 *
 * Provided only via {@link provideEasyPayments} (not `providedIn: 'root'`) so the
 * service and `EASY_PAYMENTS_CONFIG` token share one injector registration — required
 * for Ionic/Capacitor production bundles where a root `inject()` of the config token
 * can throw NG0203.
 *
 * Uses constructor `@Inject` (not `inject()`) for the same reason.
 */
@Injectable()
export class EasyPaymentsConfigService {
  private config: EasyPaymentsConfig;

  constructor(
    @Optional() @Inject(EASY_PAYMENTS_CONFIG) initial: EasyPaymentsConfig | null,
  ) {
    this.config = initial
      ? structuredClone(initial)
      : { providers: {}, enableMockMode: true };
  }

  getSnapshot(): EasyPaymentsConfig {
    return this.config;
  }

  update(partial: Partial<EasyPaymentsConfig>): EasyPaymentsConfig {
    this.config = {
      ...this.config,
      ...partial,
      providers: {
        ...this.config.providers,
        ...(partial.providers ?? {}),
      },
      backend: partial.backend
        ? { ...this.config.backend, ...partial.backend }
        : this.config.backend,
    };
    return this.config;
  }

  replace(config: EasyPaymentsConfig): EasyPaymentsConfig {
    this.config = structuredClone(config);
    return this.config;
  }
}
