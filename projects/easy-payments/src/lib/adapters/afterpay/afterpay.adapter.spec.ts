import { TestBed } from '@angular/core/testing';
import { provideEasyPayments } from '../../config/provide-easy-payments';
import { EasyPaymentsConfigService } from '../../config/easy-payments-config.service';
import { BackendService } from '../../services/backend.service';
import { PaymentError } from '../../errors/payment-error';
import { SAMPLE_PRODUCT } from '../../testing/test-doubles';
import { resetTestLocation, setTestLocation } from '../../testing/test-history';
import { AfterpayAdapter } from './afterpay.adapter';
import { StripeSdkLoader } from '../stripe/stripe-sdk.loader';
import { StripeRedirectRecoveryService } from '../stripe/stripe-redirect-recovery.service';

describe('AfterpayAdapter', () => {
  let adapter: AfterpayAdapter;
  let backend: jasmine.SpyObj<BackendService>;
  let sdkLoader: jasmine.SpyObj<StripeSdkLoader>;
  let recovery: StripeRedirectRecoveryService;

  const mount = jasmine.createSpy('mount');
  const unmount = jasmine.createSpy('unmount');
  const submit = jasmine.createSpy('submit').and.resolveTo({ error: undefined });
  const update = jasmine.createSpy('update');
  const create = jasmine.createSpy('create').and.returnValue({ mount, unmount });
  const elements = jasmine.createSpy('elements').and.returnValue({ create, submit, update });
  const confirmPayment = jasmine.createSpy('confirmPayment');
  const retrievePaymentIntent = jasmine.createSpy('retrievePaymentIntent');

  const stripeMock = {
    elements,
    confirmPayment,
    retrievePaymentIntent,
  };

  beforeEach(() => {
    TestBed.resetTestingModule();
    backend = jasmine.createSpyObj<BackendService>('BackendService', ['createAfterpayPayment']);
    sdkLoader = jasmine.createSpyObj<StripeSdkLoader>('StripeSdkLoader', ['load']);
    sdkLoader.load.and.resolveTo(stripeMock as never);
    resetTestLocation();
    sessionStorage.clear();
    confirmPayment.calls.reset();
    retrievePaymentIntent.calls.reset();
    elements.calls.reset();
    create.calls.reset();
    submit.calls.reset();

    TestBed.configureTestingModule({
      providers: [
        provideEasyPayments({
          enableMockMode: false,
          providers: {
            stripe: { publishableKey: 'pk_test_123456789' },
            afterpay: {},
          },
          backend: {
            afterpayCreatePaymentUrl: '/api/payments/afterpay/create',
          },
        }),
        { provide: BackendService, useValue: backend },
        { provide: StripeSdkLoader, useValue: sdkLoader },
      ],
    });

    recovery = TestBed.inject(StripeRedirectRecoveryService);
    recovery.resetForTests();
    adapter = TestBed.inject(AfterpayAdapter);
  });

  afterEach(() => {
    recovery.resetForTests();
    sessionStorage.clear();
    resetTestLocation();
  });

  it('is unavailable when Afterpay is not opted in', async () => {
    TestBed.inject(EasyPaymentsConfigService).replace({
      enableMockMode: false,
      providers: {
        stripe: { publishableKey: 'pk_test_123456789' },
      },
      backend: { afterpayCreatePaymentUrl: '/api/payments/afterpay/create' },
    });
    await adapter.initialize();
    expect(
      await adapter.isAvailable({ product: { ...SAMPLE_PRODUCT }, theme: 'light' }),
    ).toBeFalse();
  });

  it('is unavailable for unsupported currency', async () => {
    await adapter.initialize();
    expect(
      await adapter.isAvailable({
        product: { ...SAMPLE_PRODUCT, currency: 'EUR' },
        theme: 'light',
      }),
    ).toBeFalse();
  });

  it('is unavailable below the currency minimum (USD $1)', async () => {
    await adapter.initialize();
    expect(
      await adapter.isAvailable({
        product: { ...SAMPLE_PRODUCT, amount: 0.5, quantity: 1, currency: 'USD' },
        theme: 'light',
      }),
    ).toBeFalse();
  });

  it('is unavailable above the currency maximum (GBP £1200)', async () => {
    await adapter.initialize();
    expect(
      await adapter.isAvailable({
        product: { ...SAMPLE_PRODUCT, amount: 1200.01, quantity: 1, currency: 'GBP' },
        theme: 'light',
      }),
    ).toBeFalse();
  });

  it('is available for supported currencies within limits when opted in', async () => {
    await adapter.initialize();
    expect(
      await adapter.isAvailable({
        product: { ...SAMPLE_PRODUCT, amount: 1, quantity: 1, currency: 'USD' },
        theme: 'light',
      }),
    ).toBeTrue();
    expect(
      await adapter.isAvailable({
        product: { ...SAMPLE_PRODUCT, amount: 2000, quantity: 1, currency: 'CAD' },
        theme: 'light',
      }),
    ).toBeTrue();
    expect(
      await adapter.isAvailable({
        product: { ...SAMPLE_PRODUCT, amount: 4000, quantity: 1, currency: 'AUD' },
        theme: 'light',
      }),
    ).toBeTrue();
    expect(
      await adapter.isAvailable({
        product: { ...SAMPLE_PRODUCT, amount: 1, quantity: 1, currency: 'NZD' },
        theme: 'light',
      }),
    ).toBeTrue();
    expect(
      await adapter.isAvailable({
        product: { ...SAMPLE_PRODUCT, amount: 1200, quantity: 1, currency: 'GBP' },
        theme: 'light',
      }),
    ).toBeTrue();
  });

  it('creates a payment session without a client amount', async () => {
    backend.createAfterpayPayment.and.resolveTo({
      provider: 'afterpay',
      clientSecret: 'pi_cash_secret',
      paymentIntentId: 'pi_cash_1',
    });

    const session = await adapter.createPaymentSession({ ...SAMPLE_PRODUCT, quantity: 2 });

    expect(backend.createAfterpayPayment).toHaveBeenCalledTimes(1);
    expect(backend.createAfterpayPayment).toHaveBeenCalledWith({
      productId: 'premium-plan',
      quantity: 2,
      currency: 'USD',
    });
    expect(session.clientSecret).toBe('pi_cash_secret');
  });

  it('normalizes succeeded and cancelled confirmations', async () => {
    backend.createAfterpayPayment.and.resolveTo({
      provider: 'afterpay',
      clientSecret: 'pi_cash_secret',
      paymentIntentId: 'pi_cash_1',
    });

    await adapter.createPaymentSession({ ...SAMPLE_PRODUCT });
    await adapter.mountPaymentElement(document.createElement('div'), 'pi_cash_secret', 'light');

    confirmPayment.and.resolveTo({
      paymentIntent: { id: 'pi_cash_1', status: 'succeeded' },
    });
    const success = await adapter.confirmPayment(`${window.location.origin}/return`);
    expect(success.status).toBe('success');
    expect(success.method).toBe('afterpay');
    expect(success.provider).toBe('afterpay');

    confirmPayment.and.resolveTo({
      paymentIntent: { id: 'pi_cash_1', status: 'canceled' },
    });
    const cancelled = await adapter.confirmPayment();
    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.method).toBe('afterpay');
  });

  it('rejects duplicate confirmation while one is in progress', async () => {
    backend.createAfterpayPayment.and.resolveTo({
      provider: 'afterpay',
      clientSecret: 'pi_cash_secret',
      paymentIntentId: 'pi_cash_1',
    });
    let resolveConfirm: (value: unknown) => void = () => undefined;
    confirmPayment.and.returnValue(
      new Promise((resolve) => {
        resolveConfirm = resolve;
      }),
    );

    await adapter.createPaymentSession({ ...SAMPLE_PRODUCT });
    await adapter.mountPaymentElement(document.createElement('div'), 'pi_cash_secret', 'light');

    const first = adapter.confirmPayment();
    await expectAsync(adapter.confirmPayment()).toBeRejectedWith(
      jasmine.objectContaining({ code: 'PAYMENT_FAILED' }),
    );
    resolveConfirm({ paymentIntent: { id: 'pi_cash_1', status: 'succeeded' } });
    await expectAsync(first).toBeResolvedTo(
      jasmine.objectContaining({ status: 'success', method: 'afterpay' }),
    );
  });

  it('maps Stripe confirm errors to afterpay / afterpay', async () => {
    backend.createAfterpayPayment.and.resolveTo({
      provider: 'afterpay',
      clientSecret: 'pi_cash_secret',
    });
    confirmPayment.and.resolveTo({
      error: { type: 'card_error', message: 'Afterpay declined' },
    });

    await adapter.createPaymentSession({ ...SAMPLE_PRODUCT });
    await adapter.mountPaymentElement(document.createElement('div'), 'pi_cash_secret', 'light');

    try {
      await adapter.confirmPayment();
      fail('expected decline');
    } catch (error) {
      expect(error).toBeInstanceOf(PaymentError);
      expect((error as PaymentError).method).toBe('afterpay');
      expect((error as PaymentError).provider).toBe('afterpay');
    }
  });

  it('retrieves a returning PaymentIntent without creating a new session', async () => {
    retrievePaymentIntent.and.resolveTo({
      paymentIntent: { id: 'pi_cash_return', status: 'succeeded' },
    });

    const result = await adapter.retrieveReturningPayment('pi_cash_return_secret');

    expect(backend.createAfterpayPayment).not.toHaveBeenCalled();
    expect(retrievePaymentIntent).toHaveBeenCalledWith('pi_cash_return_secret');
    expect(result.status).toBe('success');
    expect(result.method).toBe('afterpay');
    expect(result.provider).toBe('afterpay');
  });

  it('consumeStripeReturn recovers once and cleans the URL', async () => {
    setTestLocation(
      '/?payment_intent=pi_once&payment_intent_client_secret=sec_once&ep_method=afterpay&redirect_status=succeeded',
    );
    retrievePaymentIntent.and.resolveTo({
      paymentIntent: { id: 'pi_once', status: 'succeeded' },
    });

    const first = await adapter.consumeStripeReturn();
    const second = await adapter.consumeStripeReturn();

    expect(first?.status).toBe('success');
    expect(first?.transactionId).toBe('pi_once');
    expect(second).toBe(first);
    expect(retrievePaymentIntent).toHaveBeenCalledTimes(1);
    expect(adapter.wasReturnConsumed()).toBeTrue();
    expect(window.location.search).not.toContain('payment_intent_client_secret');
    expect(window.location.search).not.toContain('ep_method');
  });
});
