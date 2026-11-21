import { TestBed } from '@angular/core/testing';
import { PLATFORM_ID } from '@angular/core';
import { provideHttpClient, withXhr } from '@angular/common/http';
import { provideEasyPayments } from '../../config/provide-easy-payments';
import { BackendService } from '../../services/backend.service';
import { StripeSdkLoader } from '../stripe/stripe-sdk.loader';
import { STRIPE_PAYMENT_ELEMENT_OPTIONS } from '../stripe/stripe-appearance';
import {
  AmazonPayAdapter,
  isAmazonPayAvailableFromPaymentMethods,
} from './amazon-pay.adapter';

describe('isAmazonPayAvailableFromPaymentMethods', () => {
  it('reads availablepaymentmethodschange shape', () => {
    expect(
      isAmazonPayAvailableFromPaymentMethods({
        amazonPay: { available: true },
        applePay: { available: true },
      }),
    ).toBeTrue();
    expect(
      isAmazonPayAvailableFromPaymentMethods({
        amazonPay: { available: false },
        applePay: { available: true },
      }),
    ).toBeFalse();
  });

  it('reads ready.availablePaymentMethods boolean shape', () => {
    expect(isAmazonPayAvailableFromPaymentMethods({ amazonPay: true })).toBeTrue();
    expect(
      isAmazonPayAvailableFromPaymentMethods({ amazonPay: false, applePay: true }),
    ).toBeFalse();
  });

  it('fails closed for missing methods', () => {
    expect(isAmazonPayAvailableFromPaymentMethods(undefined)).toBeFalse();
    expect(isAmazonPayAvailableFromPaymentMethods(null)).toBeFalse();
  });
});

describe('AmazonPayAdapter', () => {
  let adapter: AmazonPayAdapter;
  let backend: jasmine.SpyObj<BackendService>;
  let stripeSdk: jasmine.SpyObj<StripeSdkLoader>;
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
  let stripeMock: {
    elements: jasmine.Spy;
    confirmPayment: jasmine.Spy;
  };

  const product = {
    id: 'premium-plan',
    name: 'Premium Plan',
    amount: 99.99,
    currency: 'USD',
    quantity: 1,
  };

  function emitReadyOnMount(availablePaymentMethods: unknown = { amazonPay: true }): void {
    expressCheckout.mount.and.callFake(() => {
      const ready = expressCheckout.on.calls
        .allArgs()
        .find((args) => args[0] === 'ready')?.[1] as
        | ((event: { availablePaymentMethods?: unknown }) => void)
        | undefined;
      ready?.({ availablePaymentMethods });
    });
  }

  beforeEach(async () => {
    TestBed.resetTestingModule();
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
    stripeMock = {
      elements: jasmine.createSpy('elements').and.returnValue(elements),
      confirmPayment: jasmine.createSpy('confirmPayment').and.resolveTo({
        error: undefined,
        paymentIntent: { id: 'pi_link', status: 'succeeded' },
      }),
    };
    emitReadyOnMount();

    backend = jasmine.createSpyObj<BackendService>('BackendService', ['createAmazonPayPayment']);
    stripeSdk = jasmine.createSpyObj<StripeSdkLoader>('StripeSdkLoader', ['load']);
    stripeSdk.load.and.resolveTo(stripeMock as never);

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withXhr()),
        { provide: PLATFORM_ID, useValue: 'browser' },
        provideEasyPayments({
          enableMockMode: false,
          providers: {
            stripe: { publishableKey: 'pk_test_123' },
            amazonPay: {},
          },
          backend: {
            amazonPayCreatePaymentUrl: 'https://api.example.com/payments/amazon-pay/create',
          },
        }),
        { provide: BackendService, useValue: backend },
        { provide: StripeSdkLoader, useValue: stripeSdk },
        AmazonPayAdapter,
      ],
    });

    adapter = TestBed.inject(AmazonPayAdapter);
    await adapter.initialize();
  });

  it('requires providers.amazonPay + Stripe pk + amazonPayCreatePaymentUrl', async () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withXhr()),
        { provide: PLATFORM_ID, useValue: 'browser' },
        provideEasyPayments({
          enableMockMode: false,
          providers: {
            stripe: { publishableKey: 'pk_test_123' },
          },
          backend: {
            amazonPayCreatePaymentUrl: 'https://api.example.com/payments/amazon-pay/create',
          },
        }),
        AmazonPayAdapter,
      ],
    });
    const unconfigured = TestBed.inject(AmazonPayAdapter);
    await unconfigured.initialize();
    expect(unconfigured.isConfigured()).toBeFalse();
  });

  it('configures ECE for Amazon Pay only with paymentMethodTypes amazon_pay', async () => {
    const host = document.createElement('div');
    await adapter.mountExpressCheckout(host, {
      product,
      theme: 'light',
      onSuccess: () => undefined,
      onCancel: () => undefined,
      onError: () => undefined,
    });

    expect(stripeMock.elements).toHaveBeenCalledWith(
      jasmine.objectContaining({
        mode: 'payment',
        paymentMethodTypes: ['amazon_pay'],
      }),
    );
    expect(elements.create).toHaveBeenCalledWith(
      'expressCheckout',
      jasmine.objectContaining({
        paymentMethods: jasmine.objectContaining({
          // Stripe ECE: link accepts only auto|never (always throws IntegrationError).
          amazonPay: 'auto',
          applePay: 'never',
          googlePay: 'never',
          paypal: 'never',
          link: 'never',
          klarna: 'never',
        }),
        emailRequired: true,
      }),
    );
  });

  it('maps ECE create IntegrationError (e.g. link: always) to SDK_LOAD_FAILED and cleans up', async () => {
    elements.create.and.callFake(() => {
      throw Object.assign(new Error("paymentMethods.link should be one of the following strings: auto, never. You specified: always."), {
        name: 'IntegrationError',
        type: 'invalid_request_error',
      });
    });
    const host = document.createElement('div');
    let caught: unknown;
    try {
      await adapter.mountExpressCheckout(host, {
        product,
        theme: 'light',
        onSuccess: () => undefined,
        onCancel: () => undefined,
        onError: () => undefined,
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toEqual(
      jasmine.objectContaining({
        code: 'SDK_LOAD_FAILED',
        method: 'amazon-pay',
        provider: 'amazonPay',
      }),
    );
    expect(adapter.getActiveEceMountCount()).toBe(0);
    expect(adapter.getAvailabilityStatus(product)).toBe('error');
  });

  it('reports available from config without waiting for ECE ready (selector visibility)', async () => {
    // Real-mode regression: Amazon Pay must stay in the Full Checkout / Buttons selector
    // when Stripe has not yet fired ECE ready (Cash App Pay pattern).
    expect(await adapter.isAvailable({ product, theme: 'light' })).toBeTrue();
    expect(adapter.getAvailabilityStatus(product)).not.toBe('available');
  });

  it('still records ECE ready availability for panel chrome after mount', async () => {
    const host = document.createElement('div');
    await adapter.mountExpressCheckout(host, {
      product,
      theme: 'light',
      onSuccess: () => undefined,
      onCancel: () => undefined,
      onError: () => undefined,
    });

    expect(adapter.getAvailabilityStatus(product)).toBe('available');
    expect(await adapter.isAvailable({ product, theme: 'light' })).toBeTrue();
  });

  it('keeps card Payment Element wallets.link never when Amazon Pay is opted in', () => {
    // Coexistence: dedicated Amazon Pay method uses ECE; card PE must not also show Amazon Pay.
    expect(STRIPE_PAYMENT_ELEMENT_OPTIONS.wallets?.link).toBe('never');
  });

  it('passes the Stripe Elements locale when provided', async () => {
    const host = document.createElement('div');
    await adapter.mountExpressCheckout(host, {
      product,
      theme: 'light',
      locale: 'es',
      onSuccess: () => undefined,
      onCancel: () => undefined,
      onError: () => undefined,
    });
    expect(stripeMock.elements).toHaveBeenCalledWith(jasmine.objectContaining({ locale: 'es' }));
  });

  it('submits elements, creates the Amazon Pay PaymentIntent, then confirms with redirect if_required', async () => {
    backend.createAmazonPayPayment.and.resolveTo({
      provider: 'amazonPay',
      clientSecret: 'pi_secret',
      paymentIntentId: 'pi_amazon_pay',
    });
    const order: string[] = [];
    elements.submit.and.callFake(async () => {
      order.push('submit');
      return { error: undefined };
    });
    backend.createAmazonPayPayment.and.callFake(async () => {
      order.push('create');
      return { provider: 'amazonPay', clientSecret: 'pi_secret', paymentIntentId: 'pi_amazon_pay' };
    });
    stripeMock.confirmPayment.and.callFake(async () => {
      order.push('confirm');
      return { error: undefined, paymentIntent: { id: 'pi_link', status: 'succeeded' } };
    });

    const host = document.createElement('div');
    await adapter.mountExpressCheckout(host, {
      product,
      theme: 'light',
      onSuccess: () => undefined,
      onCancel: () => undefined,
      onError: () => undefined,
    });
    const confirmHandler = expressCheckout.on.calls
      .allArgs()
      .find((args) => args[0] === 'confirm')?.[1] as () => Promise<void>;
    await confirmHandler();

    expect(order).toEqual(['submit', 'create', 'confirm']);
    expect(stripeMock.confirmPayment).toHaveBeenCalledWith(
      jasmine.objectContaining({
        elements,
        clientSecret: 'pi_secret',
        redirect: 'if_required',
      }),
    );
  });

  it('never sends a client amount to the Amazon Pay create endpoint (catalog is authoritative)', async () => {
    backend.createAmazonPayPayment.and.resolveTo({
      provider: 'amazonPay',
      clientSecret: 'pi_secret',
      paymentIntentId: 'pi_amazon_pay',
    });
    const host = document.createElement('div');
    await adapter.mountExpressCheckout(host, {
      product,
      theme: 'light',
      onSuccess: () => undefined,
      onCancel: () => undefined,
      onError: () => undefined,
    });
    const confirmHandler = expressCheckout.on.calls
      .allArgs()
      .find((args) => args[0] === 'confirm')?.[1] as () => Promise<void>;
    await confirmHandler();

    const payload = backend.createAmazonPayPayment.calls.mostRecent().args[0] as unknown as Record<
      string,
      unknown
    >;
    expect(payload['amount']).toBeUndefined();
    expect(payload['productId']).toBe('premium-plan');
    expect(payload['quantity']).toBe(1);
  });

  it('is unavailable without amazonPayCreatePaymentUrl', async () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withXhr()),
        { provide: PLATFORM_ID, useValue: 'browser' },
        provideEasyPayments({
          enableMockMode: false,
          providers: { stripe: { publishableKey: 'pk_test_123' }, amazonPay: {} },
          backend: { createPaymentUrl: '/api/payments/create' },
        }),
        { provide: BackendService, useValue: backend },
        { provide: StripeSdkLoader, useValue: stripeSdk },
      ],
    });
    const noUrl = TestBed.inject(AmazonPayAdapter);
    await noUrl.initialize();
    expect(noUrl.isConfigured()).toBeFalse();
  });

  it('is unavailable when the Stripe key is a secret key', async () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withXhr()),
        { provide: PLATFORM_ID, useValue: 'browser' },
        provideEasyPayments({
          enableMockMode: false,
          providers: { stripe: { publishableKey: 'sk_test_nope' }, amazonPay: {} },
          backend: { amazonPayCreatePaymentUrl: '/api/payments/amazon-pay/create' },
        }),
        { provide: BackendService, useValue: backend },
        { provide: StripeSdkLoader, useValue: stripeSdk },
      ],
    });
    const secret = TestBed.inject(AmazonPayAdapter);
    await secret.initialize();
    expect(secret.isConfigured()).toBeFalse();
  });
});

describe('Amazon Pay / Apple Pay coexistence (capability flags)', () => {
  it('treats Amazon Pay and Apple Pay availability independently', () => {
    expect(
      isAmazonPayAvailableFromPaymentMethods({ amazonPay: true, applePay: false }),
    ).toBeTrue();
    expect(
      isAmazonPayAvailableFromPaymentMethods({ amazonPay: false, applePay: true }),
    ).toBeFalse();
    expect(
      isAmazonPayAvailableFromPaymentMethods({ amazonPay: true, applePay: true }),
    ).toBeTrue();
    expect(isAmazonPayAvailableFromPaymentMethods({ applePay: true, googlePay: true })).toBeFalse();
  });
});