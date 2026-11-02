import { TestBed } from '@angular/core/testing';
import { PLATFORM_ID } from '@angular/core';
import { provideEasyPayments } from '../config/provide-easy-payments';
import { BackendService } from '../services/backend.service';
import { StripeSdkLoader } from '../adapters/stripe/stripe-sdk.loader';
import { SdkLoaderService } from '../loaders/sdk-loader.service';
import { ApplePayAdapter } from '../adapters/apple-pay/apple-pay.adapter';
import { GooglePayAdapter } from '../adapters/google-pay/google-pay.adapter';
import { GooglePaySdkLoader } from '../adapters/google-pay/google-pay-sdk.loader';
import { PayPalAdapter } from '../adapters/paypal/paypal.adapter';
import { StripeConfirmationGate } from '../adapters/stripe/stripe-confirmation-gate';
import { PaymentError } from '../errors/payment-error';
import { PaymentResult } from '../models';
import type { GooglePayNamespace, GooglePayPaymentsClient } from '../adapters/google-pay/google-pay.types';

const PRODUCT_A = { id: 'plan-a', name: 'Plan A', amount: 10, currency: 'USD', quantity: 1 };
const PRODUCT_B = { id: 'plan-b', name: 'Plan B', amount: 20, currency: 'USD', quantity: 1 };

type Handler = (event?: unknown) => unknown;

interface FakeEce {
  handlers: Map<string, Handler>;
  on: jasmine.Spy;
  mount: jasmine.Spy;
  unmount: jasmine.Spy;
  destroy: jasmine.Spy;
}

describe('Multi-instance wallet concurrency', () => {
  describe('Apple Pay (per-mount ECE)', () => {
    let adapter: ApplePayAdapter;
    let backend: jasmine.SpyObj<BackendService>;
    let eces: FakeEce[];
    let stripeMock: { elements: jasmine.Spy; confirmPayment: jasmine.Spy };

    function createEce(): FakeEce {
      const ece: FakeEce = {
        handlers: new Map(),
        on: jasmine.createSpy('on'),
        mount: jasmine.createSpy('mount'),
        unmount: jasmine.createSpy('unmount'),
        destroy: jasmine.createSpy('destroy'),
      };
      ece.on.and.callFake((name: string, handler: Handler) => {
        ece.handlers.set(name, handler);
        return ece;
      });
      ece.mount.and.callFake(() => {
        ece.handlers.get('ready')?.({ availablePaymentMethods: { applePay: true } });
      });
      eces.push(ece);
      return ece;
    }

    function mountOptions(product: typeof PRODUCT_A) {
      return {
        product,
        theme: 'light' as const,
        onSuccess: jasmine.createSpy('onSuccess'),
        onCancel: jasmine.createSpy('onCancel'),
        onError: jasmine.createSpy('onError'),
        onAttempt: jasmine.createSpy('onAttempt'),
      };
    }

    beforeEach(async () => {
      eces = [];
      stripeMock = {
        elements: jasmine.createSpy('elements').and.callFake(() => ({
          create: () => createEce(),
          submit: jasmine.createSpy('submit').and.resolveTo({ error: undefined }),
        })),
        confirmPayment: jasmine.createSpy('confirmPayment').and.resolveTo({
          error: undefined,
          paymentIntent: { id: 'pi_apple', status: 'succeeded' },
        }),
      };
      backend = jasmine.createSpyObj<BackendService>('BackendService', ['createStripePayment']);
      backend.createStripePayment.and.resolveTo({
        provider: 'stripe',
        clientSecret: 'pi_apple_secret',
        paymentIntentId: 'pi_apple',
      });
      const stripeSdk = jasmine.createSpyObj<StripeSdkLoader>('StripeSdkLoader', ['load']);
      stripeSdk.load.and.resolveTo(stripeMock as never);

      TestBed.configureTestingModule({
        providers: [
          { provide: PLATFORM_ID, useValue: 'browser' },
          provideEasyPayments({
            enableMockMode: false,
            providers: {
              stripe: { publishableKey: 'pk_test_123' },
              applePay: { merchantName: 'Demo', countryCode: 'US' },
            },
            backend: { createPaymentUrl: '/api/payments/create' },
          }),
          { provide: BackendService, useValue: backend },
          { provide: StripeSdkLoader, useValue: stripeSdk },
        ],
      });
      adapter = TestBed.inject(ApplePayAdapter);
      await adapter.initialize();
    });

    it('notifies every registered host listener and removal is per host', async () => {
      const first = jasmine.createSpy('first');
      const second = jasmine.createSpy('second');
      const removeFirst = adapter.addAvailabilityListener(first);
      adapter.addAvailabilityListener(second);

      await adapter.mountExpressCheckout(document.createElement('div'), mountOptions(PRODUCT_A), 'm-a');
      expect(first).toHaveBeenCalledWith('available');
      expect(second).toHaveBeenCalledWith('available');

      removeFirst();
      first.calls.reset();
      second.calls.reset();
      await adapter.mountExpressCheckout(document.createElement('div'), mountOptions(PRODUCT_B), 'm-b');
      expect(first).not.toHaveBeenCalled();
      expect(second).toHaveBeenCalledWith('available');
    });

    it('adapter re-initialization does not drop per-host listeners', async () => {
      const listener = jasmine.createSpy('listener');
      adapter.addAvailabilityListener(listener);
      await adapter.destroy();
      await adapter.initialize();
      await adapter.mountExpressCheckout(document.createElement('div'), mountOptions(PRODUCT_A), 'm-a');
      expect(listener).toHaveBeenCalledWith('available');
    });

    it('keeps availability per product session (no cross-host leak or ping-pong)', async () => {
      await adapter.mountExpressCheckout(document.createElement('div'), mountOptions(PRODUCT_A), 'm-a');
      expect(await adapter.isAvailable({ product: PRODUCT_A, theme: 'light' })).toBeTrue();

      const listener = jasmine.createSpy('listener');
      adapter.addAvailabilityListener(listener);

      // Host B (different product) is still checking — host A must stay available.
      expect(await adapter.isAvailable({ product: PRODUCT_B, theme: 'light' })).toBeFalse();
      expect(adapter.getAvailabilityStatus(PRODUCT_B)).toBe('checking');
      expect(adapter.getAvailabilityStatus(PRODUCT_A)).toBe('available');
      expect(await adapter.isAvailable({ product: PRODUCT_A, theme: 'light' })).toBeTrue();

      // Re-checking the same sessions does not re-notify (no refresh loop between hosts).
      listener.calls.reset();
      await adapter.isAvailable({ product: PRODUCT_B, theme: 'light' });
      await adapter.isAvailable({ product: PRODUCT_A, theme: 'light' });
      await adapter.isAvailable({ product: PRODUCT_B, theme: 'light' });
      expect(listener).toHaveBeenCalledTimes(0);
    });

    it('clearAvailability(product) only clears that checkout session', async () => {
      await adapter.mountExpressCheckout(document.createElement('div'), mountOptions(PRODUCT_A), 'm-a');
      await adapter.mountExpressCheckout(document.createElement('div'), mountOptions(PRODUCT_B), 'm-b');
      adapter.clearAvailability(PRODUCT_A);
      expect(adapter.getAvailabilityStatus(PRODUCT_A)).toBe('idle');
      expect(adapter.getAvailabilityStatus(PRODUCT_B)).toBe('available');
    });

    it('rejects a concurrent wallet confirm on another host with feedback on that host only', async () => {
      const optionsA = mountOptions(PRODUCT_A);
      const optionsB = mountOptions(PRODUCT_B);
      await adapter.mountExpressCheckout(document.createElement('div'), optionsA, 'm-a');
      await adapter.mountExpressCheckout(document.createElement('div'), optionsB, 'm-b');
      const [eceA, eceB] = eces;

      let resolveCreate!: (value: unknown) => void;
      backend.createStripePayment.and.returnValue(
        new Promise((resolve) => {
          resolveCreate = resolve;
        }) as never,
      );

      const confirmA = eceA.handlers.get('confirm')!({ paymentFailed: jasmine.createSpy('failA') });
      expect(adapter.isProcessing('m-a')).toBeTrue();
      expect(adapter.isProcessing('m-b')).toBeFalse();

      const paymentFailedB = jasmine.createSpy('paymentFailedB');
      await eceB.handlers.get('confirm')!({ paymentFailed: paymentFailedB });
      expect(paymentFailedB).toHaveBeenCalledWith({ reason: 'fail' });
      expect(optionsB.onError).toHaveBeenCalledWith(
        jasmine.objectContaining({ code: 'PROVIDER_UNAVAILABLE', method: 'apple-pay' }),
      );
      expect(optionsB.onAttempt).not.toHaveBeenCalled();
      expect(optionsA.onError).not.toHaveBeenCalled();

      // Cancel on B must not clear A's in-flight flag.
      eceB.handlers.get('cancel')!();
      expect(adapter.isProcessing('m-a')).toBeTrue();

      resolveCreate({ provider: 'stripe', clientSecret: 'pi_a_secret', paymentIntentId: 'pi_a' });
      await confirmA;
      expect(optionsA.onSuccess).toHaveBeenCalledTimes(1);
      expect(optionsB.onSuccess).not.toHaveBeenCalled();
      expect(TestBed.inject(StripeConfirmationGate).isHeld()).toBeFalse();
    });

    it('ignores late confirm callbacks after a host unmounts', async () => {
      const options = mountOptions(PRODUCT_A);
      await adapter.mountExpressCheckout(document.createElement('div'), options, 'm-a');
      const confirm = eces[0].handlers.get('confirm')!;
      adapter.unmountExpressCheckout({ mountId: 'm-a' });
      await confirm({});
      expect(options.onAttempt).not.toHaveBeenCalled();
      expect(backend.createStripePayment).not.toHaveBeenCalled();
    });

    it('reports a processing wallet PaymentIntent as processing (never success)', async () => {
      stripeMock.confirmPayment.and.resolveTo({
        error: undefined,
        paymentIntent: { id: 'pi_apple', status: 'processing' },
      });
      const options = mountOptions(PRODUCT_A);
      await adapter.mountExpressCheckout(document.createElement('div'), options, 'm-a');
      await eces[0].handlers.get('confirm')!({});
      expect(options.onError).not.toHaveBeenCalled();
      expect(options.onSuccess).toHaveBeenCalledWith(
        jasmine.objectContaining({ status: 'processing', method: 'apple-pay' }),
      );
    });
  });

  describe('Google Pay (shared sheet)', () => {
    let adapter: GooglePayAdapter;
    let backend: jasmine.SpyObj<BackendService>;
    let paymentsClient: jasmine.SpyObj<GooglePayPaymentsClient>;

    beforeEach(async () => {
      paymentsClient = jasmine.createSpyObj<GooglePayPaymentsClient>('PaymentsClient', [
        'isReadyToPay',
        'loadPaymentData',
        'createButton',
      ]);
      paymentsClient.isReadyToPay.and.resolveTo({ result: true });
      paymentsClient.loadPaymentData.and.resolveTo({
        paymentMethodData: { tokenizationData: { token: JSON.stringify({ id: 'tok' }) } },
      } as never);
      const googleNs = {
        payments: { api: { PaymentsClient: jasmine.createSpy().and.returnValue(paymentsClient) } },
      } as unknown as GooglePayNamespace;
      const googlePaySdk = jasmine.createSpyObj<GooglePaySdkLoader>('GooglePaySdkLoader', ['load']);
      googlePaySdk.load.and.resolveTo(googleNs);
      const stripeSdk = jasmine.createSpyObj<StripeSdkLoader>('StripeSdkLoader', ['load']);
      stripeSdk.load.and.resolveTo({
        createPaymentMethod: jasmine.createSpy().and.resolveTo({ paymentMethod: { id: 'pm_1' } }),
        confirmCardPayment: jasmine
          .createSpy()
          .and.resolveTo({ paymentIntent: { id: 'pi_g', status: 'processing' } }),
      } as never);
      backend = jasmine.createSpyObj<BackendService>('BackendService', ['createStripePayment']);

      TestBed.configureTestingModule({
        providers: [
          { provide: PLATFORM_ID, useValue: 'browser' },
          provideEasyPayments({
            enableMockMode: false,
            providers: {
              stripe: { publishableKey: 'pk_test_123' },
              googlePay: { environment: 'TEST', merchantName: 'Demo' },
            },
            backend: { createPaymentUrl: '/api/payments/create' },
          }),
          { provide: BackendService, useValue: backend },
          { provide: GooglePaySdkLoader, useValue: googlePaySdk },
          { provide: StripeSdkLoader, useValue: stripeSdk },
        ],
      });
      adapter = TestBed.inject(GooglePayAdapter);
      await adapter.initialize();
    });

    it('rejects a second host before any PaymentIntent is created; busy state is per host', async () => {
      let resolveCreate!: (value: unknown) => void;
      backend.createStripePayment.and.returnValue(
        new Promise((resolve) => {
          resolveCreate = resolve;
        }) as never,
      );

      const first = adapter.payWithGooglePay(PRODUCT_A, undefined, 'gpay-a');
      expect(adapter.isProcessing('gpay-a')).toBeTrue();
      expect(adapter.isProcessing('gpay-b')).toBeFalse();

      await expectAsync(adapter.payWithGooglePay(PRODUCT_B, undefined, 'gpay-b')).toBeRejectedWith(
        jasmine.objectContaining({ code: 'PROVIDER_UNAVAILABLE', method: 'google-pay' }),
      );
      expect(backend.createStripePayment).toHaveBeenCalledTimes(1);

      resolveCreate({ provider: 'stripe', clientSecret: 'pi_g_secret', paymentIntentId: 'pi_g' });
      const result = await first;
      expect(result.status).toBe('processing');
      expect(adapter.isProcessing()).toBeFalse();
      expect(TestBed.inject(StripeConfirmationGate).isHeld()).toBeFalse();
    });
  });

  describe('PayPal (per-owner order guards)', () => {
    let adapter: PayPalAdapter;
    let backend: jasmine.SpyObj<BackendService>;

    beforeEach(async () => {
      backend = jasmine.createSpyObj<BackendService>('BackendService', [
        'createPayPalOrder',
        'capturePayPalOrder',
      ]);
      const sdkLoader = jasmine.createSpyObj<SdkLoaderService>('SdkLoaderService', [
        'loadScript',
        'unloadScript',
      ]);
      TestBed.configureTestingModule({
        providers: [
          { provide: PLATFORM_ID, useValue: 'browser' },
          provideEasyPayments({
            enableMockMode: false,
            providers: { paypal: { clientId: 'sb-client', currency: 'USD', intent: 'capture' } },
            backend: {
              paypalCreateOrderUrl: '/api/paypal/create',
              paypalCaptureOrderUrl: '/api/paypal/capture',
            },
          }),
          { provide: BackendService, useValue: backend },
          { provide: SdkLoaderService, useValue: sdkLoader },
        ],
      });
      adapter = TestBed.inject(PayPalAdapter);
      await adapter.initialize();
    });

    it('lets two hosts create orders at the same time and keeps busy state per host', async () => {
      const resolvers: ((value: { orderId: string }) => void)[] = [];
      backend.createPayPalOrder.and.callFake(
        () => new Promise((resolve) => resolvers.push(resolve)) as never,
      );

      const orderA = adapter.createOrder(PRODUCT_A, undefined, 'pp-a');
      const orderB = adapter.createOrder(PRODUCT_B, undefined, 'pp-b');
      expect(adapter.isBusy('pp-a')).toBeTrue();
      expect(adapter.isBusy('pp-b')).toBeTrue();
      expect(adapter.isBusy('pp-c')).toBeFalse();

      resolvers[1]({ orderId: 'ORDER-B' });
      resolvers[0]({ orderId: 'ORDER-A' });
      expect(await orderA).toBe('ORDER-A');
      expect(await orderB).toBe('ORDER-B');
      expect(adapter.isBusy()).toBeFalse();
    });

    it('captures two different orders concurrently but never the same order twice', async () => {
      const resolvers = new Map<string, (value: unknown) => void>();
      backend.capturePayPalOrder.and.callFake(
        (orderId: string) => new Promise((resolve) => resolvers.set(orderId, resolve)) as never,
      );

      const captureA = adapter.captureOrder('ORDER-A');
      const captureB = adapter.captureOrder('ORDER-B');
      await expectAsync(adapter.captureOrder('ORDER-A')).toBeRejectedWith(jasmine.any(PaymentError));
      expect(adapter.isBusy(undefined, 'ORDER-A')).toBeTrue();
      expect(adapter.isBusy('pp-x', 'ORDER-C')).toBeFalse();

      resolvers.get('ORDER-B')!({ captureId: 'CAP-B', orderId: 'ORDER-B', status: 'COMPLETED' });
      resolvers.get('ORDER-A')!({ captureId: 'CAP-A', orderId: 'ORDER-A', status: 'COMPLETED' });
      const [a, b] = (await Promise.all([captureA, captureB])) as [PaymentResult, PaymentResult];
      expect(a.sessionId).toBe('ORDER-A');
      expect(b.sessionId).toBe('ORDER-B');
      expect(backend.capturePayPalOrder).toHaveBeenCalledTimes(2);
    });
  });
});
