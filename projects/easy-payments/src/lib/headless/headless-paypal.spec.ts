import { TestBed } from '@angular/core/testing';
import { provideHttpClient, withXhr } from '@angular/common/http';
import { PLATFORM_ID } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { provideEasyPayments } from '../config/provide-easy-payments';
import { BackendService } from '../services/backend.service';
import { PaymentError } from '../errors/payment-error';
import type { PaymentProduct, PaymentResult } from '../models';
import { StripeCardAdapter } from '../adapters/stripe/stripe-card.adapter';
import { PayPalAdapter } from '../adapters/paypal/paypal.adapter';
import type { PayPalButtonsOptions, PayPalNamespace } from '../adapters/paypal/paypal.types';
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

describe('HeadlessCheckoutSession PayPal (H3.3)', () => {
  let headless: EasyPaymentsHeadless;
  let registry: HeadlessSessionRegistry;
  let backend: jasmine.SpyObj<BackendService>;
  let paypal: PayPalAdapter;
  let stripeCard: StripeCardAdapter;
  let sdkLoader: jasmine.SpyObj<SdkLoaderService>;
  let stripeSdkLoader: jasmine.SpyObj<StripeSdkLoader>;

  let lastButtonsOptions: PayPalButtonsOptions | null;
  let renderSpy: jasmine.Spy;
  let closeSpy: jasmine.Spy;
  let buttonsFactory: jasmine.Spy;

  const stripeMount = jasmine.createSpy('stripeMount');
  const stripeElements = jasmine.createSpy('elements').and.callFake(() => ({
    create: () => ({ mount: stripeMount, unmount: jasmine.createSpy('unmount') }),
    submit: jasmine.createSpy('submit').and.resolveTo({ error: undefined }),
    update: jasmine.createSpy('update'),
  }));

  beforeEach(() => {
    lastButtonsOptions = null;
    renderSpy = jasmine.createSpy('render').and.resolveTo(undefined);
    closeSpy = jasmine.createSpy('close').and.resolveTo(undefined);
    buttonsFactory = jasmine.createSpy('Buttons').and.callFake((options: PayPalButtonsOptions) => {
      lastButtonsOptions = options;
      return {
        render: renderSpy,
        close: closeSpy,
        isEligible: () => true,
      };
    });

    const paypalNs: PayPalNamespace = {
      Buttons: buttonsFactory as never,
    };
    (window as Window & { paypal?: PayPalNamespace }).paypal = paypalNs;

    backend = jasmine.createSpyObj<BackendService>('BackendService', [
      'createStripePayment',
      'createKlarnaPayment',
      'createAffirmPayment',
      'createPayPalOrder',
      'capturePayPalOrder',
    ]);
    backend.createStripePayment.and.resolveTo({
      provider: 'stripe',
      clientSecret: 'pi_card_secret',
      paymentIntentId: 'pi_card',
      sessionId: 'sess_card',
    });
    backend.createPayPalOrder.and.resolveTo({
      provider: 'paypal',
      orderId: 'ORDER-1',
    });
    backend.capturePayPalOrder.and.resolveTo({
      provider: 'paypal',
      orderId: 'ORDER-1',
      captureId: 'CAPTURE-1',
      status: 'COMPLETED',
    });

    sdkLoader = jasmine.createSpyObj<SdkLoaderService>('SdkLoaderService', [
      'loadScript',
      'unloadScript',
    ]);
    sdkLoader.loadScript.and.resolveTo(undefined);

    stripeSdkLoader = jasmine.createSpyObj<StripeSdkLoader>('StripeSdkLoader', ['load']);
    stripeSdkLoader.load.and.resolveTo({
      elements: stripeElements,
      confirmPayment: jasmine.createSpy('confirmPayment'),
    } as never);

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withXhr()),
        { provide: PLATFORM_ID, useValue: 'browser' },
        provideEasyPayments({
          enableMockMode: false,
          providers: {
            stripe: { publishableKey: 'pk_test_123456789' },
            paypal: { clientId: 'sb-test' },
            klarna: {},
            affirm: {},
          },
          backend: {
            createPaymentUrl: '/api/payments/create',
            klarnaCreatePaymentUrl: '/api/payments/klarna',
            affirmCreatePaymentUrl: '/api/payments/affirm',
            paypalCreateOrderUrl: '/api/paypal/create',
            paypalCaptureOrderUrl: '/api/paypal/capture',
          },
        }),
        { provide: BackendService, useValue: backend },
        { provide: SdkLoaderService, useValue: sdkLoader },
        { provide: StripeSdkLoader, useValue: stripeSdkLoader },
      ],
    });

    headless = TestBed.inject(EasyPaymentsHeadless);
    registry = TestBed.inject(HeadlessSessionRegistry);
    paypal = TestBed.inject(PayPalAdapter);
    stripeCard = TestBed.inject(StripeCardAdapter);
    registry.clearForTests();
    TestBed.inject(StripeRedirectRecoveryService).resetForTests();
  });

  afterEach(() => {
    registry.clearForTests();
    TestBed.inject(StripeRedirectRecoveryService).resetForTests();
    delete (window as Window & { paypal?: PayPalNamespace }).paypal;
  });

  async function readySession(
    overrides: Partial<Parameters<EasyPaymentsHeadless['createSession']>[0]> = {},
  ): Promise<HeadlessCheckoutSession> {
    const session = headless.createSession({
      product: overrides.product ?? PRODUCT,
      methods: overrides.methods ?? ['paypal', 'card'],
      checkoutInstanceId:
        overrides.checkoutInstanceId ?? `pp-${Math.random().toString(36).slice(2, 8)}`,
      checkout: overrides.checkout,
      locale: overrides.locale,
      theme: overrides.theme,
    });
    await session.initialize();
    return session;
  }

  it('mounts official PayPal Buttons into a merchant container', async () => {
    const session = await readySession();
    const host = document.createElement('div');
    const handle = await session.mount('paypal', host);

    expect(sdkLoader.loadScript).toHaveBeenCalled();
    expect(buttonsFactory).toHaveBeenCalled();
    expect(renderSpy).toHaveBeenCalledWith(host);
    expect(handle.method).toBe('paypal');
    expect(session.selectedMethod()).toBe('paypal');
    expect(paypal.getActiveButtonMountCount()).toBe(1);
    await session.destroy();
  });

  it('rejects an invalid mount container', async () => {
    const session = await readySession();
    await expectAsync(session.mount('paypal', null as never)).toBeRejectedWith(
      jasmine.objectContaining({ code: 'CONFIG_INVALID' }),
    );
    await session.destroy();
  });

  it('rejects mount when PayPal is unavailable', async () => {
    const session = headless.createSession({
      product: PRODUCT,
      methods: ['paypal'],
      checkoutInstanceId: 'pp-unavail',
    });
    const { EasyPaymentsConfigService } = await import('../config/easy-payments-config.service');
    TestBed.inject(EasyPaymentsConfigService).replace({
      enableMockMode: false,
      providers: {},
      backend: {},
    });
    await session.initialize();
    await expectAsync(session.mount('paypal', document.createElement('div'))).toBeRejectedWith(
      jasmine.objectContaining({ code: 'PROVIDER_UNAVAILABLE' }),
    );
    await session.destroy();
  });

  it('surfaces SDK load failure', async () => {
    sdkLoader.loadScript.and.rejectWith(new Error('blocked'));
    delete (window as Window & { paypal?: PayPalNamespace }).paypal;
    const session = await readySession({ methods: ['paypal'] });
    await expectAsync(session.mount('paypal', document.createElement('div'))).toBeRejectedWith(
      jasmine.objectContaining({ code: 'SDK_LOAD_FAILED' }),
    );
    await session.destroy();
  });

  it('cleans up after Buttons render failure', async () => {
    renderSpy.and.rejectWith(new Error('render failed'));
    const session = await readySession({ methods: ['paypal'] });
    await expectAsync(session.mount('paypal', document.createElement('div'))).toBeRejected();
    expect(paypal.getActiveButtonMountCount()).toBe(0);
    await session.destroy();
  });

  it('creates a backend order from the Buttons createOrder callback', async () => {
    const session = await readySession({ methods: ['paypal'] });
    await session.mount('paypal', document.createElement('div'));
    expect(lastButtonsOptions).toBeTruthy();

    const started = firstValueFrom(session.events.started);
    const orderId = await lastButtonsOptions!.createOrder();
    expect(orderId).toBe('ORDER-1');
    expect(backend.createPayPalOrder).toHaveBeenCalled();
    await expectAsync(started).toBeResolvedTo(
      jasmine.objectContaining({ method: 'paypal', provider: 'paypal', amount: 99 }),
    );
    expect(session.state()).toBe('processing');
    await session.destroy();
  });

  it('emits error when backend order creation fails', async () => {
    backend.createPayPalOrder.and.rejectWith(
      new PaymentError({
        code: 'BACKEND_ERROR',
        message: 'create failed',
        method: 'paypal',
        provider: 'paypal',
      }),
    );
    const session = await readySession({ methods: ['paypal'] });
    await session.mount('paypal', document.createElement('div'));
    const error = firstValueFrom(session.events.error);
    await expectAsync(lastButtonsOptions!.createOrder()).toBeRejectedWith(
      jasmine.objectContaining({ code: 'BACKEND_ERROR' }),
    );
    await expectAsync(error).toBeResolvedTo(
      jasmine.objectContaining({ code: 'BACKEND_ERROR' }),
    );
    expect(session.state()).toBe('ready');
    await session.destroy();
  });

  it('captures on approval and emits success', async () => {
    const session = await readySession({ methods: ['paypal'] });
    await session.mount('paypal', document.createElement('div'));
    await lastButtonsOptions!.createOrder();
    const success = firstValueFrom(session.events.success);
    await lastButtonsOptions!.onApprove({ orderID: 'ORDER-1' });
    await expectAsync(success).toBeResolvedTo(
      jasmine.objectContaining({
        status: 'success',
        method: 'paypal',
        transactionId: 'CAPTURE-1',
      }),
    );
    expect(backend.capturePayPalOrder).toHaveBeenCalledWith('ORDER-1');
    expect(session.state()).toBe('success');
    await session.destroy();
  });

  it('maps pending capture results without treating them as success', async () => {
    const pendingResult: PaymentResult = {
      status: 'processing',
      method: 'paypal',
      provider: 'paypal',
      message: 'Capture pending',
      sessionId: 'ORDER-1',
    };
    spyOn(paypal, 'captureOrder').and.resolveTo(pendingResult);
    const session = await readySession({ methods: ['paypal'] });
    await session.mount('paypal', document.createElement('div'));
    await lastButtonsOptions!.createOrder();
    const pending = firstValueFrom(session.events.pending);
    await lastButtonsOptions!.onApprove({ orderID: 'ORDER-1' });
    await expectAsync(pending).toBeResolvedTo(
      jasmine.objectContaining({ status: 'processing' }),
    );
    expect(session.state()).toBe('pending');
    await session.destroy();
  });

  it('emits error when capture fails', async () => {
    backend.capturePayPalOrder.and.rejectWith(
      new PaymentError({
        code: 'PAYMENT_FAILED',
        message: 'capture failed',
        method: 'paypal',
        provider: 'paypal',
      }),
    );
    const session = await readySession({ methods: ['paypal'] });
    await session.mount('paypal', document.createElement('div'));
    await lastButtonsOptions!.createOrder();
    const error = firstValueFrom(session.events.error);
    await lastButtonsOptions!.onApprove({ orderID: 'ORDER-1' });
    await expectAsync(error).toBeResolvedTo(
      jasmine.objectContaining({ code: 'PAYMENT_FAILED' }),
    );
    expect(session.state()).toBe('ready');
    await session.destroy();
  });

  it('emits cancel on buyer cancellation', async () => {
    const session = await readySession({ methods: ['paypal'] });
    await session.mount('paypal', document.createElement('div'));
    await lastButtonsOptions!.createOrder();
    const cancel = firstValueFrom(session.events.cancel);
    lastButtonsOptions!.onCancel?.();
    await expectAsync(cancel).toBeResolvedTo(
      jasmine.objectContaining({ status: 'cancelled', method: 'paypal' }),
    );
    await Promise.resolve();
    expect(session.state()).toBe('ready');
    await session.destroy();
  });

  it('emits error from SDK onError callback', async () => {
    const session = await readySession({ methods: ['paypal'] });
    await session.mount('paypal', document.createElement('div'));
    const error = firstValueFrom(session.events.error);
    lastButtonsOptions!.onError?.(new Error('sdk boom'));
    await expectAsync(error).toBeResolved();
    await Promise.resolve();
    expect(session.state()).toBe('ready');
    await session.destroy();
  });

  it('rejects duplicate createOrder while one is in flight', async () => {
    let releaseCreate!: () => void;
    backend.createPayPalOrder.and.returnValue(
      new Promise((resolve) => {
        releaseCreate = () => resolve({ provider: 'paypal', orderId: 'ORDER-1' });
      }),
    );
    const session = await readySession({ methods: ['paypal'] });
    await session.mount('paypal', document.createElement('div'));
    const first = lastButtonsOptions!.createOrder();
    await expectAsync(lastButtonsOptions!.createOrder()).toBeRejectedWith(
      jasmine.objectContaining({ message: jasmine.stringMatching(/already being created/) }),
    );
    releaseCreate();
    await first;
    await session.destroy();
  });

  it('ignores duplicate approval callbacks', async () => {
    const session = await readySession({ methods: ['paypal'] });
    await session.mount('paypal', document.createElement('div'));
    await lastButtonsOptions!.createOrder();
    const success = firstValueFrom(session.events.success);
    await lastButtonsOptions!.onApprove({ orderID: 'ORDER-1' });
    await success;
    const captures = backend.capturePayPalOrder.calls.count();
    await lastButtonsOptions!.onApprove({ orderID: 'ORDER-1' });
    expect(backend.capturePayPalOrder.calls.count()).toBe(captures);
    await session.destroy();
  });

  it('ignores stale callbacks after unmount', async () => {
    const session = await readySession({ methods: ['paypal'] });
    const handle = await session.mount('paypal', document.createElement('div'));
    const options = lastButtonsOptions!;
    handle.unmount();
    await expectAsync(options.createOrder()).toBeRejectedWith(
      jasmine.objectContaining({ message: jasmine.stringMatching(/superseded/) }),
    );
    const success = firstValueFrom(session.events.success);
    await options.onApprove({ orderID: 'ORDER-1' });
    // Must not resolve success from stale mount.
    await Promise.race([
      success.then(() => {
        throw new Error('stale success');
      }),
      Promise.resolve(),
    ]);
    expect(session.state()).not.toBe('success');
    await session.destroy();
  });

  it('ignores stale callbacks after remount', async () => {
    const session = await readySession({ methods: ['paypal'] });
    await session.mount('paypal', document.createElement('div'));
    const firstOptions = lastButtonsOptions!;
    await session.mount('paypal', document.createElement('div'));
    const secondOptions = lastButtonsOptions!;
    expect(secondOptions).not.toBe(firstOptions);

    await expectAsync(firstOptions.createOrder()).toBeRejectedWith(
      jasmine.objectContaining({ message: jasmine.stringMatching(/superseded/) }),
    );

    const orderId = await secondOptions.createOrder();
    expect(orderId).toBe('ORDER-1');
    await session.destroy();
  });

  it('ignores create/capture outcomes after destroy', async () => {
    let releaseCreate!: (value: { provider: 'paypal'; orderId: string }) => void;
    backend.createPayPalOrder.and.returnValue(
      new Promise((resolve) => {
        releaseCreate = resolve;
      }),
    );
    const session = await readySession({
      checkoutInstanceId: 'pp-destroy-create',
      methods: ['paypal'],
    });
    await session.mount('paypal', document.createElement('div'));
    const pendingCreate = lastButtonsOptions!.createOrder();
    await session.destroy();
    releaseCreate({ provider: 'paypal', orderId: 'ORDER-X' });
    await expectAsync(pendingCreate).toBeRejected();
    expect(session.state()).toBe('destroyed');
  });

  it('ignores capture after destroy during capture', async () => {
    let releaseCapture!: (value: {
      provider: 'paypal';
      orderId: string;
      captureId: string;
      status: string;
    }) => void;
    backend.capturePayPalOrder.and.returnValue(
      new Promise((resolve) => {
        releaseCapture = resolve;
      }),
    );
    const session = await readySession({
      checkoutInstanceId: 'pp-destroy-capture',
      methods: ['paypal'],
    });
    await session.mount('paypal', document.createElement('div'));
    await lastButtonsOptions!.createOrder();
    const pendingApprove = lastButtonsOptions!.onApprove({ orderID: 'ORDER-1' });
    await session.destroy();
    releaseCapture({
      provider: 'paypal',
      orderId: 'ORDER-1',
      captureId: 'CAP',
      status: 'COMPLETED',
    });
    await pendingApprove;
    expect(session.state()).toBe('destroyed');
    expect(session.lastResult()).toBeNull();
  });

  it('keeps independent PayPal sessions isolated', async () => {
    const a = await readySession({ checkoutInstanceId: 'pp-iso-a', methods: ['paypal'] });
    const b = await readySession({ checkoutInstanceId: 'pp-iso-b', methods: ['paypal'] });
    await a.mount('paypal', document.createElement('div'));
    const optionsA = lastButtonsOptions!;
    await b.mount('paypal', document.createElement('div'));
    expect(paypal.getActiveButtonMountCount()).toBe(2);

    await a.destroy();
    expect(paypal.getActiveButtonMountCount()).toBe(1);
    expect(b.state()).not.toBe('destroyed');

    await optionsA.createOrder().catch(() => undefined);
    const orderId = await lastButtonsOptions!.createOrder();
    expect(orderId).toBe('ORDER-1');
    await b.destroy();
  });

  it('switches PayPal ? Card and Card ? PayPal without leaking mounts', async () => {
    const session = await readySession();
    await session.mount('paypal', document.createElement('div'));
    expect(paypal.getActiveButtonMountCount()).toBe(1);

    await session.mount('card', document.createElement('div'));
    expect(paypal.getActiveButtonMountCount()).toBe(0);
    expect(stripeCard.hasMountedElement(session.id)).toBeTrue();
    expect(session.selectedMethod()).toBe('card');

    await session.mount('paypal', document.createElement('div'));
    expect(stripeCard.hasMountedElement(session.id)).toBeFalse();
    expect(paypal.getActiveButtonMountCount()).toBe(1);
    expect(session.selectedMethod()).toBe('paypal');
    await session.destroy();
  });

  it('rejects session.confirm() for PayPal', async () => {
    const session = await readySession({ methods: ['paypal'] });
    await session.mount('paypal', document.createElement('div'));
    await expectAsync(session.confirm()).toBeRejectedWith(
      jasmine.objectContaining({
        code: 'CONFIG_INVALID',
        message: jasmine.stringMatching(/official PayPal Buttons/),
      }),
    );
    await session.destroy();
  });

  it('supports idempotent PayPal unmount and cleanup on destroy', async () => {
    const session = await readySession({
      checkoutInstanceId: 'pp-cleanup',
      methods: ['paypal'],
    });
    const handle = await session.mount('paypal', document.createElement('div'));
    expect(paypal.getActiveButtonMountCount()).toBe(1);
    handle.unmount();
    handle.unmount();
    expect(paypal.getActiveButtonMountCount()).toBe(0);

    await session.mount('paypal', document.createElement('div'));
    await session.destroy();
    expect(paypal.getActiveButtonMountCount()).toBe(0);
    expect(registry.has('pp-cleanup')).toBeFalse();
  });
});
