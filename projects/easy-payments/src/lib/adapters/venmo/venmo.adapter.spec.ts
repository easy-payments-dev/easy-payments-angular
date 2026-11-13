import { TestBed } from '@angular/core/testing';
import { provideHttpClient, withXhr } from '@angular/common/http';
import { PLATFORM_ID } from '@angular/core';
import { provideEasyPayments } from '../../config/provide-easy-payments';
import { BackendService } from '../../services/backend.service';
import { SdkLoaderService } from '../../loaders/sdk-loader.service';
import { PayPalAdapter } from '../paypal/paypal.adapter';
import type { PayPalNamespace } from '../paypal/paypal.types';
import { VenmoAdapter } from './venmo.adapter';

describe('VenmoAdapter', () => {
  let adapter: VenmoAdapter;
  let paypal: PayPalAdapter;
  let backend: jasmine.SpyObj<BackendService>;
  let sdkLoader: jasmine.SpyObj<SdkLoaderService>;
  let paypalNs: PayPalNamespace;
  let buttonsFactory: jasmine.Spy;

  async function configure(opts: {
    venmo?: { sandboxBuyerCountry?: 'US' } | undefined;
    paypalClientId?: string;
  }): Promise<void> {
    backend = jasmine.createSpyObj<BackendService>('BackendService', [
      'createPayPalOrder',
      'capturePayPalOrder',
    ]);
    sdkLoader = jasmine.createSpyObj<SdkLoaderService>('SdkLoaderService', [
      'loadScript',
      'unloadScript',
    ]);
    sdkLoader.loadScript.and.resolveTo();

    buttonsFactory = jasmine.createSpy('Buttons').and.callFake(() => ({
      render: jasmine.createSpy('render').and.resolveTo(),
      close: jasmine.createSpy('close').and.resolveTo(),
      isEligible: () => true,
    }));
    paypalNs = { Buttons: buttonsFactory };
    (window as Window & { paypal?: PayPalNamespace }).paypal = undefined;

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withXhr()),
        { provide: PLATFORM_ID, useValue: 'browser' },
        provideEasyPayments({
          enableMockMode: false,
          providers: {
            ...(opts.paypalClientId !== undefined
              ? { paypal: { clientId: opts.paypalClientId, currency: 'USD', intent: 'capture' } }
              : { paypal: { clientId: 'sb-client', currency: 'USD', intent: 'capture' } }),
            ...(opts.venmo ? { venmo: opts.venmo } : {}),
          },
          backend: {
            paypalCreateOrderUrl: '/api/payments/paypal/create',
            paypalCaptureOrderUrl: '/api/payments/paypal/capture',
          },
        }),
        { provide: BackendService, useValue: backend },
        { provide: SdkLoaderService, useValue: sdkLoader },
      ],
    });

    adapter = TestBed.inject(VenmoAdapter);
    paypal = TestBed.inject(PayPalAdapter);
    await paypal.initialize();
    await adapter.initialize();
  }

  afterEach(() => {
    delete (window as Window & { paypal?: PayPalNamespace }).paypal;
  });

  it('is unavailable when Venmo is not opted in', async () => {
    await configure({ venmo: undefined });
    expect(await adapter.isAvailable({} as never)).toBeFalse();
  });

  it('is available when Venmo is opted in with PayPal client + order URLs', async () => {
    await configure({ venmo: {} });
    expect(await adapter.isAvailable({} as never)).toBeTrue();
  });

  it('loads PayPal SDK with enable-funding=venmo and sandbox buyer-country', async () => {
    await configure({ venmo: { sandboxBuyerCountry: 'US' } });
    sdkLoader.loadScript.and.callFake(async (opts) => {
      (window as Window & { paypal?: PayPalNamespace }).paypal = paypalNs;
      return undefined as never;
    });

    await adapter.ensureSdkLoaded('en');

    expect(sdkLoader.loadScript).toHaveBeenCalled();
    const src = String(sdkLoader.loadScript.calls.mostRecent().args[0].src);
    expect(src).toContain('enable-funding=venmo');
    expect(src).toContain('buyer-country=US');
    expect(src).toContain('components=buttons');
  });

  it('renders Buttons with fundingSource venmo and tags capture as venmo', async () => {
    await configure({ venmo: { sandboxBuyerCountry: 'US' } });
    sdkLoader.loadScript.and.callFake(async () => {
      (window as Window & { paypal?: PayPalNamespace }).paypal = paypalNs;
      return undefined as never;
    });
    backend.capturePayPalOrder.and.resolveTo({
      provider: 'paypal',
      orderId: 'ORDER-1',
      captureId: 'CAP-1',
      status: 'COMPLETED',
    });

    const host = document.createElement('div');
    await adapter.renderButtons(host, {
      createOrder: async () => 'ORDER-1',
      onApprove: async () => undefined,
    });

    expect(buttonsFactory).toHaveBeenCalled();
    const options = buttonsFactory.calls.mostRecent().args[0] as { fundingSource?: string };
    expect(options.fundingSource).toBe('venmo');

    const result = await adapter.captureOrder('ORDER-1');
    expect(result.method).toBe('venmo');
    expect(result.provider).toBe('venmo');
    expect(result.status).toBe('success');
  });

  it('rejects duplicate in-flight capture', async () => {
    await configure({ venmo: {} });
    let resolveCapture!: (value: {
      provider: 'paypal';
      orderId: string;
      captureId: string;
      status: string;
    }) => void;
    backend.capturePayPalOrder.and.returnValue(
      new Promise((resolve) => {
        resolveCapture = resolve;
      }),
    );

    const first = adapter.captureOrder('ORDER-DUP');
    await expectAsync(adapter.captureOrder('ORDER-DUP')).toBeRejectedWith(
      jasmine.objectContaining({ code: 'PAYMENT_FAILED', method: 'venmo' }),
    );
    resolveCapture({
      provider: 'paypal',
      orderId: 'ORDER-DUP',
      captureId: 'CAP-DUP',
      status: 'COMPLETED',
    });
    await first;
  });
});
