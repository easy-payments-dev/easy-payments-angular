import { TestBed } from '@angular/core/testing';
import { PLATFORM_ID } from '@angular/core';
import { provideHttpClient, withXhr } from '@angular/common/http';
import { provideEasyPayments } from '../../config/provide-easy-payments';
import { BackendService } from '../../services/backend.service';
import { StripeSdkLoader } from '../stripe/stripe-sdk.loader';
import { PaymentError } from '../../errors/payment-error';
import {
  ApplePayAdapter,
  isApplePayAvailableFromPaymentMethods,
} from './apple-pay.adapter';
import { toStripeAmountCents } from './apple-pay.types';

describe('isApplePayAvailableFromPaymentMethods', () => {
  it('reads availablepaymentmethodschange shape', () => {
    expect(
      isApplePayAvailableFromPaymentMethods({
        applePay: { available: true },
        googlePay: { available: true },
      }),
    ).toBeTrue();
    expect(
      isApplePayAvailableFromPaymentMethods({
        applePay: { available: false },
        googlePay: { available: true },
      }),
    ).toBeFalse();
  });

  it('reads ready.availablePaymentMethods boolean shape', () => {
    expect(isApplePayAvailableFromPaymentMethods({ applePay: true })).toBeTrue();
    expect(isApplePayAvailableFromPaymentMethods({ applePay: false, googlePay: true })).toBeFalse();
  });

  it('fails closed for missing methods', () => {
    expect(isApplePayAvailableFromPaymentMethods(undefined)).toBeFalse();
    expect(isApplePayAvailableFromPaymentMethods(null)).toBeFalse();
  });
});

describe('ApplePayAdapter', () => {
  let adapter: ApplePayAdapter;
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
    paymentRequest: jasmine.Spy;
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

  /** Emit ECE ready on mount (production availability path). */
  function emitReadyOnMount(
    availablePaymentMethods: unknown = { applePay: true },
  ): void {
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
      paymentRequest: jasmine.createSpy('paymentRequest'),
      elements: jasmine.createSpy('elements').and.returnValue(elements),
      confirmPayment: jasmine.createSpy('confirmPayment').and.resolveTo({
        error: undefined,
        paymentIntent: { id: 'pi_apple', status: 'succeeded' },
      }),
    };
    emitReadyOnMount();

    backend = jasmine.createSpyObj<BackendService>('BackendService', ['createStripePayment']);
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
            applePay: {
              merchantName: 'Easy Payments Demo',
              countryCode: 'US',
            },
          },
          backend: {
            createPaymentUrl: '/api/payments/create',
          },
        }),
        { provide: BackendService, useValue: backend },
        { provide: StripeSdkLoader, useValue: stripeSdk },
      ],
    });

    adapter = TestBed.inject(ApplePayAdapter);
    await adapter.destroy();
    await adapter.initialize();
  });

  it('initializes without loading Stripe.js', () => {
    expect(stripeSdk.load).not.toHaveBeenCalled();
  });

  it('converts product amount to Stripe cents', () => {
    expect(toStripeAmountCents(product)).toBe(9999);
  });

  it('isConfigured mirrors configReady', async () => {
    expect(adapter.isConfigured()).toBeTrue();
  });

  it('isAvailable returns false and stays checking until ECE ready', async () => {
    expect(await adapter.isAvailable({ product, theme: 'light' })).toBeFalse();
    expect(adapter.getAvailabilityStatus()).toBe('checking');
    expect(stripeSdk.load).not.toHaveBeenCalled();
    expect(elements.create).not.toHaveBeenCalled();
    expect(backend.createStripePayment).not.toHaveBeenCalled();
  });

  it('reports available after mounted ECE ready with applePay true', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    let readyFired = false;
    await adapter.mountExpressCheckout(host, {
      product,
      theme: 'light',
      onSuccess: () => undefined,
      onCancel: () => undefined,
      onError: () => undefined,
      onReady: () => {
        readyFired = true;
      },
    });

    expect(readyFired).toBeTrue();
    expect(adapter.getAvailabilityStatus()).toBe('available');
    expect(await adapter.isAvailable({ product, theme: 'light' })).toBeTrue();
    expect(expressCheckout.mount).toHaveBeenCalledWith(host);
    expect(backend.createStripePayment).not.toHaveBeenCalled();
    host.remove();
  });

  it('attaches ready listener before mount', async () => {
    const order: string[] = [];
    expressCheckout.on.and.callFake((eventType: string) => {
      order.push(`on:${eventType}`);
      return expressCheckout;
    });
    expressCheckout.mount.and.callFake(() => {
      order.push('mount');
      const ready = expressCheckout.on.calls
        .allArgs()
        .find((args) => args[0] === 'ready')?.[1] as
        | ((event: { availablePaymentMethods?: unknown }) => void)
        | undefined;
      ready?.({ availablePaymentMethods: { applePay: true } });
    });

    const host = document.createElement('div');
    await adapter.mountExpressCheckout(host, {
      product,
      theme: 'light',
      onSuccess: () => undefined,
      onCancel: () => undefined,
      onError: () => undefined,
    });

    const readyIdx = order.indexOf('on:ready');
    const mountIdx = order.indexOf('mount');
    expect(readyIdx).toBeGreaterThanOrEqual(0);
    expect(mountIdx).toBeGreaterThan(readyIdx);
  });

  it('marks unavailable when ready reports no Apple Pay', async () => {
    emitReadyOnMount({ applePay: false });
    const host = document.createElement('div');
    let unavailable = false;
    await adapter.mountExpressCheckout(host, {
      product,
      theme: 'light',
      onSuccess: () => undefined,
      onCancel: () => undefined,
      onError: () => undefined,
      onUnavailable: () => {
        unavailable = true;
      },
    });
    expect(unavailable).toBeTrue();
    expect(adapter.getAvailabilityStatus()).toBe('unavailable');
    expect(await adapter.isAvailable({ product, theme: 'light' })).toBeFalse();
  });

  it('sets error state when ECE loaderror fires', async () => {
    expressCheckout.mount.and.callFake(() => {
      const loadError = expressCheckout.on.calls
        .allArgs()
        .find((args) => args[0] === 'loaderror')?.[1] as (() => void) | undefined;
      loadError?.();
    });
    const host = document.createElement('div');
    await adapter.mountExpressCheckout(host, {
      product,
      theme: 'light',
      onSuccess: () => undefined,
      onCancel: () => undefined,
      onError: () => undefined,
    });
    expect(adapter.getAvailabilityStatus()).toBe('error');
    expect(await adapter.isAvailable({ product, theme: 'light' })).toBeFalse();
  });

  it('is unavailable when not configured', async () => {
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
          backend: { createPaymentUrl: '/api/payments/create' },
        }),
        { provide: BackendService, useValue: backend },
        { provide: StripeSdkLoader, useValue: stripeSdk },
      ],
    });
    const bare = TestBed.inject(ApplePayAdapter);
    await bare.initialize();
    expect(bare.isConfigured()).toBeFalse();
    expect(await bare.isAvailable({ product, theme: 'light' })).toBeFalse();
    expect(stripeSdk.load).not.toHaveBeenCalled();
  });

  it('notifies availability listener on ready', async () => {
    const states: string[] = [];
    adapter.setAvailabilityListener((state) => states.push(state));
    const host = document.createElement('div');
    await adapter.mountExpressCheckout(host, {
      product,
      theme: 'light',
      onSuccess: () => undefined,
      onCancel: () => undefined,
      onError: () => undefined,
    });
    expect(states).toContain('checking');
    expect(states).toContain('available');
  });

  it('loads Stripe on mount and creates Apple-only ECE', async () => {
    const host = document.createElement('div');
    await adapter.mountExpressCheckout(host, {
      product,
      theme: 'light',
      onSuccess: () => undefined,
      onCancel: () => undefined,
      onError: () => undefined,
    });
    expect(stripeSdk.load).toHaveBeenCalledTimes(1);
    expect(stripeMock.paymentRequest).not.toHaveBeenCalled();
    expect(elements.create).toHaveBeenCalledWith(
      'expressCheckout',
      jasmine.objectContaining({
        buttonHeight: 44,
        paymentMethods: jasmine.objectContaining({
          applePay: 'always',
          googlePay: 'never',
        }),
      }),
    );
    expect(expressCheckout.mount).toHaveBeenCalledWith(host);
    expect(backend.createStripePayment).not.toHaveBeenCalled();
  });

  it('creates PaymentIntent only on confirm and normalizes success', async () => {
    backend.createStripePayment.and.resolveTo({
      provider: 'stripe',
      clientSecret: 'pi_secret',
      paymentIntentId: 'pi_apple',
    });

    const host = document.createElement('div');
    let success: unknown;
    await adapter.mountExpressCheckout(host, {
      product,
      theme: 'light',
      onSuccess: (r) => {
        success = r;
      },
      onCancel: () => undefined,
      onError: () => undefined,
    });

    const confirmHandler = expressCheckout.on.calls
      .allArgs()
      .find((args) => args[0] === 'confirm')?.[1] as () => Promise<void>;
    expect(confirmHandler).toBeTruthy();
    await confirmHandler();

    expect(backend.createStripePayment).toHaveBeenCalledTimes(1);
    expect(backend.createStripePayment).toHaveBeenCalledWith(
      jasmine.objectContaining({
        provider: 'stripe',
        productId: 'premium-plan',
        metadata: jasmine.objectContaining({ checkoutMethod: 'apple-pay' }),
      }),
    );
    expect(success).toEqual(
      jasmine.objectContaining({
        status: 'success',
        method: 'apple-pay',
        provider: 'applePay',
        transactionId: 'pi_apple',
      }),
    );
  });

  it('maps cancel event without creating PaymentIntent', async () => {
    const host = document.createElement('div');
    let cancelled = false;
    await adapter.mountExpressCheckout(host, {
      product,
      theme: 'light',
      onSuccess: () => undefined,
      onCancel: () => {
        cancelled = true;
      },
      onError: () => undefined,
    });

    const cancelHandler = expressCheckout.on.calls
      .allArgs()
      .find((args) => args[0] === 'cancel')?.[1] as () => void;
    cancelHandler();
    expect(cancelled).toBeTrue();
    expect(backend.createStripePayment).not.toHaveBeenCalled();
  });

  it('rejects createPayment for real Apple Pay', async () => {
    await expectAsync(
      adapter.createPayment({
        method: 'apple-pay',
        context: {
          product,
          theme: 'light',
        },
      }),
    ).toBeRejectedWith(jasmine.any(PaymentError));
  });

  it('cleans up on destroy and resets availability to idle', async () => {
    const host = document.createElement('div');
    await adapter.mountExpressCheckout(host, {
      product,
      theme: 'light',
      onSuccess: () => undefined,
      onCancel: () => undefined,
      onError: () => undefined,
    });
    expect(adapter.getAvailabilityStatus()).toBe('available');
    await adapter.destroy();
    expect(expressCheckout.unmount).toHaveBeenCalled();
    expect(expressCheckout.destroy).toHaveBeenCalled();
    expect(adapter.getAvailabilityStatus()).toBe('idle');
  });

  it('preserves availability when unmounting with preserveAvailability', async () => {
    const host = document.createElement('div');
    await adapter.mountExpressCheckout(host, {
      product,
      theme: 'light',
      onSuccess: () => undefined,
      onCancel: () => undefined,
      onError: () => undefined,
    });
    expect(adapter.getAvailabilityStatus()).toBe('available');
    expect(await adapter.isAvailable({ product, theme: 'light' })).toBeTrue();

    adapter.unmountExpressCheckout({ preserveAvailability: true });

    expect(expressCheckout.unmount).toHaveBeenCalled();
    expect(adapter.getAvailabilityStatus()).toBe('available');
    expect(await adapter.isAvailable({ product, theme: 'light' })).toBeTrue();
  });

  it('does not treat unknown/checking as available (TEST C)', async () => {
    await adapter.initialize();
    expect(adapter.getAvailabilityStatus()).toBe('idle');
    expect(await adapter.isAvailable({ product, theme: 'light' })).toBeFalse();
    expect(adapter.getAvailabilityStatus()).toBe('checking');
    expect(await adapter.isAvailable({ product, theme: 'light' })).toBeFalse();
  });

  it('exposes Apple Pay only after Stripe ready applePay:true (TEST A / E)', async () => {
    await adapter.initialize();
    expect(await adapter.isAvailable({ product, theme: 'light' })).toBeFalse();

    const host = document.createElement('div');
    await adapter.mountExpressCheckout(host, {
      product,
      theme: 'light',
      onSuccess: () => undefined,
      onCancel: () => undefined,
      onError: () => undefined,
    });

    expect(adapter.getAvailabilityStatus()).toBe('available');
    expect(await adapter.isAvailable({ product, theme: 'light' })).toBeTrue();
  });

  it('hides Apple Pay when Stripe ready reports applePay:false (TEST B / F)', async () => {
    emitReadyOnMount({ applePay: false });
    const host = document.createElement('div');
    await adapter.mountExpressCheckout(host, {
      product,
      theme: 'light',
      onSuccess: () => undefined,
      onCancel: () => undefined,
      onError: () => undefined,
    });
    expect(adapter.getAvailabilityStatus()).toBe('unavailable');
    expect(await adapter.isAvailable({ product, theme: 'light' })).toBeFalse();
  });

  it('does not leak preserved availability into a new product session (TEST H)', async () => {
    const host = document.createElement('div');
    await adapter.mountExpressCheckout(host, {
      product,
      theme: 'light',
      onSuccess: () => undefined,
      onCancel: () => undefined,
      onError: () => undefined,
    });
    adapter.unmountExpressCheckout({ preserveAvailability: true });
    expect(await adapter.isAvailable({ product, theme: 'light' })).toBeTrue();

    const otherProduct = { ...product, amount: 50 };
    expect(await adapter.isAvailable({ product: otherProduct, theme: 'light' })).toBeFalse();
    expect(adapter.getAvailabilityStatus()).toBe('checking');
  });

  it('keeps same-session availability across preserve unmount (TEST G)', async () => {
    const host = document.createElement('div');
    await adapter.mountExpressCheckout(host, {
      product,
      theme: 'light',
      onSuccess: () => undefined,
      onCancel: () => undefined,
      onError: () => undefined,
    });
    adapter.unmountExpressCheckout({ preserveAvailability: true });
    expect(await adapter.isAvailable({ product, theme: 'light' })).toBeTrue();
    adapter.unmountExpressCheckout({ preserveAvailability: true });
    expect(await adapter.isAvailable({ product, theme: 'light' })).toBeTrue();
  });

  it('clearAvailability drops a preserved ready result', async () => {
    const host = document.createElement('div');
    await adapter.mountExpressCheckout(host, {
      product,
      theme: 'light',
      onSuccess: () => undefined,
      onCancel: () => undefined,
      onError: () => undefined,
    });
    adapter.unmountExpressCheckout({ preserveAvailability: true });
    adapter.clearAvailability();
    expect(adapter.getAvailabilityStatus()).toBe('idle');
    expect(await adapter.isAvailable({ product, theme: 'light' })).toBeFalse();
  });

  it('does not sniff navigator.userAgent / platform for availability', async () => {
    const uaSpy = spyOnProperty(navigator, 'userAgent', 'get').and.callThrough();
    const platformSpy = spyOnProperty(navigator, 'platform', 'get').and.callThrough();
    await adapter.isAvailable({ product, theme: 'light' });
    const host = document.createElement('div');
    await adapter.mountExpressCheckout(host, {
      product,
      theme: 'light',
      onSuccess: () => undefined,
      onCancel: () => undefined,
      onError: () => undefined,
    });
    expect(uaSpy).not.toHaveBeenCalled();
    expect(platformSpy).not.toHaveBeenCalled();
  });

  it('configures ECE paymentMethods to Apple Pay only (never Google Pay)', async () => {
    const host = document.createElement('div');
    await adapter.mountExpressCheckout(host, {
      product,
      theme: 'light',
      onSuccess: () => undefined,
      onCancel: () => undefined,
      onError: () => undefined,
    });
    expect(elements.create).toHaveBeenCalledWith(
      'expressCheckout',
      jasmine.objectContaining({
        paymentMethods: jasmine.objectContaining({
          applePay: 'always',
          googlePay: 'never',
          link: 'never',
          paypal: 'never',
        }),
      }),
    );
  });

  it('keeps sibling ECE mounts when one host is destroyed', async () => {
    const hostA = document.createElement('div');
    const hostB = document.createElement('div');
    const idA = adapter.createMountId();
    const idB = adapter.createMountId();

    // Second mount needs its own ECE stub instance.
    const expressB = jasmine.createSpyObj('expressB', ['mount', 'unmount', 'destroy', 'on']);
    expressB.on.and.returnValue(expressB);
    expressB.mount.and.callFake(() => {
      const ready = expressB.on.calls
        .allArgs()
        .find((args: unknown[]) => args[0] === 'ready')?.[1] as
        | ((event: { availablePaymentMethods?: unknown }) => void)
        | undefined;
      ready?.({ availablePaymentMethods: { applePay: true } });
    });
    let createCount = 0;
    elements.create.and.callFake(() => {
      createCount += 1;
      return createCount === 1 ? expressCheckout : expressB;
    });

    await adapter.mountExpressCheckout(
      hostA,
      {
        product,
        theme: 'light',
        onSuccess: () => undefined,
        onCancel: () => undefined,
        onError: () => undefined,
      },
      idA,
    );
    await adapter.mountExpressCheckout(
      hostB,
      {
        product: { ...product, id: 'other-plan' },
        theme: 'light',
        onSuccess: () => undefined,
        onCancel: () => undefined,
        onError: () => undefined,
      },
      idB,
    );

    expect(adapter.getActiveEceMountCount()).toBe(2);
    expect(expressCheckout.mount).toHaveBeenCalledWith(hostA);
    expect(expressB.mount).toHaveBeenCalledWith(hostB);

    adapter.unmountExpressCheckout({ preserveAvailability: true, mountId: idA });
    expect(expressCheckout.unmount).toHaveBeenCalled();
    expect(expressB.unmount).not.toHaveBeenCalled();
    expect(adapter.getActiveEceMountCount()).toBe(1);

    adapter.unmountExpressCheckout({ mountId: idB });
    expect(expressB.unmount).toHaveBeenCalled();
    expect(adapter.getActiveEceMountCount()).toBe(0);
  });
});

describe('Apple Pay / Google Pay coexistence (capability flags)', () => {
  it('treats Apple and Google availability independently', () => {
    const appleOnly = { applePay: true, googlePay: false };
    const googleOnly = { applePay: false, googlePay: true };
    const both = { applePay: true, googlePay: true };
    const neither = { applePay: false, googlePay: false };

    expect(!!appleOnly.applePay && !appleOnly.googlePay).toBeTrue();
    expect(!googleOnly.applePay && !!googleOnly.googlePay).toBeTrue();
    expect(!!both.applePay && !!both.googlePay).toBeTrue();
    expect(!neither.applePay && !neither.googlePay).toBeTrue();
  });
});
