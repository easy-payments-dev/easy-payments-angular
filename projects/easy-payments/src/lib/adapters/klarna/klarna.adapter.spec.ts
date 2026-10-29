import { TestBed } from '@angular/core/testing';
import { provideEasyPayments } from '../../config/provide-easy-payments';
import { EasyPaymentsConfigService } from '../../config/easy-payments-config.service';
import { BackendService } from '../../services/backend.service';
import { PaymentError } from '../../errors/payment-error';
import { SAMPLE_PRODUCT } from '../../testing/test-doubles';
import { KlarnaAdapter } from './klarna.adapter';
import { StripeSdkLoader } from '../stripe/stripe-sdk.loader';

describe('KlarnaAdapter', () => {
  let adapter: KlarnaAdapter;
  let backend: jasmine.SpyObj<BackendService>;
  let sdkLoader: jasmine.SpyObj<StripeSdkLoader>;

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
    backend = jasmine.createSpyObj<BackendService>('BackendService', ['createKlarnaPayment']);
    sdkLoader = jasmine.createSpyObj<StripeSdkLoader>('StripeSdkLoader', ['load']);
    sdkLoader.load.and.resolveTo(stripeMock as never);
    history.replaceState({}, '', '/');
    confirmPayment.calls.reset();
    retrievePaymentIntent.calls.reset();
    elements.calls.reset();
    create.calls.reset();

    TestBed.configureTestingModule({
      providers: [
        provideEasyPayments({
          enableMockMode: false,
          providers: {
            stripe: { publishableKey: 'pk_test_123456789' },
            klarna: { purchaseCountry: 'US', locale: 'en-US' },
          },
          backend: {
            klarnaCreatePaymentUrl: '/api/payments/klarna/create',
          },
        }),
        { provide: BackendService, useValue: backend },
        { provide: StripeSdkLoader, useValue: sdkLoader },
      ],
    });

    adapter = TestBed.inject(KlarnaAdapter);
  });

  it('initializes without loading Stripe.js', async () => {
    await adapter.initialize();
    expect(sdkLoader.load).not.toHaveBeenCalled();
    expect(
      await adapter.isAvailable({ product: { ...SAMPLE_PRODUCT }, theme: 'light' }),
    ).toBeTrue();
  });

  it('is unavailable when Klarna is not configured', async () => {
    TestBed.inject(EasyPaymentsConfigService).replace({
      enableMockMode: false,
      providers: {
        stripe: { publishableKey: 'pk_test_123456789' },
      },
      backend: { klarnaCreatePaymentUrl: '/api/payments/klarna/create' },
    });
    await adapter.initialize();
    expect(
      await adapter.isAvailable({ product: { ...SAMPLE_PRODUCT }, theme: 'light' }),
    ).toBeFalse();
  });

  it('is unavailable when Stripe publishable key is missing', async () => {
    TestBed.inject(EasyPaymentsConfigService).replace({
      enableMockMode: false,
      providers: {
        klarna: { purchaseCountry: 'US' },
      },
      backend: { klarnaCreatePaymentUrl: '/api/payments/klarna/create' },
    });
    await adapter.initialize();
    expect(
      await adapter.isAvailable({ product: { ...SAMPLE_PRODUCT }, theme: 'light' }),
    ).toBeFalse();
  });

  it('is unavailable when klarnaCreatePaymentUrl is missing', async () => {
    TestBed.inject(EasyPaymentsConfigService).replace({
      enableMockMode: false,
      providers: {
        stripe: { publishableKey: 'pk_test_123456789' },
        klarna: {},
      },
      backend: {},
    });
    await adapter.initialize();
    expect(
      await adapter.isAvailable({ product: { ...SAMPLE_PRODUCT }, theme: 'light' }),
    ).toBeFalse();
  });

  it('creates a payment session once with product identity (no client amount)', async () => {
    backend.createKlarnaPayment.and.resolveTo({
      provider: 'klarna',
      clientSecret: 'pi_klarna_secret',
      paymentIntentId: 'pi_klarna_1',
      sessionId: 'sess_k1',
    });

    const session = await adapter.createPaymentSession({ ...SAMPLE_PRODUCT, quantity: 2 });

    expect(backend.createKlarnaPayment).toHaveBeenCalledTimes(1);
    expect(backend.createKlarnaPayment).toHaveBeenCalledWith({
      productId: 'premium-plan',
      quantity: 2,
      currency: 'USD',
    });
    expect(session.clientSecret).toBe('pi_klarna_secret');
  });

  it('forwards validated metadata and rejects reserved keys before the backend call', async () => {
    backend.createKlarnaPayment.and.resolveTo({
      provider: 'klarna',
      clientSecret: 'pi_klarna_secret',
      paymentIntentId: 'pi_klarna_1',
    });

    await adapter.createPaymentSession({
      ...SAMPLE_PRODUCT,
      metadata: { orderId: 'ORDER-12345' },
    });
    expect(backend.createKlarnaPayment.calls.mostRecent().args[0]).toEqual(
      jasmine.objectContaining({
        metadata: { orderId: 'ORDER-12345' },
      }),
    );
    expect(
      (backend.createKlarnaPayment.calls.mostRecent().args[0] as { amount?: number }).amount,
    ).toBeUndefined();

    backend.createKlarnaPayment.calls.reset();
    await expectAsync(
      adapter.createPaymentSession({
        ...SAMPLE_PRODUCT,
        metadata: { currency: 'EUR' },
      }),
    ).toBeRejectedWith(jasmine.objectContaining({ code: 'CONFIG_INVALID' }));
    expect(backend.createKlarnaPayment).not.toHaveBeenCalled();
  });

  it('normalizes a successful Klarna confirmation', async () => {
    backend.createKlarnaPayment.and.resolveTo({
      provider: 'klarna',
      clientSecret: 'pi_klarna_secret',
      paymentIntentId: 'pi_klarna_1',
    });
    confirmPayment.and.resolveTo({
      paymentIntent: { id: 'pi_klarna_1', status: 'succeeded' },
    });

    await adapter.createPaymentSession({ ...SAMPLE_PRODUCT });
    await adapter.mountPaymentElement(document.createElement('div'), 'pi_klarna_secret', 'light');

    const result = await adapter.confirmPayment('https://example.com/return');
    expect(result.status).toBe('success');
    expect(result.method).toBe('klarna');
    expect(result.provider).toBe('klarna');
    expect(result.transactionId).toBe('pi_klarna_1');
    expect(result.metadata?.['gateway']).toBe('stripe');
  });

  it('normalizes a cancelled Klarna confirmation', async () => {
    backend.createKlarnaPayment.and.resolveTo({
      provider: 'klarna',
      clientSecret: 'pi_klarna_secret',
      paymentIntentId: 'pi_klarna_1',
    });
    confirmPayment.and.resolveTo({
      paymentIntent: { id: 'pi_klarna_1', status: 'canceled' },
    });

    await adapter.createPaymentSession({ ...SAMPLE_PRODUCT });
    await adapter.mountPaymentElement(document.createElement('div'), 'pi_klarna_secret', 'light');

    const result = await adapter.confirmPayment();
    expect(result.status).toBe('cancelled');
    expect(result.method).toBe('klarna');
    expect(result.provider).toBe('klarna');
  });

  it('maps Stripe confirm errors to Klarna method/provider', async () => {
    backend.createKlarnaPayment.and.resolveTo({
      provider: 'klarna',
      clientSecret: 'pi_klarna_secret',
    });
    confirmPayment.and.resolveTo({
      error: { type: 'invalid_request_error', message: 'Klarna declined' },
    });

    await adapter.createPaymentSession({ ...SAMPLE_PRODUCT });
    await adapter.mountPaymentElement(document.createElement('div'), 'pi_klarna_secret', 'light');

    try {
      await adapter.confirmPayment();
      fail('expected decline');
    } catch (error) {
      expect(error).toBeInstanceOf(PaymentError);
      expect((error as PaymentError).method).toBe('klarna');
      expect((error as PaymentError).provider).toBe('klarna');
    }
  });

  it('retrieves a returning Klarna PaymentIntent without creating a new session', async () => {
    retrievePaymentIntent.and.resolveTo({
      paymentIntent: { id: 'pi_klarna_return', status: 'succeeded' },
    });

    const result = await adapter.retrieveReturningPayment('pi_klarna_return_secret');

    expect(backend.createKlarnaPayment).not.toHaveBeenCalled();
    expect(retrievePaymentIntent).toHaveBeenCalledWith('pi_klarna_return_secret');
    expect(result.status).toBe('success');
    expect(result.method).toBe('klarna');
    expect(result.provider).toBe('klarna');
    expect(result.transactionId).toBe('pi_klarna_return');
  });

  it('consumeStripeReturn recovers once and cleans the URL', async () => {
    history.replaceState(
      {},
      '',
      '/?payment_intent=pi_once&payment_intent_client_secret=sec_once&ep_method=klarna&redirect_status=succeeded',
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

  it('consumeStripeReturn errors for malformed Klarna return without client secret', async () => {
    history.replaceState({}, '', '/?ep_method=klarna');

    try {
      await adapter.consumeStripeReturn();
      fail('expected failure');
    } catch (error) {
      expect(error).toBeInstanceOf(PaymentError);
      expect((error as PaymentError).message.toLowerCase()).toContain('missing');
    }
    expect(adapter.wasReturnConsumed()).toBeTrue();
    expect(window.location.search).not.toContain('ep_method');
  });

  it('polls while PaymentIntent status is processing then succeeds', async () => {
    retrievePaymentIntent.and.returnValues(
      Promise.resolve({ paymentIntent: { id: 'pi_proc', status: 'processing' } }),
      Promise.resolve({ paymentIntent: { id: 'pi_proc', status: 'succeeded' } }),
    );

    const result = await adapter.retrieveReturningPayment('sec');
    expect(result.status).toBe('success');
    expect(retrievePaymentIntent).toHaveBeenCalledTimes(2);
  });

  it('maps canceled returning PaymentIntent to cancelled', async () => {
    retrievePaymentIntent.and.resolveTo({
      paymentIntent: { id: 'pi_klarna_cancel', status: 'canceled' },
    });

    const result = await adapter.retrieveReturningPayment('sec');
    expect(result.status).toBe('cancelled');
    expect(result.method).toBe('klarna');
  });

  it('maps requires_payment_method returning PaymentIntent to failure', async () => {
    retrievePaymentIntent.and.resolveTo({
      paymentIntent: { id: 'pi_klarna_fail', status: 'requires_payment_method' },
    });

    try {
      await adapter.retrieveReturningPayment('sec');
      fail('expected failure');
    } catch (error) {
      expect(error).toBeInstanceOf(PaymentError);
      expect((error as PaymentError).method).toBe('klarna');
    }
  });

  it('exhausts processing polls as a non-success processing result (never success)', async () => {
    retrievePaymentIntent.and.resolveTo({
      paymentIntent: { id: 'pi_klarna_proc', status: 'processing' },
    });

    const result = await adapter.retrieveReturningPayment('sec');
    expect(result.status).toBe('processing');
    expect(result.message?.toLowerCase()).toContain('processing');
    expect(retrievePaymentIntent.calls.count()).toBeGreaterThan(1);
  });

  it('stamps ep_method=klarna on confirmPayment return_url', async () => {
    backend.createKlarnaPayment.and.resolveTo({
      provider: 'klarna',
      clientSecret: 'pi_klarna_secret',
      paymentIntentId: 'pi_klarna_1',
    });
    confirmPayment.and.resolveTo({
      paymentIntent: { id: 'pi_klarna_1', status: 'succeeded' },
    });

    await adapter.createPaymentSession({ ...SAMPLE_PRODUCT });
    await adapter.mountPaymentElement(document.createElement('div'), 'pi_klarna_secret', 'light');
    await adapter.confirmPayment('https://example.com/checkout');

    const args = confirmPayment.calls.mostRecent().args[0];
    expect(args.redirect).toBe('if_required');
    expect(args.confirmParams.return_url).toContain('ep_method=klarna');
  });
});
