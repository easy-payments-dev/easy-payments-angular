import { TestBed } from '@angular/core/testing';
import { provideEasyPayments } from '../../config/provide-easy-payments';
import { EasyPaymentsConfigService } from '../../config/easy-payments-config.service';
import { BackendService } from '../../services/backend.service';
import { PaymentError } from '../../errors/payment-error';
import { SAMPLE_PRODUCT } from '../../testing/test-doubles';
import { resetTestLocation, setTestLocation } from '../../testing/test-history';
import { CashAppPayAdapter } from './cash-app-pay.adapter';
import { StripeSdkLoader } from '../stripe/stripe-sdk.loader';
import { StripeRedirectRecoveryService } from '../stripe/stripe-redirect-recovery.service';

describe('CashAppPayAdapter', () => {
  let adapter: CashAppPayAdapter;
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
    backend = jasmine.createSpyObj<BackendService>('BackendService', ['createCashAppPayPayment']);
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
            cashAppPay: {},
          },
          backend: {
            cashAppPayCreatePaymentUrl: '/api/payments/cash-app-pay/create',
          },
        }),
        { provide: BackendService, useValue: backend },
        { provide: StripeSdkLoader, useValue: sdkLoader },
      ],
    });

    recovery = TestBed.inject(StripeRedirectRecoveryService);
    recovery.resetForTests();
    adapter = TestBed.inject(CashAppPayAdapter);
  });

  afterEach(() => {
    recovery.resetForTests();
    sessionStorage.clear();
    resetTestLocation();
  });

  it('is unavailable when Cash App Pay is not opted in', async () => {
    TestBed.inject(EasyPaymentsConfigService).replace({
      enableMockMode: false,
      providers: {
        stripe: { publishableKey: 'pk_test_123456789' },
      },
      backend: { cashAppPayCreatePaymentUrl: '/api/payments/cash-app-pay/create' },
    });
    await adapter.initialize();
    expect(
      await adapter.isAvailable({ product: { ...SAMPLE_PRODUCT }, theme: 'light' }),
    ).toBeFalse();
  });

  it('is unavailable for non-USD currency', async () => {
    await adapter.initialize();
    expect(
      await adapter.isAvailable({
        product: { ...SAMPLE_PRODUCT, currency: 'EUR' },
        theme: 'light',
      }),
    ).toBeFalse();
  });

  it('is unavailable below the $0.50 minimum', async () => {
    await adapter.initialize();
    expect(
      await adapter.isAvailable({
        product: { ...SAMPLE_PRODUCT, amount: 0.25, quantity: 1 },
        theme: 'light',
      }),
    ).toBeFalse();
  });

  it('is available for USD at or above $0.50 when opted in', async () => {
    await adapter.initialize();
    expect(
      await adapter.isAvailable({
        product: { ...SAMPLE_PRODUCT, amount: 0.5, quantity: 1, currency: 'USD' },
        theme: 'light',
      }),
    ).toBeTrue();
  });

  it('creates a payment session without a client amount', async () => {
    backend.createCashAppPayPayment.and.resolveTo({
      provider: 'cashAppPay',
      clientSecret: 'pi_cash_secret',
      paymentIntentId: 'pi_cash_1',
    });

    const session = await adapter.createPaymentSession({ ...SAMPLE_PRODUCT, quantity: 2 });

    expect(backend.createCashAppPayPayment).toHaveBeenCalledTimes(1);
    expect(backend.createCashAppPayPayment).toHaveBeenCalledWith({
      productId: 'premium-plan',
      quantity: 2,
      currency: 'USD',
    });
    expect(session.clientSecret).toBe('pi_cash_secret');
  });

  it('normalizes succeeded and cancelled confirmations', async () => {
    backend.createCashAppPayPayment.and.resolveTo({
      provider: 'cashAppPay',
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
    expect(success.method).toBe('cash-app-pay');
    expect(success.provider).toBe('cashAppPay');

    confirmPayment.and.resolveTo({
      paymentIntent: { id: 'pi_cash_1', status: 'canceled' },
    });
    const cancelled = await adapter.confirmPayment();
    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.method).toBe('cash-app-pay');
  });

  it('rejects duplicate confirmation while one is in progress', async () => {
    backend.createCashAppPayPayment.and.resolveTo({
      provider: 'cashAppPay',
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
      jasmine.objectContaining({ status: 'success', method: 'cash-app-pay' }),
    );
  });

  it('maps Stripe confirm errors to cash-app-pay / cashAppPay', async () => {
    backend.createCashAppPayPayment.and.resolveTo({
      provider: 'cashAppPay',
      clientSecret: 'pi_cash_secret',
    });
    confirmPayment.and.resolveTo({
      error: { type: 'card_error', message: 'Cash App declined' },
    });

    await adapter.createPaymentSession({ ...SAMPLE_PRODUCT });
    await adapter.mountPaymentElement(document.createElement('div'), 'pi_cash_secret', 'light');

    try {
      await adapter.confirmPayment();
      fail('expected decline');
    } catch (error) {
      expect(error).toBeInstanceOf(PaymentError);
      expect((error as PaymentError).method).toBe('cash-app-pay');
      expect((error as PaymentError).provider).toBe('cashAppPay');
    }
  });

  it('retrieves a returning PaymentIntent without creating a new session', async () => {
    retrievePaymentIntent.and.resolveTo({
      paymentIntent: { id: 'pi_cash_return', status: 'succeeded' },
    });

    const result = await adapter.retrieveReturningPayment('pi_cash_return_secret');

    expect(backend.createCashAppPayPayment).not.toHaveBeenCalled();
    expect(retrievePaymentIntent).toHaveBeenCalledWith('pi_cash_return_secret');
    expect(result.status).toBe('success');
    expect(result.method).toBe('cash-app-pay');
    expect(result.provider).toBe('cashAppPay');
  });

  it('consumeStripeReturn recovers once and cleans the URL', async () => {
    setTestLocation(
      '/?payment_intent=pi_once&payment_intent_client_secret=sec_once&ep_method=cash-app-pay&redirect_status=succeeded',
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
