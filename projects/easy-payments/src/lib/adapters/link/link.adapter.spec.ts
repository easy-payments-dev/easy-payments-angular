import { TestBed } from '@angular/core/testing';
import { PLATFORM_ID } from '@angular/core';
import { provideHttpClient, withXhr } from '@angular/common/http';
import { provideEasyPayments } from '../../config/provide-easy-payments';
import { BackendService } from '../../services/backend.service';
import { StripeSdkLoader } from '../stripe/stripe-sdk.loader';
import { STRIPE_PAYMENT_ELEMENT_OPTIONS } from '../stripe/stripe-appearance';
import {
  LinkAdapter,
  isLinkAvailableFromPaymentMethods,
} from './link.adapter';

describe('isLinkAvailableFromPaymentMethods', () => {
  it('reads availablepaymentmethodschange shape', () => {
    expect(
      isLinkAvailableFromPaymentMethods({
        link: { available: true },
        applePay: { available: true },
      }),
    ).toBeTrue();
    expect(
      isLinkAvailableFromPaymentMethods({
        link: { available: false },
        applePay: { available: true },
      }),
    ).toBeFalse();
  });

  it('reads ready.availablePaymentMethods boolean shape', () => {
    expect(isLinkAvailableFromPaymentMethods({ link: true })).toBeTrue();
    expect(isLinkAvailableFromPaymentMethods({ link: false, applePay: true })).toBeFalse();
  });

  it('fails closed for missing methods', () => {
    expect(isLinkAvailableFromPaymentMethods(undefined)).toBeFalse();
    expect(isLinkAvailableFromPaymentMethods(null)).toBeFalse();
  });
});

describe('LinkAdapter', () => {
  let adapter: LinkAdapter;
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

  function emitReadyOnMount(availablePaymentMethods: unknown = { link: true }): void {
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

    backend = jasmine.createSpyObj<BackendService>('BackendService', ['createLinkPayment']);
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
            link: {},
          },
          backend: {
            linkCreatePaymentUrl: 'https://api.example.com/payments/link/create',
          },
        }),
        { provide: BackendService, useValue: backend },
        { provide: StripeSdkLoader, useValue: stripeSdk },
        LinkAdapter,
      ],
    });

    adapter = TestBed.inject(LinkAdapter);
    await adapter.initialize();
  });

  it('requires providers.link + Stripe pk + linkCreatePaymentUrl', async () => {
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
            linkCreatePaymentUrl: 'https://api.example.com/payments/link/create',
          },
        }),
        LinkAdapter,
      ],
    });
    const unconfigured = TestBed.inject(LinkAdapter);
    await unconfigured.initialize();
    expect(unconfigured.isConfigured()).toBeFalse();
  });

  it('configures ECE for Link only with paymentMethodTypes link+card', async () => {
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
        paymentMethodTypes: ['link', 'card'],
      }),
    );
    expect(elements.create).toHaveBeenCalledWith(
      'expressCheckout',
      jasmine.objectContaining({
        paymentMethods: jasmine.objectContaining({
          // Stripe ECE: link accepts only auto|never (always throws IntegrationError).
          link: 'auto',
          applePay: 'never',
          googlePay: 'never',
          paypal: 'never',
          amazonPay: 'never',
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
        method: 'link',
        provider: 'link',
      }),
    );
    expect(adapter.getActiveEceMountCount()).toBe(0);
    expect(adapter.getAvailabilityStatus(product)).toBe('error');
  });

  it('reports available from config without waiting for ECE ready (selector visibility)', async () => {
    // Real-mode regression: Link must stay in the Full Checkout / Buttons selector
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

  it('keeps card Payment Element wallets.link never when Link is opted in', () => {
    // Coexistence: dedicated Link method uses ECE; card PE must not also show Link.
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

  it('submits elements, creates the Link PaymentIntent, then confirms with redirect if_required', async () => {
    backend.createLinkPayment.and.resolveTo({
      provider: 'link',
      clientSecret: 'pi_secret',
      paymentIntentId: 'pi_link',
    });
    const order: string[] = [];
    elements.submit.and.callFake(async () => {
      order.push('submit');
      return { error: undefined };
    });
    backend.createLinkPayment.and.callFake(async () => {
      order.push('create');
      return { provider: 'link', clientSecret: 'pi_secret', paymentIntentId: 'pi_link' };
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

  it('never sends a client amount to the Link create endpoint (catalog is authoritative)', async () => {
    backend.createLinkPayment.and.resolveTo({
      provider: 'link',
      clientSecret: 'pi_secret',
      paymentIntentId: 'pi_link',
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

    const payload = backend.createLinkPayment.calls.mostRecent().args[0] as unknown as Record<
      string,
      unknown
    >;
    expect(payload['amount']).toBeUndefined();
    expect(payload['productId']).toBe('premium-plan');
    expect(payload['quantity']).toBe(1);
  });

  it('is unavailable without linkCreatePaymentUrl', async () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withXhr()),
        { provide: PLATFORM_ID, useValue: 'browser' },
        provideEasyPayments({
          enableMockMode: false,
          providers: { stripe: { publishableKey: 'pk_test_123' }, link: {} },
          backend: { createPaymentUrl: '/api/payments/create' },
        }),
        { provide: BackendService, useValue: backend },
        { provide: StripeSdkLoader, useValue: stripeSdk },
      ],
    });
    const noUrl = TestBed.inject(LinkAdapter);
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
          providers: { stripe: { publishableKey: 'sk_test_nope' }, link: {} },
          backend: { linkCreatePaymentUrl: '/api/payments/link/create' },
        }),
        { provide: BackendService, useValue: backend },
        { provide: StripeSdkLoader, useValue: stripeSdk },
      ],
    });
    const secret = TestBed.inject(LinkAdapter);
    await secret.initialize();
    expect(secret.isConfigured()).toBeFalse();
  });
});

describe('Link / Apple Pay coexistence (capability flags)', () => {
  it('treats Link and Apple Pay availability independently', () => {
    expect(isLinkAvailableFromPaymentMethods({ link: true, applePay: false })).toBeTrue();
    expect(isLinkAvailableFromPaymentMethods({ link: false, applePay: true })).toBeFalse();
    expect(isLinkAvailableFromPaymentMethods({ link: true, applePay: true })).toBeTrue();
    expect(isLinkAvailableFromPaymentMethods({ applePay: true, googlePay: true })).toBeFalse();
  });
});