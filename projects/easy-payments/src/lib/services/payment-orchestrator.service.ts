import { inject, Injectable, signal } from '@angular/core';
import {
  CheckoutOptions,
  PaymentContext,
  PaymentMethod,
  PAYMENT_METHOD_PROVIDER_MAP,
  PaymentProduct,
  PaymentResult,
  PaymentTheme,
  ResolvedPaymentTheme,
  normalizePaymentResult,
} from '../models';
import { PaymentError, normalizeError } from '../errors/payment-error';
import { validatePaymentProduct } from '../validators/product.validator';
import { ThemeService } from '../themes/theme.service';
import { AdapterFactory } from '../adapters/adapter.factory';
import { AdapterRegistry } from '../core/adapter-registry';
import {
  MethodReadinessState,
  warnProviderDiagnostic,
} from '../diagnostics/provider-diagnostics';

export interface AvailablePaymentMethod {
  method: PaymentMethod;
  isMock: boolean;
  available: boolean;
  /**
   * Optional readiness detail (Apple Pay real ECE).
   * `checking` = waiting for Express Checkout `ready` (tile hidden).
   */
  status?: 'checking' | 'available' | 'unavailable' | 'error' | 'indeterminate';
  /** Internal method readiness. Optional so existing callers stay compatible. */
  readiness?: MethodReadinessState;
  /** Stable diagnostic code for developers. Not shown in customer UI. */
  diagnosticCode?: string;
}

/** Methods that cannot run without a working Stripe publishable-key setup. */
const STRIPE_DEPENDENT_METHODS = new Set<PaymentMethod>([
  'card',
  'apple-pay',
  'google-pay',
  'klarna',
  'affirm',
  'us-bank-account',
]);

@Injectable({ providedIn: 'root' })
export class PaymentOrchestratorService {
  private readonly adapterFactory = inject(AdapterFactory);
  private readonly registry = inject(AdapterRegistry);
  private readonly themeService = inject(ThemeService);

  private readonly _availableMethods = signal<AvailablePaymentMethod[]>([]);
  private readonly _availabilityPublished = signal(false);
  private readonly _loading = signal(false);
  private initialized = false;
  /** In-flight adapter registration, shared by concurrent hosts so it runs once. */
  private initPromise: Promise<void> | null = null;
  /** Concurrent `processPayment` calls across hosts; `loading` is true while any is in flight. */
  private inFlightPayments = 0;

  /**
   * Global last-refresh availability. UI hosts must not bind tiles to this signal
   * when multiple checkouts can mount — use the per-instance
   * `CheckoutAvailabilitySession` applied from the return value of
   * {@link refreshAvailability}. `EasyPaymentsDiagnosticsService` continues to
   * project this global snapshot.
   */
  readonly availableMethods = this._availableMethods.asReadonly();
  /**
   * True after `refreshAvailability` publishes method readiness on the root
   * orchestrator. `reinitialize()` clears it until the next successful refresh.
   * Consuming apps should read `EasyPaymentsDiagnosticsService` for developer
   * diagnostics (also global / last-refresh).
   */
  readonly availabilityPublished = this._availabilityPublished.asReadonly();
  readonly loading = this._loading.asReadonly();

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }
    // Registration destroys every adapter's mounts; never run it twice concurrently.
    if (!this.initPromise) {
      const pending: Promise<void> = this.adapterFactory.initializeAdapters().then(
        () => {
          if (this.initPromise === pending) {
            this.initialized = true;
            this.initPromise = null;
          }
        },
        (error: unknown) => {
          if (this.initPromise === pending) {
            this.initPromise = null;
          }
          throw error;
        },
      );
      this.initPromise = pending;
    }
    await this.initPromise;
  }

  /** Re-register adapters after runtime config changes (e.g. demo mock ↔ Stripe). */
  async reinitialize(): Promise<void> {
    this.initialized = false;
    this.initPromise = null;
    this._availableMethods.set([]);
    this._availabilityPublished.set(false);
    await this.initialize();
  }

  setTheme(theme: PaymentTheme): void {
    this.themeService.setTheme(theme);
  }

  validateProduct(product: PaymentProduct): void {
    const result = validatePaymentProduct(product);
    if (!result.valid) {
      throw new PaymentError({
        code: 'PRODUCT_INVALID',
        message: result.errors.join(' '),
      });
    }
  }

  private buildContext(
    product: PaymentProduct,
    checkout?: CheckoutOptions,
    theme?: ResolvedPaymentTheme,
  ): PaymentContext {
    return {
      product,
      checkout,
      // Prefer the caller-supplied theme so concurrent <easy-payments> instances
      // do not share a single root ThemeService resolution for availability.
      theme: theme ?? this.themeService.resolvedTheme(),
    };
  }

  async refreshAvailability(
    methods: PaymentMethod[],
    product: PaymentProduct,
    checkout?: CheckoutOptions,
    theme?: ResolvedPaymentTheme,
  ): Promise<AvailablePaymentMethod[]> {
    await this.initialize();
    this.validateProduct(product);

    const context = this.buildContext(product, checkout, theme);
    const stripeFailure = this.adapterFactory.getInitializationFailure('stripe');
    const results: AvailablePaymentMethod[] = [];

    for (const method of methods) {
      const provider = PAYMENT_METHOD_PROVIDER_MAP[method];
      const adapter = this.registry.get(provider);
      const ownFailure = this.adapterFactory.getInitializationFailure(provider);
      const blockedByStripe =
        !!stripeFailure && STRIPE_DEPENDENT_METHODS.has(method) && provider !== 'stripe'
          ? stripeFailure
          : undefined;
      const failure = ownFailure ?? blockedByStripe;

      if (!adapter) {
        results.push({
          method,
          isMock: false,
          available: false,
          status: 'unavailable',
          readiness: 'misconfigured',
          diagnosticCode: 'PROVIDER_NOT_CONFIGURED',
        });
        continue;
      }

      if (failure) {
        results.push({
          method,
          isMock: adapter.isMock,
          available: false,
          status: 'error',
          readiness: failure.readiness,
          diagnosticCode:
            blockedByStripe && !ownFailure ? 'STRIPE_INITIALIZATION_FAILED' : failure.code,
        });
        continue;
      }

      try {
        const available = await adapter.isAvailable(context);
        const status =
          typeof (adapter as { getAvailabilityStatus?: () => string }).getAvailabilityStatus ===
          'function'
            ? ((
                adapter as unknown as {
                  getAvailabilityStatus: (
                    product?: PaymentProduct,
                  ) => AvailablePaymentMethod['status'];
                }
              ).getAvailabilityStatus(context.product) ?? undefined)
            : available
              ? ('available' as const)
              : ('unavailable' as const);
        const readiness = readinessFromAvailability(available, status);
        results.push({
          method,
          isMock: adapter.isMock,
          available,
          status,
          readiness,
          diagnosticCode: available ? undefined : diagnosticCodeForUnavailable(method, status),
        });
      } catch (error) {
        const normalized = normalizeError(error, { method, provider });
        warnProviderDiagnostic(method, normalized.code);
        results.push({
          method,
          isMock: adapter.isMock,
          available: false,
          status: 'error',
          readiness: normalized.code.startsWith('CONFIG') ? 'misconfigured' : 'unavailable',
          diagnosticCode: normalized.code,
        });
      }
    }

    this._availableMethods.set(results);
    this._availabilityPublished.set(true);
    return results;
  }

  async processPayment(
    method: PaymentMethod,
    product: PaymentProduct,
    checkout?: CheckoutOptions,
  ): Promise<PaymentResult> {
    await this.initialize();
    this.validateProduct(product);

    const provider = PAYMENT_METHOD_PROVIDER_MAP[method];
    const adapter = this.registry.get(provider);

    if (!adapter) {
      throw new PaymentError({
        code: 'PROVIDER_NOT_CONFIGURED',
        message: `No adapter registered for ${method}.`,
        method,
        provider,
      });
    }

    const context = this.buildContext(product, checkout);

    const available = await adapter.isAvailable(context);
    if (!available) {
      throw new PaymentError({
        code: 'PROVIDER_UNAVAILABLE',
        message: `${method} is not available for this checkout configuration.`,
        method,
        provider,
      });
    }

    this.inFlightPayments += 1;
    this._loading.set(true);

    try {
      const result = await adapter.createPayment({ method, context });
      return normalizePaymentResult(result);
    } catch (error) {
      throw normalizeError(error, { method, provider });
    } finally {
      this.inFlightPayments -= 1;
      this._loading.set(this.inFlightPayments > 0);
    }
  }
}

function readinessFromAvailability(
  available: boolean,
  status: AvailablePaymentMethod['status'],
): MethodReadinessState {
  if (status === 'checking') {
    return 'loading';
  }
  if (available || status === 'available') {
    return 'ready';
  }
  if (status === 'error') {
    return 'unavailable';
  }
  return 'unavailable';
}

function diagnosticCodeForUnavailable(
  method: PaymentMethod,
  status: AvailablePaymentMethod['status'],
): string {
  if (status === 'checking') {
    return 'PROVIDER_AVAILABILITY_PENDING';
  }
  if (method === 'apple-pay' || method === 'google-pay') {
    return 'PROVIDER_UNAVAILABLE';
  }
  return 'PROVIDER_MISCONFIGURED';
}
