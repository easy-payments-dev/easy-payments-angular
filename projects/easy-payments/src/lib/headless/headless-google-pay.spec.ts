import { TestBed } from '@angular/core/testing';
import { provideHttpClient, withXhr } from '@angular/common/http';
import { PLATFORM_ID } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { provideEasyPayments } from '../config/provide-easy-payments';
import { BackendService } from '../services/backend.service';
import { PaymentError } from '../errors/payment-error';
import type { PaymentProduct, PaymentResult } from '../models';
import { StripeCardAdapter } from '../adapters/stripe/stripe-card.adapter';
import { KlarnaAdapter } from '../adapters/klarna/klarna.adapter';
import { AffirmAdapter } from '../adapters/affirm/affirm.adapter';
import { PayPalAdapter } from '../adapters/paypal/paypal.adapter';
import { GooglePayAdapter } from '../adapters/google-pay/google-pay.adapter';
import { GooglePaySdkLoader } from '../adapters/google-pay/google-pay-sdk.loader';
import type {
  GooglePayButtonOptions,
  GooglePayNamespace,
  GooglePayPaymentsClient,
} from '../adapters/google-pay/google-pay.types';
import { StripeSdkLoader } from '../adapters/stripe/stripe-sdk.loader';
import { SdkLoaderService } from '../loaders/sdk-loader.service';
import type { PayPalNamespace } from '../adapters/paypal/paypal.types';
import { EasyPaymentsHeadless } from './easy-payments-headless.service';
import { HeadlessSessionRegistry } from './headless-session-registry';
import type { HeadlessCheckoutSession } from './headless.types';

const PRODUCT: PaymentProduct = {
  id: 'premium-plan',
  name: 'Premium',
  amount: 99,
  currency: 'USD',
};

describe('HeadlessCheckoutSession Google Pay (H3.4)', () => {
  let headless: EasyPaymentsHeadless;
  let registry: HeadlessSessionRegistry;
  let backend: jasmine.SpyObj<BackendService>;
  let googlePay: GooglePayAdapter;
  let stripeCard: StripeCardAdapter;
  let klarna: KlarnaAdapter;
  let affirm: AffirmAdapter;
  let paypal: PayPalAdapter;
  let googlePaySdk: jasmine.SpyObj<GooglePaySdkLoader>;
  let stripeSdk: jasmine.SpyObj<StripeSdkLoader>;
  let sdkLoader: jasmine.SpyObj<SdkLoaderService>;
  let paymentsClient: jasmine.SpyObj<GooglePayPaymentsClient>;
  let lastButtonOptions: GooglePayButtonOptions | null;
  let createPaymentMethod: jasmine.Spy;
  let confirmCardPayment: jasmine.Spy;

  beforeEach(() => {
    lastButtonOptions = null;
    paymentsClient = jasmine.createSpyObj<GooglePayPaymentsClient>('PaymentsClient', [
      'isReadyToPay',
      'loadPaymentData',
      'createButton',
    ]);
    paymentsClient.isReadyToPay.and.resolveTo({ result: true });
    paymentsClient.createButton.and.callFake((options: GooglePayButtonOptions) => {
      lastButtonOptions = options;
      const el = document.createElement('button');
      el.type = 'button';
      el.textContent = 'GPay';
      return el;
    });
    paymentsClient.loadPaymentData.and.resolveTo({
      paymentMethodData: {
        tokenizationData: { token: JSON.stringify({ id: 'tok_gpay' }) },
        info: { cardNetwork: 'VISA', cardDetails: '4242' },
      },
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

    createPaymentMethod = jasmine
      .createSpy('createPaymentMethod')
      .and.resolveTo({ paymentMethod: { id: 'pm_1' } });
    confirmCardPayment = jasmine.createSpy('confirmCardPayment').and.resolveTo({
      paymentIntent: { id: 'pi_gpay', status: 'succeeded' },
    });

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
      paymentIntentId: 'pi_gpay',
      sessionId: 'sess_gpay',
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

    googlePaySdk = jasmine.createSpyObj<GooglePaySdkLoader>('GooglePaySdkLoader', ['load']);
    googlePaySdk.load.and.resolveTo(googleNs);
    stripeSdk = jasmine.createSpyObj<StripeSdkLoader>('StripeSdkLoader', ['load']);
    stripeSdk.load.and.resolveTo({
      elements: jasmine.createSpy('elements').and.callFake(() => ({
        create: () => ({
          mount: jasmine.createSpy('mount'),
          unmount: jasmine.createSpy('unmount'),
        }),
        submit: jasmine.createSpy('submit').and.resolveTo({ error: undefined }),
        update: jasmine.createSpy('update'),
      })),
      confirmPayment: jasmine.createSpy('confirmPayment'),
      createPaymentMethod,
      confirmCardPayment,
    } as never);

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
            paypal: { clientId: 'sb-test' },
            googlePay: {
              environment: 'TEST',
              merchantName: 'Easy Payments Demo',
            },
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
        { provide: GooglePaySdkLoader, useValue: googlePaySdk },
        { provide: StripeSdkLoader, useValue: stripeSdk },
        { provide: SdkLoaderService, useValue: sdkLoader },
      ],
    });

    headless = TestBed.inject(EasyPaymentsHeadless);
    registry = TestBed.inject(HeadlessSessionRegistry);
    googlePay = TestBed.inject(GooglePayAdapter);
    stripeCard = TestBed.inject(StripeCardAdapter);
    klarna = TestBed.inject(KlarnaAdapter);
    affirm = TestBed.inject(AffirmAdapter);
    paypal = TestBed.inject(PayPalAdapter);
    registry.clearForTests();
  });

  afterEach(() => {
    registry.clearForTests();
    delete (window as Window & { paypal?: PayPalNamespace }).paypal;
  });

  async function readySession(
    overrides: Partial<Parameters<EasyPaymentsHeadless['createSession']>[0]> = {},
  ): Promise<HeadlessCheckoutSession> {
    const session = headless.createSession({
      product: overrides.product ?? PRODUCT,
      methods: overrides.methods ?? ['google-pay', 'card', 'paypal'],
      checkoutInstanceId:
        overrides.checkoutInstanceId ?? `gp-${Math.random().toString(36).slice(2, 8)}`,
      checkout: overrides.checkout,
      locale: overrides.locale,
      theme: overrides.theme,
    });
    await session.initialize();
    return session;
  }

  async function clickOfficialButton(): Promise<void> {
    expect(lastButtonOptions).toBeTruthy();
    await lastButtonOptions!.onClick({
      preventDefault() {
        /* no-op */
      },
    } as Event);
  }

  it('mounts the official Google Pay button into a merchant container', async () => {
    const session = await readySession({ methods: ['google-pay'] });
    const host = document.createElement('div');
    const handle = await session.mount('google-pay', host);

    expect(paymentsClient.createButton).toHaveBeenCalled();
    expect(host.querySelector('button')).toBeTruthy();
    expect(handle.method).toBe('google-pay');
    expect(session.selectedMethod()).toBe('google-pay');
    expect(googlePay.getActiveButtonMountCount()).toBe(1);
    await session.destroy();
  });

  it('rejects when Google Pay is not eligible', async () => {
    paymentsClient.isReadyToPay.and.resolveTo({ result: false });
    const session = await readySession({ methods: ['google-pay'] });
    await expectAsync(session.mount('google-pay', document.createElement('div'))).toBeRejectedWith(
      jasmine.objectContaining({ code: 'PROVIDER_UNAVAILABLE' }),
    );
    await session.destroy();
  });

  it('rejects unsupported browser/device when isReadyToPay fails', async () => {
    paymentsClient.isReadyToPay.and.rejectWith(new Error('unsupported'));
    const session = await readySession({ methods: ['google-pay'] });
    await expectAsync(session.mount('google-pay', document.createElement('div'))).toBeRejectedWith(
      jasmine.objectContaining({ code: 'PROVIDER_UNAVAILABLE' }),
    );
    await session.destroy();
  });

  it('rejects when Google Pay config is missing', async () => {
    const { EasyPaymentsConfigService } = await import('../config/easy-payments-config.service');
    TestBed.inject(EasyPaymentsConfigService).replace({
      enableMockMode: false,
      providers: { stripe: { publishableKey: 'pk_test_123456789' } },
      backend: { createPaymentUrl: '/api/payments/create' },
    });
    const session = headless.createSession({
      product: PRODUCT,
      methods: ['google-pay'],
      checkoutInstanceId: 'gp-unavail',
    });
    await session.initialize();
    await expectAsync(session.mount('google-pay', document.createElement('div'))).toBeRejectedWith(
      jasmine.objectContaining({ code: 'PROVIDER_UNAVAILABLE' }),
    );
    await session.destroy();
  });

  it('rejects an invalid mount container', async () => {
    const session = await readySession({ methods: ['google-pay'] });
    await expectAsync(session.mount('google-pay', null as never)).toBeRejectedWith(
      jasmine.objectContaining({ code: 'CONFIG_INVALID' }),
    );
    await session.destroy();
  });

  it('surfaces SDK load failure', async () => {
    googlePaySdk.load.and.rejectWith(new Error('pay.js blocked'));
    const session = await readySession({ methods: ['google-pay'] });
    await expectAsync(session.mount('google-pay', document.createElement('div'))).toBeRejected();
    await session.destroy();
  });

  it('cleans up after button render failure', async () => {
    paymentsClient.createButton.and.throwError('createButton failed');
    const session = await readySession({ methods: ['google-pay'] });
    await expectAsync(session.mount('google-pay', document.createElement('div'))).toBeRejected();
    expect(googlePay.getActiveButtonMountCount()).toBe(0);
    await session.destroy();
  });

  it('runs Stripe gateway confirmation after buyer click and emits success', async () => {
    const session = await readySession({ methods: ['google-pay'] });
    await session.mount('google-pay', document.createElement('div'));

    const started = firstValueFrom(session.events.started);
    const success = firstValueFrom(session.events.success);
    await clickOfficialButton();

    await expectAsync(started).toBeResolvedTo(
      jasmine.objectContaining({ method: 'google-pay', provider: 'googlePay', amount: 99 }),
    );
    await expectAsync(success).toBeResolvedTo(
      jasmine.objectContaining({ status: 'success', method: 'google-pay', transactionId: 'pi_gpay' }),
    );
    expect(backend.createStripePayment).toHaveBeenCalled();
    expect(paymentsClient.loadPaymentData).toHaveBeenCalled();
    expect(confirmCardPayment).toHaveBeenCalled();
    expect(session.state()).toBe('success');
    await session.destroy();
  });

  it('maps pending processor results without treating them as success', async () => {
    confirmCardPayment.and.resolveTo({
      paymentIntent: { id: 'pi_gpay', status: 'processing' },
    });
    const session = await readySession({ methods: ['google-pay'] });
    await session.mount('google-pay', document.createElement('div'));
    const pending = firstValueFrom(session.events.pending);
    await clickOfficialButton();
    await expectAsync(pending).toBeResolvedTo(
      jasmine.objectContaining({ status: 'processing', method: 'google-pay' }),
    );
    expect(session.state()).toBe('pending');
    await session.destroy();
  });

  it('emits cancel when the buyer closes the Google Pay sheet', async () => {
    paymentsClient.loadPaymentData.and.rejectWith({ statusCode: 'CANCELED' });
    const session = await readySession({ methods: ['google-pay'] });
    await session.mount('google-pay', document.createElement('div'));
    const cancel = firstValueFrom(session.events.cancel);
    await clickOfficialButton();
    await expectAsync(cancel).toBeResolvedTo(
      jasmine.objectContaining({ status: 'cancelled', method: 'google-pay' }),
    );
    await Promise.resolve();
    expect(session.state()).toBe('ready');
    await session.destroy();
  });

  it('emits error on authorization failure', async () => {
    paymentsClient.loadPaymentData.and.rejectWith({
      statusCode: 'ERROR',
      statusMessage: 'sheet failed',
    });
    const session = await readySession({ methods: ['google-pay'] });
    await session.mount('google-pay', document.createElement('div'));
    const error = firstValueFrom(session.events.error);
    await clickOfficialButton();
    await expectAsync(error).toBeResolved();
    await Promise.resolve();
    expect(session.state()).toBe('ready');
    await session.destroy();
  });

  it('emits error on Stripe processor confirmation failure', async () => {
    confirmCardPayment.and.resolveTo({
      error: { message: 'card declined', code: 'card_declined' },
    });
    const session = await readySession({ methods: ['google-pay'] });
    await session.mount('google-pay', document.createElement('div'));
    const error = firstValueFrom(session.events.error);
    await clickOfficialButton();
    await expectAsync(error).toBeResolved();
    await Promise.resolve();
    expect(session.state()).toBe('ready');
    expect(session.lastResult()?.status).not.toBe('success');
    await session.destroy();
  });

  it('protects against concurrent clicks', async () => {
    let releaseCreate!: (value: {
      provider: 'stripe';
      clientSecret: string;
      paymentIntentId: string;
    }) => void;
    backend.createStripePayment.and.returnValue(
      new Promise((resolve) => {
        releaseCreate = resolve;
      }),
    );
    const session = await readySession({ methods: ['google-pay'] });
    await session.mount('google-pay', document.createElement('div'));

    const first = clickOfficialButton();
    await Promise.resolve();
    await clickOfficialButton();
    expect(backend.createStripePayment.calls.count()).toBe(1);

    releaseCreate({
      provider: 'stripe',
      clientSecret: 'pi_secret',
      paymentIntentId: 'pi_gpay',
    });
    paymentsClient.loadPaymentData.and.rejectWith({ statusCode: 'CANCELED' });
    await first;
    await session.destroy();
  });

  it('ignores stale clicks after unmount', async () => {
    const session = await readySession({ methods: ['google-pay'] });
    const handle = await session.mount('google-pay', document.createElement('div'));
    const options = lastButtonOptions!;
    handle.unmount();

    const success = firstValueFrom(session.events.success);
    await options.onClick({ preventDefault() {} } as Event);
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
    const session = await readySession({ methods: ['google-pay'] });
    await session.mount('google-pay', document.createElement('div'));
    const firstOptions = lastButtonOptions!;
    await session.mount('google-pay', document.createElement('div'));
    expect(lastButtonOptions).not.toBe(firstOptions);

    await firstOptions.onClick({ preventDefault() {} } as Event);
    expect(backend.createStripePayment).not.toHaveBeenCalled();

    const success = firstValueFrom(session.events.success);
    await clickOfficialButton();
    await expectAsync(success).toBeResolvedTo(
      jasmine.objectContaining({ status: 'success' }),
    );
    await session.destroy();
  });

  it('rejects mount and cleans up when destroyed during button loading', async () => {
    let releaseRender: (() => void) | null = null;
    const realRender = googlePay.renderOfficialButton.bind(googlePay);
    spyOn(googlePay, 'renderOfficialButton').and.callFake(
      async (host, options, mountId) => {
        await new Promise<void>((resolve) => {
          releaseRender = resolve;
        });
        return realRender(host, options, mountId);
      },
    );

    const session = await readySession({
      checkoutInstanceId: 'gp-destroy-load',
      methods: ['google-pay'],
    });
    const mountPromise = session.mount('google-pay', document.createElement('div'));
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
    expect(googlePay.getActiveButtonMountCount()).toBe(0);
  });

  it('ignores outcomes after destroy during authorization', async () => {
    let releaseSheet!: () => void;
    paymentsClient.loadPaymentData.and.returnValue(
      new Promise((resolve) => {
        releaseSheet = () =>
          resolve({
            paymentMethodData: {
              tokenizationData: { token: JSON.stringify({ id: 'tok_gpay' }) },
            },
          });
      }),
    );
    const session = await readySession({
      checkoutInstanceId: 'gp-destroy-auth',
      methods: ['google-pay'],
    });
    await session.mount('google-pay', document.createElement('div'));
    const pending = clickOfficialButton();
    await Promise.resolve();
    await session.destroy();
    releaseSheet();
    await pending;
    expect(session.state()).toBe('destroyed');
    expect(session.lastResult()).toBeNull();
  });

  it('ignores outcomes after destroy during confirmation', async () => {
    let releaseConfirm!: () => void;
    confirmCardPayment.and.returnValue(
      new Promise((resolve) => {
        releaseConfirm = () =>
          resolve({ paymentIntent: { id: 'pi_gpay', status: 'succeeded' } });
      }),
    );
    const session = await readySession({
      checkoutInstanceId: 'gp-destroy-confirm',
      methods: ['google-pay'],
    });
    await session.mount('google-pay', document.createElement('div'));
    const pending = clickOfficialButton();
    await Promise.resolve();
    await Promise.resolve();
    await session.destroy();
    releaseConfirm();
    await pending;
    expect(session.state()).toBe('destroyed');
    expect(session.lastResult()).toBeNull();
  });

  it('keeps independent Google Pay sessions isolated', async () => {
    const a = await readySession({ checkoutInstanceId: 'gp-iso-a', methods: ['google-pay'] });
    const b = await readySession({ checkoutInstanceId: 'gp-iso-b', methods: ['google-pay'] });
    await a.mount('google-pay', document.createElement('div'));
    await b.mount('google-pay', document.createElement('div'));
    expect(googlePay.getActiveButtonMountCount()).toBe(2);

    await a.destroy();
    expect(googlePay.getActiveButtonMountCount()).toBe(1);
    expect(b.state()).not.toBe('destroyed');

    const success = firstValueFrom(b.events.success);
    await clickOfficialButton();
    await expectAsync(success).toBeResolvedTo(
      jasmine.objectContaining({ status: 'success' }),
    );
    await b.destroy();
  });

  it('switches Google Pay ↔ Card / PayPal / Klarna / Affirm without leaking mounts', async () => {
    const session = await readySession({
      methods: ['google-pay', 'card', 'paypal', 'klarna', 'affirm'],
    });
    await session.mount('google-pay', document.createElement('div'));
    expect(googlePay.getActiveButtonMountCount()).toBe(1);

    await session.mount('card', document.createElement('div'));
    expect(googlePay.getActiveButtonMountCount()).toBe(0);
    expect(stripeCard.hasMountedElement(session.id)).toBeTrue();

    await session.mount('google-pay', document.createElement('div'));
    expect(stripeCard.hasMountedElement(session.id)).toBeFalse();
    expect(googlePay.getActiveButtonMountCount()).toBe(1);

    await session.mount('paypal', document.createElement('div'));
    expect(googlePay.getActiveButtonMountCount()).toBe(0);
    expect(paypal.getActiveButtonMountCount()).toBe(1);

    await session.mount('google-pay', document.createElement('div'));
    expect(paypal.getActiveButtonMountCount()).toBe(0);
    expect(googlePay.getActiveButtonMountCount()).toBe(1);

    await session.mount('klarna', document.createElement('div'));
    expect(googlePay.getActiveButtonMountCount()).toBe(0);
    expect(klarna.hasMountedElement(session.id)).toBeTrue();

    await session.mount('google-pay', document.createElement('div'));
    expect(klarna.hasMountedElement(session.id)).toBeFalse();
    expect(googlePay.getActiveButtonMountCount()).toBe(1);

    await session.mount('affirm', document.createElement('div'));
    expect(googlePay.getActiveButtonMountCount()).toBe(0);
    expect(affirm.hasMountedElement(session.id)).toBeTrue();

    await session.mount('google-pay', document.createElement('div'));
    expect(affirm.hasMountedElement(session.id)).toBeFalse();
    expect(googlePay.getActiveButtonMountCount()).toBe(1);
    await session.destroy();
  });

  it('rejects session.confirm() for Google Pay', async () => {
    const session = await readySession({ methods: ['google-pay'] });
    await session.mount('google-pay', document.createElement('div'));
    await expectAsync(session.confirm()).toBeRejectedWith(
      jasmine.objectContaining({
        code: 'CONFIG_INVALID',
        message: jasmine.stringMatching(/official Google Pay button/),
      }),
    );
    await session.destroy();
  });

  it('supports idempotent unmount and cleanup on destroy', async () => {
    const session = await readySession({
      checkoutInstanceId: 'gp-cleanup',
      methods: ['google-pay'],
    });
    const handle = await session.mount('google-pay', document.createElement('div'));
    expect(googlePay.getActiveButtonMountCount()).toBe(1);
    handle.unmount();
    handle.unmount();
    expect(googlePay.getActiveButtonMountCount()).toBe(0);

    await session.mount('google-pay', document.createElement('div'));
    await session.destroy();
    expect(googlePay.getActiveButtonMountCount()).toBe(0);
    expect(registry.has('gp-cleanup')).toBeFalse();
  });

  it('does not emit success from payment data alone without processor confirmation', async () => {
    const pendingResult: PaymentResult = {
      status: 'processing',
      method: 'google-pay',
      provider: 'googlePay',
      message: 'still processing',
    };
    spyOn(googlePay, 'payWithGooglePay').and.resolveTo(pendingResult);
    const session = await readySession({ methods: ['google-pay'] });
    await session.mount('google-pay', document.createElement('div'));
    const pending = firstValueFrom(session.events.pending);
    await clickOfficialButton();
    await expectAsync(pending).toBeResolvedTo(
      jasmine.objectContaining({ status: 'processing' }),
    );
    expect(session.state()).toBe('pending');
    expect(session.lastResult()?.status).not.toBe('success');
    await session.destroy();
  });
});
