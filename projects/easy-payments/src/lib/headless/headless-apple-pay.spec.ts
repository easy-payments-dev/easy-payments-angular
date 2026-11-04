import { TestBed } from '@angular/core/testing';
import { provideHttpClient, withXhr } from '@angular/common/http';
import { PLATFORM_ID } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { provideEasyPayments } from '../config/provide-easy-payments';
import { BackendService } from '../services/backend.service';
import { PaymentError } from '../errors/payment-error';
import type { PaymentProduct } from '../models';
import { StripeCardAdapter } from '../adapters/stripe/stripe-card.adapter';
import { KlarnaAdapter } from '../adapters/klarna/klarna.adapter';
import { AffirmAdapter } from '../adapters/affirm/affirm.adapter';
import { PayPalAdapter } from '../adapters/paypal/paypal.adapter';
import { GooglePayAdapter } from '../adapters/google-pay/google-pay.adapter';
import { GooglePaySdkLoader } from '../adapters/google-pay/google-pay-sdk.loader';
import type {
  GooglePayNamespace,
  GooglePayPaymentsClient,
} from '../adapters/google-pay/google-pay.types';
import { ApplePayAdapter } from '../adapters/apple-pay/apple-pay.adapter';
import { StripeSdkLoader } from '../adapters/stripe/stripe-sdk.loader';
import { SdkLoaderService } from '../loaders/sdk-loader.service';
import type { PayPalNamespace } from '../adapters/paypal/paypal.types';
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

describe('HeadlessCheckoutSession Apple Pay (H3.5)', () => {
  let headless: EasyPaymentsHeadless;
  let registry: HeadlessSessionRegistry;
  let backend: jasmine.SpyObj<BackendService>;
  let applePay: ApplePayAdapter;
  let googlePay: GooglePayAdapter;
  let stripeCard: StripeCardAdapter;
  let klarna: KlarnaAdapter;
  let affirm: AffirmAdapter;
  let paypal: PayPalAdapter;
  let stripeSdk: jasmine.SpyObj<StripeSdkLoader>;
  let googlePaySdk: jasmine.SpyObj<GooglePaySdkLoader>;
  let sdkLoader: jasmine.SpyObj<SdkLoaderService>;

  let expressCheckout: {
    on: jasmine.Spy;
    mount: jasmine.Spy;
    unmount: jasmine.Spy;
    destroy: jasmine.Spy;
  };
  let elements: {
    create: jasmine.Spy;
    submit: jasmine.Spy;
  };
  let confirmPayment: jasmine.Spy;
  let readyPaymentMethods: unknown;

  function emitReadyOnMount(
    availablePaymentMethods: unknown = { applePay: true },
  ): void {
    readyPaymentMethods = availablePaymentMethods;
    expressCheckout.mount.and.callFake(() => {
      const ready = expressCheckout.on.calls
        .allArgs()
        .find((args) => args[0] === 'ready')?.[1] as
        | ((event: { availablePaymentMethods?: unknown }) => void)
        | undefined;
      ready?.({ availablePaymentMethods: readyPaymentMethods });
    });
  }

  function handler(eventType: string): ((...args: unknown[]) => void) | undefined {
    const matches = expressCheckout.on.calls
      .allArgs()
      .filter((args) => args[0] === eventType);
    return matches[matches.length - 1]?.[1] as ((...args: unknown[]) => void) | undefined;
  }

  async function fireConfirm(): Promise<void> {
    const confirm = handler('confirm');
    expect(confirm).toBeTruthy();
    await confirm!({
      paymentFailed: jasmine.createSpy('paymentFailed'),
    });
  }

  beforeEach(async () => {
    expressCheckout = {
      on: jasmine.createSpy('on').and.callFake(() => expressCheckout),
      mount: jasmine.createSpy('mount'),
      unmount: jasmine.createSpy('unmount'),
      destroy: jasmine.createSpy('destroy'),
    };
    elements = {
      create: jasmine.createSpy('create').and.returnValue(expressCheckout),
      submit: jasmine.createSpy('submit').and.resolveTo({ error: undefined }),
    };
    confirmPayment = jasmine.createSpy('confirmPayment').and.resolveTo({
      error: undefined,
      paymentIntent: { id: 'pi_apple', status: 'succeeded' },
    });
    emitReadyOnMount();

    const paymentsClient = jasmine.createSpyObj<GooglePayPaymentsClient>('PaymentsClient', [
      'isReadyToPay',
      'loadPaymentData',
      'createButton',
    ]);
    paymentsClient.isReadyToPay.and.resolveTo({ result: true });
    paymentsClient.createButton.and.callFake(() => {
      const el = document.createElement('button');
      el.type = 'button';
      el.textContent = 'GPay';
      return el;
    });
    const googleNs: GooglePayNamespace = {
      payments: {
        api: {
          PaymentsClient: jasmine
            .createSpy('PaymentsClient')
            .and.returnValue(paymentsClient) as unknown as GooglePayNamespace['payments']['api']['PaymentsClient'],
        },
      },
    };

    backend = jasmine.createSpyObj<BackendService>('BackendService', [
      'createStripePayment',
      'createKlarnaPayment',
      'createAffirmPayment',
      'createPayPalOrder',
      'capturePayPalOrder',
    ]);
    backend.createStripePayment.and.resolveTo({
      provider: 'stripe',
      clientSecret: 'pi_secret',
      paymentIntentId: 'pi_apple',
      sessionId: 'sess_apple',
    });
    backend.createKlarnaPayment.and.resolveTo({
      provider: 'klarna',
      clientSecret: 'pi_klarna_secret',
      paymentIntentId: 'pi_klarna',
      sessionId: 'sess_klarna',
    });
    backend.createAffirmPayment.and.resolveTo({
      provider: 'affirm',
      clientSecret: 'pi_affirm_secret',
      paymentIntentId: 'pi_affirm',
      sessionId: 'sess_affirm',
    });

    stripeSdk = jasmine.createSpyObj<StripeSdkLoader>('StripeSdkLoader', ['load']);
    stripeSdk.load.and.resolveTo({
      elements: jasmine.createSpy('elements').and.callFake((opts?: { mode?: string }) => {
        if (opts?.mode === 'payment') {
          return elements;
        }
        return {
          create: () => ({
            mount: jasmine.createSpy('mount'),
            unmount: jasmine.createSpy('unmount'),
          }),
          submit: jasmine.createSpy('submit').and.resolveTo({ error: undefined }),
          update: jasmine.createSpy('update'),
        };
      }),
      confirmPayment,
      createPaymentMethod: jasmine.createSpy('createPaymentMethod'),
      confirmCardPayment: jasmine.createSpy('confirmCardPayment'),
    } as never);

    googlePaySdk = jasmine.createSpyObj<GooglePaySdkLoader>('GooglePaySdkLoader', ['load']);
    googlePaySdk.load.and.resolveTo(googleNs);

    sdkLoader = jasmine.createSpyObj<SdkLoaderService>('SdkLoaderService', [
      'loadScript',
      'unloadScript',
    ]);
    sdkLoader.loadScript.and.callFake(async () => {
      (window as Window & { paypal?: PayPalNamespace }).paypal = {
        Buttons: jasmine.createSpy('Buttons').and.returnValue({
          render: jasmine.createSpy('render').and.resolveTo(undefined),
          close: jasmine.createSpy('close').and.resolveTo(undefined),
          isEligible: () => true,
        }),
      };
    });

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withXhr()),
        { provide: PLATFORM_ID, useValue: 'browser' },
        provideEasyPayments({
          enableMockMode: false,
          providers: {
            stripe: { publishableKey: 'pk_test_123456789' },
            applePay: {
              merchantName: 'Easy Payments Demo',
              countryCode: 'US',
            },
            googlePay: {
              environment: 'TEST',
              merchantName: 'Easy Payments Demo',
            },
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
        { provide: StripeSdkLoader, useValue: stripeSdk },
        { provide: GooglePaySdkLoader, useValue: googlePaySdk },
        { provide: SdkLoaderService, useValue: sdkLoader },
      ],
    });

    headless = TestBed.inject(EasyPaymentsHeadless);
    registry = TestBed.inject(HeadlessSessionRegistry);
    applePay = TestBed.inject(ApplePayAdapter);
    googlePay = TestBed.inject(GooglePayAdapter);
    stripeCard = TestBed.inject(StripeCardAdapter);
    klarna = TestBed.inject(KlarnaAdapter);
    affirm = TestBed.inject(AffirmAdapter);
    paypal = TestBed.inject(PayPalAdapter);
    registry.clearForTests();
    TestBed.inject(StripeRedirectRecoveryService).resetForTests();
    await applePay.destroy();
  });

  afterEach(async () => {
    registry.clearForTests();
    TestBed.inject(StripeRedirectRecoveryService).resetForTests();
    await applePay.destroy();
    delete (window as Window & { paypal?: PayPalNamespace }).paypal;
  });

  async function readySession(
    overrides: Partial<Parameters<EasyPaymentsHeadless['createSession']>[0]> = {},
  ): Promise<HeadlessCheckoutSession> {
    const session = headless.createSession({
      product: overrides.product ?? PRODUCT,
      methods: overrides.methods ?? ['apple-pay', 'card', 'paypal', 'google-pay'],
      checkoutInstanceId:
        overrides.checkoutInstanceId ?? `ap-${Math.random().toString(36).slice(2, 8)}`,
      checkout: overrides.checkout,
      locale: overrides.locale,
      theme: overrides.theme,
    });
    await session.initialize();
    return session;
  }

  it('mounts the Stripe Express Checkout Element Apple Pay control', async () => {
    const session = await readySession({ methods: ['apple-pay'] });
    const host = document.createElement('div');
    const handle = await session.mount('apple-pay', host);

    expect(expressCheckout.mount).toHaveBeenCalledWith(host);
    expect(handle.method).toBe('apple-pay');
    expect(session.selectedMethod()).toBe('apple-pay');
    expect(applePay.getActiveEceMountCount()).toBe(1);
    expect(applePay.getAvailabilityStatus(PRODUCT)).toBe('available');
    await session.destroy();
  });

  it('rejects when ECE reports Apple Pay unavailable', async () => {
    emitReadyOnMount({ applePay: false });
    const session = await readySession({ methods: ['apple-pay'] });
    await expectAsync(session.mount('apple-pay', document.createElement('div'))).toBeRejectedWith(
      jasmine.objectContaining({ code: 'PROVIDER_UNAVAILABLE' }),
    );
    expect(applePay.getActiveEceMountCount()).toBe(0);
    await session.destroy();
  });

  it('rejects when Apple Pay config is missing', async () => {
    const { EasyPaymentsConfigService } = await import('../config/easy-payments-config.service');
    TestBed.inject(EasyPaymentsConfigService).replace({
      enableMockMode: false,
      providers: { stripe: { publishableKey: 'pk_test_123456789' } },
      backend: { createPaymentUrl: '/api/payments/create' },
    });
    await applePay.initialize();
    const session = headless.createSession({
      product: PRODUCT,
      methods: ['apple-pay'],
      checkoutInstanceId: 'ap-unavail',
    });
    await session.initialize();
    await expectAsync(session.mount('apple-pay', document.createElement('div'))).toBeRejectedWith(
      jasmine.objectContaining({ code: 'PROVIDER_UNAVAILABLE' }),
    );
    await session.destroy();
  });

  it('rejects remount after a definitive unavailable readiness', async () => {
    emitReadyOnMount({ applePay: false });
    const session = await readySession({
      checkoutInstanceId: 'ap-definitive',
      methods: ['apple-pay'],
    });
    await expectAsync(session.mount('apple-pay', document.createElement('div'))).toBeRejectedWith(
      jasmine.objectContaining({ code: 'PROVIDER_UNAVAILABLE' }),
    );
    expect(applePay.getAvailabilityStatus(PRODUCT)).toBe('unavailable');
    expect(applePay.getActiveEceMountCount()).toBe(0);

    await session.refreshAvailability();
    expect(
      session.availableMethods().find((entry) => entry.method === 'apple-pay')?.readiness,
    ).toBe('unavailable');

    const mountSpy = spyOn(applePay, 'mountExpressCheckout').and.callThrough();
    await expectAsync(session.mount('apple-pay', document.createElement('div'))).toBeRejectedWith(
      jasmine.objectContaining({ code: 'PROVIDER_UNAVAILABLE' }),
    );
    expect(mountSpy).not.toHaveBeenCalled();
    expect(applePay.getActiveEceMountCount()).toBe(0);
    await session.destroy();
  });

  it('rejects an invalid mount container', async () => {
    const session = await readySession({ methods: ['apple-pay'] });
    await expectAsync(session.mount('apple-pay', null as never)).toBeRejectedWith(
      jasmine.objectContaining({ code: 'CONFIG_INVALID' }),
    );
    await session.destroy();
  });

  it('surfaces Stripe SDK load failure', async () => {
    stripeSdk.load.and.rejectWith(new Error('stripe.js blocked'));
    const session = await readySession({ methods: ['apple-pay'] });
    await expectAsync(session.mount('apple-pay', document.createElement('div'))).toBeRejected();
    expect(applePay.getActiveEceMountCount()).toBe(0);
    await session.destroy();
  });

  it('cleans up after ECE loaderror during mount', async () => {
    expressCheckout.mount.and.callFake(() => {
      const loaderror = handler('loaderror');
      loaderror?.({ error: { message: 'ece load failed' } });
    });
    const session = await readySession({ methods: ['apple-pay'] });
    await expectAsync(session.mount('apple-pay', document.createElement('div'))).toBeRejected();
    expect(applePay.getActiveEceMountCount()).toBe(0);
    await session.destroy();
  });

  it('runs Stripe confirmation after buyer authorize and emits success', async () => {
    const session = await readySession({ methods: ['apple-pay'] });
    await session.mount('apple-pay', document.createElement('div'));

    const started = firstValueFrom(session.events.started);
    const success = firstValueFrom(session.events.success);
    await fireConfirm();

    await expectAsync(started).toBeResolvedTo(
      jasmine.objectContaining({ method: 'apple-pay', provider: 'applePay', amount: 99 }),
    );
    await expectAsync(success).toBeResolvedTo(
      jasmine.objectContaining({ status: 'success', method: 'apple-pay', transactionId: 'pi_apple' }),
    );
    expect(backend.createStripePayment).toHaveBeenCalled();
    expect(confirmPayment).toHaveBeenCalled();
    expect(session.state()).toBe('success');
    await session.destroy();
  });

  it('maps pending processor results without treating them as success', async () => {
    confirmPayment.and.resolveTo({
      error: undefined,
      paymentIntent: { id: 'pi_apple', status: 'processing' },
    });
    const session = await readySession({ methods: ['apple-pay'] });
    await session.mount('apple-pay', document.createElement('div'));
    const pending = firstValueFrom(session.events.pending);
    await fireConfirm();
    await expectAsync(pending).toBeResolvedTo(
      jasmine.objectContaining({ status: 'processing', method: 'apple-pay' }),
    );
    expect(session.state()).toBe('pending');
    await session.destroy();
  });

  it('emits cancel when the buyer cancels Apple Pay', async () => {
    const session = await readySession({ methods: ['apple-pay'] });
    await session.mount('apple-pay', document.createElement('div'));
    const cancel = firstValueFrom(session.events.cancel);
    handler('cancel')?.();
    await expectAsync(cancel).toBeResolvedTo(
      jasmine.objectContaining({ status: 'cancelled', method: 'apple-pay' }),
    );
    await Promise.resolve();
    expect(session.state()).toBe('ready');
    await session.destroy();
  });

  it('emits error on authorization / processor failure', async () => {
    confirmPayment.and.resolveTo({
      error: { message: 'card declined', code: 'card_declined' },
    });
    const session = await readySession({ methods: ['apple-pay'] });
    await session.mount('apple-pay', document.createElement('div'));
    const error = firstValueFrom(session.events.error);
    await fireConfirm();
    await expectAsync(error).toBeResolved();
    await Promise.resolve();
    expect(session.state()).toBe('ready');
    expect(session.lastResult()?.status).not.toBe('success');
    await session.destroy();
  });

  it('protects against concurrent confirm callbacks', async () => {
    let releaseConfirm!: () => void;
    confirmPayment.and.returnValue(
      new Promise((resolve) => {
        releaseConfirm = () =>
          resolve({
            error: undefined,
            paymentIntent: { id: 'pi_apple', status: 'succeeded' },
          });
      }),
    );
    const session = await readySession({ methods: ['apple-pay'] });
    await session.mount('apple-pay', document.createElement('div'));

    const first = fireConfirm();
    await Promise.resolve();
    await fireConfirm();
    expect(backend.createStripePayment.calls.count()).toBeLessThanOrEqual(1);

    releaseConfirm();
    await first;
    await session.destroy();
  });

  it('ignores stale callbacks after unmount', async () => {
    const session = await readySession({ methods: ['apple-pay'] });
    const handle = await session.mount('apple-pay', document.createElement('div'));
    const confirm = handler('confirm')!;
    handle.unmount();

    const success = firstValueFrom(session.events.success);
    await confirm({ paymentFailed: jasmine.createSpy('paymentFailed') });
    await Promise.race([
      success.then(() => {
        throw new Error('stale success');
      }),
      Promise.resolve(),
    ]);
    expect(session.state()).not.toBe('success');
    expect(backend.createStripePayment).not.toHaveBeenCalled();
    await session.destroy();
  });

  it('ignores stale callbacks after remount', async () => {
    const session = await readySession({ methods: ['apple-pay'] });
    await session.mount('apple-pay', document.createElement('div'));
    const firstConfirm = handler('confirm')!;
    const firstMountId = applePay.getActiveEceMountCount();
    expect(firstMountId).toBe(1);

    await session.mount('apple-pay', document.createElement('div'));
    const secondConfirm = handler('confirm')!;
    expect(secondConfirm).toBeTruthy();

    await firstConfirm({ paymentFailed: jasmine.createSpy('paymentFailed') });
    expect(backend.createStripePayment).not.toHaveBeenCalled();

    const success = firstValueFrom(session.events.success);
    await secondConfirm({ paymentFailed: jasmine.createSpy('paymentFailed') });
    await expectAsync(success).toBeResolvedTo(
      jasmine.objectContaining({ status: 'success' }),
    );
    await session.destroy();
  });

  it('rejects mount and cleans up when destroyed during ECE initialization', async () => {
    let releaseRender: (() => void) | null = null;
    const realMount = applePay.mountExpressCheckout.bind(applePay);
    spyOn(applePay, 'mountExpressCheckout').and.callFake(async (host, options, mountId) => {
      await new Promise<void>((resolve) => {
        releaseRender = resolve;
      });
      return realMount(host, options, mountId);
    });

    const session = await readySession({
      checkoutInstanceId: 'ap-destroy-load',
      methods: ['apple-pay'],
    });
    const mountPromise = session.mount('apple-pay', document.createElement('div'));
    for (let i = 0; i < 20 && !releaseRender; i += 1) {
      await Promise.resolve();
    }
    expect(releaseRender).toBeTruthy();
    await session.destroy();
    releaseRender!();
    await expectAsync(mountPromise).toBeRejectedWith(
      jasmine.objectContaining({ code: 'PROVIDER_UNAVAILABLE' }),
    );
    expect(session.state()).toBe('destroyed');
    expect(applePay.getActiveEceMountCount()).toBe(0);
  });

  it('ignores outcomes after destroy during confirmation', async () => {
    let releaseConfirm!: () => void;
    confirmPayment.and.returnValue(
      new Promise((resolve) => {
        releaseConfirm = () =>
          resolve({
            error: undefined,
            paymentIntent: { id: 'pi_apple', status: 'succeeded' },
          });
      }),
    );
    const session = await readySession({
      checkoutInstanceId: 'ap-destroy-confirm',
      methods: ['apple-pay'],
    });
    await session.mount('apple-pay', document.createElement('div'));
    const pending = fireConfirm();
    await Promise.resolve();
    await Promise.resolve();
    await session.destroy();
    releaseConfirm();
    await pending;
    expect(session.state()).toBe('destroyed');
    expect(session.lastResult()).toBeNull();
  });

  it('keeps independent Apple Pay sessions isolated', async () => {
    const a = await readySession({ checkoutInstanceId: 'ap-iso-a', methods: ['apple-pay'] });
    const b = await readySession({ checkoutInstanceId: 'ap-iso-b', methods: ['apple-pay'] });
    await a.mount('apple-pay', document.createElement('div'));
    await b.mount('apple-pay', document.createElement('div'));
    expect(applePay.getActiveEceMountCount()).toBe(2);

    await a.destroy();
    expect(applePay.getActiveEceMountCount()).toBe(1);
    expect(b.state()).not.toBe('destroyed');

    const success = firstValueFrom(b.events.success);
    await fireConfirm();
    await expectAsync(success).toBeResolvedTo(
      jasmine.objectContaining({ status: 'success' }),
    );
    await b.destroy();
  });

  it('switches Apple Pay ? Card / PayPal / Google Pay / BNPL without leaking mounts', async () => {
    const session = await readySession({
      methods: ['apple-pay', 'card', 'paypal', 'google-pay', 'klarna', 'affirm'],
    });
    await session.mount('apple-pay', document.createElement('div'));
    expect(applePay.getActiveEceMountCount()).toBe(1);

    await session.mount('card', document.createElement('div'));
    expect(applePay.getActiveEceMountCount()).toBe(0);
    expect(stripeCard.hasMountedElement(session.id)).toBeTrue();

    await session.mount('apple-pay', document.createElement('div'));
    expect(stripeCard.hasMountedElement(session.id)).toBeFalse();
    expect(applePay.getActiveEceMountCount()).toBe(1);

    await session.mount('paypal', document.createElement('div'));
    expect(applePay.getActiveEceMountCount()).toBe(0);
    expect(paypal.getActiveButtonMountCount()).toBe(1);

    await session.mount('apple-pay', document.createElement('div'));
    expect(paypal.getActiveButtonMountCount()).toBe(0);
    expect(applePay.getActiveEceMountCount()).toBe(1);

    await session.mount('google-pay', document.createElement('div'));
    expect(applePay.getActiveEceMountCount()).toBe(0);
    expect(googlePay.getActiveButtonMountCount()).toBe(1);

    await session.mount('apple-pay', document.createElement('div'));
    expect(googlePay.getActiveButtonMountCount()).toBe(0);
    expect(applePay.getActiveEceMountCount()).toBe(1);

    await session.mount('klarna', document.createElement('div'));
    expect(applePay.getActiveEceMountCount()).toBe(0);
    expect(klarna.hasMountedElement(session.id)).toBeTrue();

    await session.mount('affirm', document.createElement('div'));
    expect(klarna.hasMountedElement(session.id)).toBeFalse();
    expect(affirm.hasMountedElement(session.id)).toBeTrue();

    await session.mount('apple-pay', document.createElement('div'));
    expect(affirm.hasMountedElement(session.id)).toBeFalse();
    expect(applePay.getActiveEceMountCount()).toBe(1);
    await session.destroy();
  });

  it('rejects session.confirm() for Apple Pay', async () => {
    const session = await readySession({ methods: ['apple-pay'] });
    await session.mount('apple-pay', document.createElement('div'));
    await expectAsync(session.confirm()).toBeRejectedWith(
      jasmine.objectContaining({
        code: 'CONFIG_INVALID',
        message: jasmine.stringMatching(/official Apple Pay/),
      }),
    );
    await session.destroy();
  });

  it('supports idempotent unmount and cleanup on destroy', async () => {
    const session = await readySession({
      checkoutInstanceId: 'ap-cleanup',
      methods: ['apple-pay'],
    });
    const handle = await session.mount('apple-pay', document.createElement('div'));
    expect(applePay.getActiveEceMountCount()).toBe(1);
    handle.unmount();
    handle.unmount();
    expect(applePay.getActiveEceMountCount()).toBe(0);

    await session.mount('apple-pay', document.createElement('div'));
    await session.destroy();
    expect(applePay.getActiveEceMountCount()).toBe(0);
    expect(registry.has('ap-cleanup')).toBeFalse();
  });

  it('does not emit success without processor confirmation', async () => {
    confirmPayment.and.resolveTo({
      error: undefined,
      paymentIntent: { id: 'pi_apple', status: 'processing' },
    });
    const session = await readySession({ methods: ['apple-pay'] });
    await session.mount('apple-pay', document.createElement('div'));
    const pending = firstValueFrom(session.events.pending);
    await fireConfirm();
    await expectAsync(pending).toBeResolvedTo(
      jasmine.objectContaining({ status: 'processing' }),
    );
    expect(session.state()).toBe('pending');
    expect(session.lastResult()?.status).not.toBe('success');
    await session.destroy();
  });
});
