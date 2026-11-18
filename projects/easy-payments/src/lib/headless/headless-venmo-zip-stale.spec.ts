import { TestBed } from '@angular/core/testing';
import { provideHttpClient, withXhr } from '@angular/common/http';
import { PLATFORM_ID } from '@angular/core';
import { firstValueFrom, timeout } from 'rxjs';
import { provideEasyPayments } from '../config/provide-easy-payments';
import { BackendService } from '../services/backend.service';
import { PaymentError } from '../errors/payment-error';
import type { PaymentProduct } from '../models';
import { PayPalAdapter } from '../adapters/paypal/paypal.adapter';
import type { PayPalNamespace } from '../adapters/paypal/paypal.types';
import { VenmoAdapter } from '../adapters/venmo/venmo.adapter';
import { ZipAdapter } from '../adapters/zip/zip.adapter';
import { StripeSdkLoader } from '../adapters/stripe/stripe-sdk.loader';
import { SdkLoaderService } from '../loaders/sdk-loader.service';
import { StripeRedirectRecoveryService } from '../adapters/stripe/stripe-redirect-recovery.service';
import { EasyPaymentsHeadless } from './easy-payments-headless.service';
import { HeadlessSessionRegistry } from './headless-session-registry';
import type { HeadlessCheckoutSession } from './headless.types';

const PRODUCT: PaymentProduct = {
  id: 'premium-plan',
  name: 'Premium',
  amount: 99,
  currency: 'USD',
};

describe('HeadlessCheckoutSession Venmo → Zip stale SDK failure', () => {
  let headless: EasyPaymentsHeadless;
  let registry: HeadlessSessionRegistry;
  let venmo: VenmoAdapter;
  let zip: ZipAdapter;
  let sdkLoader: jasmine.SpyObj<SdkLoaderService>;

  beforeEach(() => {
    const paypalNs: PayPalNamespace = {
      Buttons: jasmine.createSpy('Buttons').and.returnValue({
        render: jasmine.createSpy('render').and.resolveTo(undefined),
        close: jasmine.createSpy('close').and.resolveTo(undefined),
        isEligible: () => true,
      }) as never,
    };
    (window as Window & { paypal?: PayPalNamespace }).paypal = paypalNs;

    sdkLoader = jasmine.createSpyObj<SdkLoaderService>('SdkLoaderService', [
      'loadScript',
      'unloadScript',
    ]);
    sdkLoader.loadScript.and.resolveTo(undefined);

    const stripeSdkLoader = jasmine.createSpyObj<StripeSdkLoader>('StripeSdkLoader', ['load']);
    stripeSdkLoader.load.and.resolveTo({
      elements: jasmine.createSpy('elements'),
      confirmPayment: jasmine.createSpy('confirmPayment'),
    } as never);

    const backend = jasmine.createSpyObj<BackendService>('BackendService', [
      'createPayPalOrder',
      'capturePayPalOrder',
      'createZipCheckout',
      'verifyZipReturn',
    ]);

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withXhr()),
        { provide: PLATFORM_ID, useValue: 'browser' },
        provideEasyPayments({
          enableMockMode: false,
          providers: {
            paypal: { clientId: 'sb-test' },
            venmo: { sandboxBuyerCountry: 'US' },
            zip: {},
          },
          backend: {
            paypalCreateOrderUrl: '/api/paypal/create',
            paypalCaptureOrderUrl: '/api/paypal/capture',
            zipCreateCheckoutUrl: '/api/payments/zip/create',
            zipVerifyReturnUrl: '/api/payments/zip/verify',
          },
        }),
        { provide: BackendService, useValue: backend },
        { provide: SdkLoaderService, useValue: sdkLoader },
        { provide: StripeSdkLoader, useValue: stripeSdkLoader },
      ],
    });

    headless = TestBed.inject(EasyPaymentsHeadless);
    registry = TestBed.inject(HeadlessSessionRegistry);
    venmo = TestBed.inject(VenmoAdapter);
    zip = TestBed.inject(ZipAdapter);
    // Touch shared PayPal adapter so DI is warm (Venmo delegates to it).
    TestBed.inject(PayPalAdapter);
    registry.clearForTests();
    TestBed.inject(StripeRedirectRecoveryService).resetForTests();
  });

  afterEach(() => {
    registry.clearForTests();
    TestBed.inject(StripeRedirectRecoveryService).resetForTests();
    delete (window as Window & { paypal?: PayPalNamespace }).paypal;
  });

  async function readySession(): Promise<HeadlessCheckoutSession> {
    const session = headless.createSession({
      product: PRODUCT,
      methods: ['venmo', 'zip'],
      checkoutInstanceId: `vz-${Math.random().toString(36).slice(2, 8)}`,
    });
    await session.initialize();
    return session;
  }

  it('does not keep a late Venmo SDK_LOAD_FAILED on lastError after Zip mounts', async () => {
    let rejectSdk!: (error: unknown) => void;
    const hungSdk = new Promise<never>((_resolve, reject) => {
      rejectSdk = reject;
    });
    spyOn(venmo, 'ensureSdkLoaded').and.returnValue(hungSdk as never);
    spyOn(zip, 'prepareCheckout').and.resolveTo({
      merchantReference: 'zip-ref-1',
      merchantId: 'merchant-1',
      amount: 99,
      currency: 'USD',
      requestBody: {},
      signature: 'sig',
      sdkScriptUrl: 'https://cdn.zip.co/sdk.js',
    });

    const session = await readySession();
    const errors: PaymentError[] = [];
    const errorSub = session.events.error.subscribe((error) => errors.push(error));

    const venmoHost = document.createElement('div');
    const zipHost = document.createElement('div');
    const venmoMount = session.mount('venmo', venmoHost);

    // Switch to Zip while Venmo’s PayPal SDK load is still in flight.
    const zipHandle = await session.mount('zip', zipHost);
    expect(zipHandle.method).toBe('zip');
    expect(session.selectedMethod()).toBe('zip');
    expect(session.lastError()).toBeNull();

    rejectSdk(
      new PaymentError({
        code: 'SDK_LOAD_FAILED',
        message: 'PayPal SDK script failed to load.',
        method: 'paypal',
        provider: 'paypal',
      }),
    );

    await expectAsync(venmoMount).toBeRejectedWith(
      jasmine.objectContaining({
        code: 'SDK_LOAD_FAILED',
        method: 'venmo',
      }),
    );

    // Active Zip mount must stay clean — no lastError / error event pollution.
    expect(session.lastError()).toBeNull();
    expect(session.selectedMethod()).toBe('zip');
    expect(errors.some((error) => error.code === 'SDK_LOAD_FAILED')).toBeFalse();

    errorSub.unsubscribe();
    await session.destroy();
  });

  it('clears Venmo lastError when selectMethod switches to Zip before remount', async () => {
    spyOn(venmo, 'ensureSdkLoaded').and.rejectWith(
      new PaymentError({
        code: 'SDK_LOAD_FAILED',
        message: 'PayPal SDK script failed to load.',
        method: 'paypal',
        provider: 'paypal',
      }),
    );

    const session = await readySession();
    await expectAsync(session.mount('venmo', document.createElement('div'))).toBeRejected();
    expect(session.lastError()?.code).toBe('SDK_LOAD_FAILED');
    expect(session.lastError()?.method).toBe('venmo');

    session.selectMethod('zip');
    expect(session.selectedMethod()).toBe('zip');
    expect(session.lastError()).toBeNull();

    await session.destroy();
  });

  it('still surfaces SDK_LOAD_FAILED when Venmo remains the active mount', async () => {
    spyOn(venmo, 'ensureSdkLoaded').and.rejectWith(
      new PaymentError({
        code: 'SDK_LOAD_FAILED',
        message: 'PayPal SDK script failed to load.',
        method: 'paypal',
        provider: 'paypal',
      }),
    );

    const session = await readySession();
    const errorPromise = firstValueFrom(session.events.error.pipe(timeout(2000)));

    await expectAsync(session.mount('venmo', document.createElement('div'))).toBeRejectedWith(
      jasmine.objectContaining({ code: 'SDK_LOAD_FAILED', method: 'venmo' }),
    );

    const error = await errorPromise;
    expect(error.code).toBe('SDK_LOAD_FAILED');
    expect(error.method).toBe('venmo');
    expect(session.lastError()?.code).toBe('SDK_LOAD_FAILED');
    expect(session.lastError()?.method).toBe('venmo');

    await session.destroy();
  });
});
