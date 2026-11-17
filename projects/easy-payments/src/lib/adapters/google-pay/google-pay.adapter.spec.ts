import { TestBed } from '@angular/core/testing';
import { PLATFORM_ID } from '@angular/core';
import { provideHttpClient, withXhr } from '@angular/common/http';
import { provideEasyPayments } from '../../config/provide-easy-payments';
import { BackendService } from '../../services/backend.service';
import { StripeConfirmationGate } from '../stripe/stripe-confirmation-gate';
import { StripeSdkLoader } from '../stripe/stripe-sdk.loader';
import { PaymentError } from '../../errors/payment-error';
import { GooglePayAdapter } from './google-pay.adapter';
import { GooglePaySdkLoader } from './google-pay-sdk.loader';
import {
  GOOGLE_PAY_TEST_MERCHANT_ID,
  GooglePayPaymentsClient,
  GooglePayNamespace,
} from './google-pay.types';

describe('GooglePayAdapter', () => {
  let adapter: GooglePayAdapter;
  let backend: jasmine.SpyObj<BackendService>;
  let googlePaySdk: jasmine.SpyObj<GooglePaySdkLoader>;
  let stripeSdk: jasmine.SpyObj<StripeSdkLoader>;
  let paymentsClient: jasmine.SpyObj<GooglePayPaymentsClient>;
  let googleNs: GooglePayNamespace;

  beforeEach(async () => {
    paymentsClient = jasmine.createSpyObj<GooglePayPaymentsClient>('PaymentsClient', [
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

    googleNs = {
      payments: {
        api: {
          PaymentsClient: jasmine
            .createSpy('PaymentsClient')
            .and.returnValue(paymentsClient) as unknown as GooglePayNamespace['payments']['api']['PaymentsClient'],
        },
      },
    };

    backend = jasmine.createSpyObj<BackendService>('BackendService', ['createStripePayment']);
    googlePaySdk = jasmine.createSpyObj<GooglePaySdkLoader>('GooglePaySdkLoader', ['load']);
    googlePaySdk.load.and.resolveTo(googleNs);
    stripeSdk = jasmine.createSpyObj<StripeSdkLoader>('StripeSdkLoader', ['load']);

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withXhr()),
        { provide: PLATFORM_ID, useValue: 'browser' },
        provideEasyPayments({
          enableMockMode: false,
          providers: {
            stripe: { publishableKey: 'pk_test_123' },
            googlePay: {
              environment: 'TEST',
              merchantName: 'Easy Payments Demo',
            },
          },
          backend: {
            createPaymentUrl: '/api/payments/create',
          },
        }),
        { provide: BackendService, useValue: backend },
        { provide: GooglePaySdkLoader, useValue: googlePaySdk },
        { provide: StripeSdkLoader, useValue: stripeSdk },
      ],
    });

    adapter = TestBed.inject(GooglePayAdapter);
    await adapter.initialize();
  });

  it('initializes without loading the Google Pay SDK', () => {
    expect(googlePaySdk.load).not.toHaveBeenCalled();
  });

  it('lazy-loads the SDK once for PaymentsClient', async () => {
    await adapter.ensurePaymentsClient();
    await adapter.ensurePaymentsClient();
    expect(googlePaySdk.load).toHaveBeenCalledTimes(1);
    expect(googleNs.payments.api.PaymentsClient).toHaveBeenCalledWith({ environment: 'TEST' });
  });

  it('reports available when isReadyToPay is true', async () => {
    expect(
      await adapter.isAvailable({
        product: { id: 'premium-plan', name: 'P', amount: 99.99, currency: 'USD' },
        theme: 'light',
      }),
    ).toBeTrue();
    expect(paymentsClient.isReadyToPay).toHaveBeenCalled();
  });

  it('reports unavailable when isReadyToPay is false', async () => {
    paymentsClient.isReadyToPay.and.resolveTo({ result: false });
    expect(
      await adapter.isAvailable({
        product: { id: 'premium-plan', name: 'P', amount: 99.99, currency: 'USD' },
        theme: 'light',
      }),
    ).toBeFalse();
  });

  it('builds Stripe gateway tokenization using the publishable key', () => {
    const method = adapter.buildAllowedPaymentMethod();
    expect(method.tokenizationSpecification.parameters).toEqual({
      gateway: 'stripe',
      'stripe:version': '2018-10-31',
      'stripe:publishableKey': 'pk_test_123',
    });
  });

  it('builds payment data request with trusted total and TEST merchantId default', () => {
    const request = adapter.buildPaymentDataRequest({
      totalPrice: '99.99',
      currencyCode: 'USD',
    });
    expect(request.transactionInfo.totalPrice).toBe('99.99');
    expect(request.merchantInfo.merchantId).toBe(GOOGLE_PAY_TEST_MERCHANT_ID);
    expect(request.merchantInfo.merchantName).toBe('Easy Payments Demo');
  });

  it('renders the official Google Pay button once', async () => {
    const host = document.createElement('div');
    const mountId = await adapter.renderOfficialButton(host, {
      theme: 'light',
      onClick: () => undefined,
      buttonLocale: 'es',
    });
    expect(paymentsClient.createButton).toHaveBeenCalledTimes(1);
    expect(paymentsClient.createButton).toHaveBeenCalledWith(
      jasmine.objectContaining({
        buttonLocale: 'es',
        buttonType: 'pay',
      }),
    );
    expect(host.querySelector('button')).toBeTruthy();
    expect(adapter.getActiveButtonMountCount()).toBe(1);

    adapter.destroyButtonMount(mountId);
    expect(host.querySelector('button')).toBeNull();
    expect(adapter.getActiveButtonMountCount()).toBe(0);
  });

  it('uses the logo-only short button (no signed-in card-info swap) for compact mounts', async () => {
    const host = document.createElement('div');
    await adapter.renderOfficialButton(host, {
      theme: 'dark',
      compact: true,
      onClick: () => undefined,
    });
    expect(paymentsClient.createButton).toHaveBeenCalledWith(
      jasmine.objectContaining({
        buttonType: 'short',
        buttonColor: 'white',
        buttonSizeMode: 'fill',
      }),
    );
  });

  it('keeps sibling Google Pay button mounts when one host is destroyed', async () => {
    const hostA = document.createElement('div');
    const hostB = document.createElement('div');
    const mountA = await adapter.renderOfficialButton(hostA, {
      theme: 'light',
      onClick: () => undefined,
    });
    const mountB = await adapter.renderOfficialButton(hostB, {
      theme: 'light',
      onClick: () => undefined,
    });

    expect(mountA).not.toBe(mountB);
    expect(adapter.getActiveButtonMountCount()).toBe(2);
    expect(hostA.querySelector('button')).toBeTruthy();
    expect(hostB.querySelector('button')).toBeTruthy();

    adapter.destroyButtonMount(mountA);
    expect(hostA.querySelector('button')).toBeNull();
    expect(hostB.querySelector('button')).toBeTruthy();
    expect(adapter.getActiveButtonMountCount()).toBe(1);

    await adapter.renderOfficialButton(
      hostB,
      { theme: 'dark', onClick: () => undefined },
      mountB,
    );
    expect(adapter.getActiveButtonMountCount()).toBe(1);
    expect(hostB.querySelector('button')).toBeTruthy();

    await adapter.destroy();
    expect(adapter.getActiveButtonMountCount()).toBe(0);
    expect(hostB.querySelector('button')).toBeNull();
  });

  it('creates a PaymentIntent only when paying, then confirms with the Google token', async () => {
    backend.createStripePayment.and.resolveTo({
      provider: 'stripe',
      clientSecret: 'pi_secret',
      paymentIntentId: 'pi_1',
    });
    paymentsClient.loadPaymentData.and.resolveTo({
      paymentMethodData: {
        tokenizationData: { token: JSON.stringify({ id: 'tok_gpay' }) },
        info: { cardNetwork: 'VISA', cardDetails: '4242' },
      },
    });

    const createPaymentMethod = jasmine
      .createSpy('createPaymentMethod')
      .and.resolveTo({ paymentMethod: { id: 'pm_1' } });
    const confirmCardPayment = jasmine.createSpy('confirmCardPayment').and.resolveTo({
      paymentIntent: { id: 'pi_1', status: 'succeeded' },
    });
    stripeSdk.load.and.resolveTo({
      createPaymentMethod,
      confirmCardPayment,
    } as never);

    const result = await adapter.payWithGooglePay({
      id: 'premium-plan',
      name: 'Premium Plan',
      amount: 99.99,
      currency: 'USD',
      quantity: 1,
    });

    expect(backend.createStripePayment).toHaveBeenCalledTimes(1);
    expect(backend.createStripePayment).toHaveBeenCalledWith(
      jasmine.objectContaining({
        provider: 'stripe',
        productId: 'premium-plan',
        quantity: 1,
        metadata: jasmine.objectContaining({ checkoutMethod: 'google-pay' }),
      }),
    );
    expect(paymentsClient.loadPaymentData).toHaveBeenCalled();
    expect(createPaymentMethod).toHaveBeenCalledWith({
      type: 'card',
      card: { token: 'tok_gpay' },
    });
    expect(confirmCardPayment).toHaveBeenCalledWith('pi_secret', {
      payment_method: 'pm_1',
    });
    expect(result).toEqual(
      jasmine.objectContaining({
        status: 'success',
        method: 'google-pay',
        provider: 'googlePay',
        transactionId: 'pi_1',
      }),
    );
  });

  it('starts loadPaymentData without waiting for PaymentIntent create to finish', async () => {
    let resolveCreate!: (value: {
      provider: 'stripe';
      clientSecret: string;
      paymentIntentId: string;
    }) => void;
    let resolveLoad!: (value: {
      paymentMethodData: {
        tokenizationData: { token: string };
        info: { cardNetwork: string; cardDetails: string };
      };
    }) => void;
    backend.createStripePayment.and.returnValue(
      new Promise((resolve) => {
        resolveCreate = resolve;
      }),
    );
    paymentsClient.loadPaymentData.and.returnValue(
      new Promise((resolve) => {
        resolveLoad = resolve;
      }),
    );
    const createPaymentMethod = jasmine
      .createSpy('createPaymentMethod')
      .and.resolveTo({ paymentMethod: { id: 'pm_1' } });
    const confirmCardPayment = jasmine.createSpy('confirmCardPayment').and.resolveTo({
      paymentIntent: { id: 'pi_1', status: 'succeeded' },
    });
    stripeSdk.load.and.resolveTo({
      createPaymentMethod,
      confirmCardPayment,
    } as never);

    const pay = adapter.payWithGooglePay({
      id: 'premium-plan',
      name: 'Premium Plan',
      amount: 99.99,
      currency: 'USD',
    });
    for (let i = 0; i < 10 && !paymentsClient.loadPaymentData.calls.any(); i++) {
      await Promise.resolve();
    }
    expect(paymentsClient.loadPaymentData).toHaveBeenCalled();
    expect(backend.createStripePayment).toHaveBeenCalled();
    expect(confirmCardPayment).not.toHaveBeenCalled();

    resolveLoad({
      paymentMethodData: {
        tokenizationData: { token: JSON.stringify({ id: 'tok_gpay' }) },
        info: { cardNetwork: 'VISA', cardDetails: '4242' },
      },
    });
    await Promise.resolve();
    expect(confirmCardPayment).not.toHaveBeenCalled();

    resolveCreate({
      provider: 'stripe',
      clientSecret: 'pi_secret',
      paymentIntentId: 'pi_1',
    });
    await expectAsync(pay).toBeResolvedTo(
      jasmine.objectContaining({ status: 'success', transactionId: 'pi_1' }),
    );
  });

  it('normalizes sheet cancellation', async () => {
    backend.createStripePayment.and.resolveTo({
      provider: 'stripe',
      clientSecret: 'pi_secret',
      paymentIntentId: 'pi_1',
    });
    paymentsClient.loadPaymentData.and.rejectWith({ statusCode: 'CANCELED' });

    await expectAsync(
      adapter.payWithGooglePay({
        id: 'premium-plan',
        name: 'Premium Plan',
        amount: 99.99,
        currency: 'USD',
      }),
    ).toBeRejectedWith(jasmine.objectContaining({ code: 'PAYMENT_CANCELLED' }));
  });

  it('does not hold StripeConfirmationGate while the Google sheet is open', async () => {
    let rejectLoad!: (reason?: unknown) => void;
    backend.createStripePayment.and.resolveTo({
      provider: 'stripe',
      clientSecret: 'pi_secret',
      paymentIntentId: 'pi_1',
    });
    paymentsClient.loadPaymentData.and.returnValue(
      new Promise((_resolve, reject) => {
        rejectLoad = reject;
      }),
    );
    const gate = TestBed.inject(StripeConfirmationGate);

    const pay = adapter.payWithGooglePay(
      { id: 'premium-plan', name: 'P', amount: 99.99, currency: 'USD' },
      undefined,
      'owner-sheet',
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(adapter.isProcessing('owner-sheet')).toBeTrue();
    expect(gate.isHeld()).toBeFalse();

    // Card may acquire while Google sheet is still open (no Stripe confirm yet).
    expect(() => gate.acquire('card:next', 'card', 'stripe')).not.toThrow();
    gate.clear();

    rejectLoad({ statusCode: 'CANCELED' });
    await expectAsync(pay).toBeRejectedWith(
      jasmine.objectContaining({ code: 'PAYMENT_CANCELLED' }),
    );
    expect(gate.isHeld()).toBeFalse();
  });

  it('abandonInFlight before confirmation releases ownership so Card can acquire the gate', async () => {
    let rejectLoad!: (reason?: unknown) => void;
    backend.createStripePayment.and.resolveTo({
      provider: 'stripe',
      clientSecret: 'pi_secret',
      paymentIntentId: 'pi_1',
    });
    paymentsClient.loadPaymentData.and.returnValue(
      new Promise((_resolve, reject) => {
        rejectLoad = reject;
      }),
    );
    const gate = TestBed.inject(StripeConfirmationGate);

    const pay = adapter.payWithGooglePay(
      { id: 'premium-plan', name: 'P', amount: 99.99, currency: 'USD' },
      undefined,
      'owner-a',
    );
    // PI create runs in parallel with the hung sheet; flush until create settles into inflight.
    for (let i = 0; i < 20 && !backend.createStripePayment.calls.any(); i++) {
      await Promise.resolve();
    }
    await Promise.resolve();
    await Promise.resolve();
    expect(adapter.isProcessing('owner-a')).toBeTrue();

    const inflight = adapter.abandonInFlight('owner-a');
    expect(inflight?.clientSecret).toBe('pi_secret');
    expect(inflight?.confirmationStarted).toBeFalse();
    expect(adapter.isProcessing('owner-a')).toBeFalse();
    expect(gate.isHeld()).toBeFalse();
    expect(() => gate.acquire('card:after-gpay', 'card', 'stripe')).not.toThrow();
    gate.clear();

    rejectLoad({ statusCode: 'CANCELED' });
    await expectAsync(pay).toBeRejectedWith(
      jasmine.objectContaining({ message: jasmine.stringMatching(/interrupted/i) }),
    );
    // Late sheet rejection must not leave or re-take the gate.
    expect(gate.isHeld()).toBeFalse();
  });

  it('abandonInFlight after confirmation started releases only that attempt; late settle cannot unlock a newer hold', async () => {
    let resolveConfirm!: (value: unknown) => void;
    backend.createStripePayment.and.resolveTo({
      provider: 'stripe',
      clientSecret: 'pi_secret',
      paymentIntentId: 'pi_1',
    });
    paymentsClient.loadPaymentData.and.resolveTo({
      paymentMethodData: {
        tokenizationData: { token: JSON.stringify({ id: 'tok_1' }) },
        info: { cardNetwork: 'VISA', cardDetails: '4242' },
      },
    });
    const createPaymentMethod = jasmine
      .createSpy('createPaymentMethod')
      .and.resolveTo({ paymentMethod: { id: 'pm_1' } });
    const confirmCardPayment = jasmine.createSpy('confirmCardPayment').and.returnValue(
      new Promise((resolve) => {
        resolveConfirm = resolve;
      }),
    );
    stripeSdk.load.and.resolveTo({
      createPaymentMethod,
      confirmCardPayment,
    } as never);
    const gate = TestBed.inject(StripeConfirmationGate);

    const pay = adapter.payWithGooglePay(
      { id: 'premium-plan', name: 'P', amount: 99.99, currency: 'USD' },
      undefined,
      'owner-confirm',
    );
    // Wait until Stripe confirm is in flight (gate held).
    for (let i = 0; i < 20 && !confirmCardPayment.calls.any(); i++) {
      await Promise.resolve();
    }
    expect(confirmCardPayment).toHaveBeenCalled();
    expect(gate.isHeldBy('google-pay:owner-confirm')).toBeTrue();

    const inflight = adapter.abandonInFlight('owner-confirm');
    expect(inflight?.confirmationStarted).toBeTrue();
    expect(gate.isHeld()).toBeFalse();

    const releaseCard = gate.acquire('card:next', 'card', 'stripe');
    resolveConfirm({ paymentIntent: { id: 'pi_1', status: 'succeeded' } });
    await expectAsync(pay).toBeRejectedWith(
      jasmine.objectContaining({ message: jasmine.stringMatching(/interrupted/i) }),
    );
    // Late Google Pay settle must not drop Card's hold.
    expect(gate.isHeldBy('card:next')).toBeTrue();
    releaseCard();
  });

  it('prevents duplicate payment attempts', async () => {
    let resolveCreate!: (value: {
      provider: 'stripe';
      clientSecret: string;
      paymentIntentId: string;
    }) => void;
    let rejectLoad!: (reason?: unknown) => void;
    backend.createStripePayment.and.returnValue(
      new Promise((resolve) => {
        resolveCreate = resolve;
      }),
    );
    paymentsClient.loadPaymentData.and.returnValue(
      new Promise((_resolve, reject) => {
        rejectLoad = reject;
      }),
    );

    const first = adapter.payWithGooglePay({
      id: 'premium-plan',
      name: 'P',
      amount: 99.99,
      currency: 'USD',
    });
    await Promise.resolve();
    await Promise.resolve();
    const second = adapter.payWithGooglePay({
      id: 'premium-plan',
      name: 'P',
      amount: 99.99,
      currency: 'USD',
    });

    await expectAsync(second).toBeRejectedWith(jasmine.any(PaymentError));
    resolveCreate({
      provider: 'stripe',
      clientSecret: 'pi_secret',
      paymentIntentId: 'pi_1',
    });
    rejectLoad({ statusCode: 'CANCELED' });
    await expectAsync(first).toBeRejected();
  });

  it('rejects direct createPayment for real Google Pay', async () => {
    await expectAsync(
      adapter.createPayment({
        method: 'google-pay',
        context: {
          product: { id: 'premium-plan', name: 'P', amount: 1, currency: 'USD' },
          theme: 'light',
        },
      }),
    ).toBeRejectedWith(jasmine.any(PaymentError));
  });
});
