import { TestBed } from '@angular/core/testing';
import { EasyPaymentsConfigService } from './easy-payments-config.service';
import { provideEasyPayments } from './provide-easy-payments';

describe('EasyPaymentsConfigService', () => {
  it('reads the provided config via constructor @Inject (Ionic/Vite-safe)', () => {
    TestBed.configureTestingModule({
      providers: [
        provideEasyPayments({
          enableMockMode: true,
          providers: {},
        }),
      ],
    });

    const service = TestBed.inject(EasyPaymentsConfigService);
    expect(service.getSnapshot().enableMockMode).toBe(true);
  });

  it('defaults to mock mode when the config token is absent but the service is provided', () => {
    TestBed.configureTestingModule({
      providers: [EasyPaymentsConfigService],
    });

    const service = TestBed.inject(EasyPaymentsConfigService);
    expect(service.getSnapshot()).toEqual({
      providers: {},
      enableMockMode: true,
    });
  });

  it('is registered by provideEasyPayments (not providedIn root)', () => {
    TestBed.configureTestingModule({
      providers: [provideEasyPayments({ enableMockMode: false, providers: {} })],
    });
    expect(TestBed.inject(EasyPaymentsConfigService).getSnapshot().enableMockMode).toBe(false);
  });

  it('replace() swaps the runtime snapshot for mock ↔ sandbox toggles', () => {
    TestBed.configureTestingModule({
      providers: [provideEasyPayments({ enableMockMode: true, providers: {} })],
    });
    const service = TestBed.inject(EasyPaymentsConfigService);
    service.replace({
      enableMockMode: false,
      providers: { stripe: { publishableKey: 'pk_test_x' } },
      backend: { createPaymentUrl: '/api/payments/create' },
    });
    expect(service.getSnapshot().enableMockMode).toBe(false);
    expect(service.getSnapshot().providers.stripe?.publishableKey).toBe('pk_test_x');
  });
});
