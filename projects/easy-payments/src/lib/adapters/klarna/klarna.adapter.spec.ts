import { TestBed } from '@angular/core/testing';
import { provideEasyPayments } from '../../config/provide-easy-payments';
import { EasyPaymentsConfigService } from '../../config/easy-payments-config.service';
import { BackendService } from '../../services/backend.service';
import { PaymentError } from '../../errors/payment-error';
import { SAMPLE_PRODUCT } from '../../testing/test-doubles';
import { KlarnaAdapter } from './klarna.adapter';
import { StripeSdkLoader } from '../stripe/stripe-sdk.loader';
import { StripeRedirectRecoveryService } from '../stripe/stripe-redirect-recovery.service';

describe('KlarnaAdapter', () => {
  let adapter: KlarnaAdapter;
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
  const confirmKlarnaPayment = jasmine.createSpy('confirmKlarnaPayment');
  const retrievePaymentIntent = jasmine.createSpy('retrievePaymentIntent');

  const stripeMock = {
    elements,
    confirmPayment,
    confirmKlarnaPayment,
    retrievePaymentIntent,
  };

  beforeEach(() => {
    TestBed.resetTestingModule();
    backend = jasmine.createSpyObj<BackendService>('BackendService', ['createKlarnaPayment']);
    sdkLoader = jasmine.createSpyObj<StripeSdkLoader>('StripeSdkLoader', ['load']);
    sdkLoader.load.and.resolveTo(stripeMock as never);
    history.replaceState({}, '', '/');
    sessionStorage.clear();
    confirmPayment.calls.reset();
    confirmKlarnaPayment.calls.reset();
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

    recovery = TestBed.inject(StripeRedirectRecoveryService);
    recovery.resetForTests();
    adapter = TestBed.inject(KlarnaAdapter);
  });

  afterEach(() => {
    recovery.resetForTests();
    sessionStorage.clear();
    history.replaceState({}, '', '/');
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

  describe('confirmDirectPayment', () => {
    const billing = {
      email: 'buyer@example.com',
      name: 'Jenny Rosen',
      address: {
        line1: '509 Amsterdam Ave',
        city: 'New York',
        state: 'NY',
        postalCode: '10024',
        country: 'US',
      },
    };

    it('calls confirmKlarnaPayment with client secret, return URL, and billing map', async () => {
      confirmKlarnaPayment.and.resolveTo({
        paymentIntent: { id: 'pi_direct', status: 'succeeded' },
      });

      const result = await adapter.confirmDirectPayment({
        clientSecret: 'pi_klarna_direct_secret',
        returnUrl: 'https://example.com/return?ep_method=klarna',
        customer: billing,
        shipping: {
          name: 'Jenny Rosen',
          address: { ...billing.address },
        },
      });

      expect(confirmKlarnaPayment).toHaveBeenCalledTimes(1);
      expect(confirmKlarnaPayment).toHaveBeenCalledWith(
        'pi_klarna_direct_secret',
        jasmine.objectContaining({
          return_url: 'https://example.com/return?ep_method=klarna',
          payment_method: jasmine.objectContaining({
            billing_details: jasmine.objectContaining({
              email: 'buyer@example.com',
              address: jasmine.objectContaining({
                country: 'US',
                postal_code: '10024',
              }),
            }),
          }),
          shipping: jasmine.objectContaining({
            name: 'Jenny Rosen',
          }),
        }),
      );
      expect(confirmPayment).not.toHaveBeenCalled();
      expect(submit).not.toHaveBeenCalled();
      expect(elements).not.toHaveBeenCalled();
      expect(backend.createKlarnaPayment).not.toHaveBeenCalled();
      expect(result.status).toBe('success');
      expect(result.transactionId).toBe('pi_direct');
    });

    it('omits payment_method when country is missing and still confirms', async () => {
      confirmKlarnaPayment.and.resolveTo({
        paymentIntent: { id: 'pi_min', status: 'succeeded' },
      });

      await adapter.confirmDirectPayment({
        clientSecret: 'sec',
        returnUrl: 'https://example.com/r',
        customer: { email: 'a@b.com', name: 'A' },
      });

      const data = confirmKlarnaPayment.calls.mostRecent().args[1];
      expect(data.return_url).toBe('https://example.com/r');
      expect(data.payment_method).toBeUndefined();
    });

    it('rejects missing client secret or return URL without calling Stripe', async () => {
      await expectAsync(
        adapter.confirmDirectPayment({ clientSecret: '', returnUrl: 'https://x' }),
      ).toBeRejectedWith(jasmine.any(PaymentError));
      await expectAsync(
        adapter.confirmDirectPayment({ clientSecret: 'sec', returnUrl: '  ' }),
      ).toBeRejectedWith(jasmine.any(PaymentError));
      expect(confirmKlarnaPayment).not.toHaveBeenCalled();
      expect(sdkLoader.load).not.toHaveBeenCalled();
    });

    it('maps Stripe Direct validation errors and does not retry', async () => {
      confirmKlarnaPayment.and.resolveTo({
        error: { type: 'invalid_request_error', message: 'Invalid Klarna request' },
      });

      try {
        await adapter.confirmDirectPayment({
          clientSecret: 'sec',
          returnUrl: 'https://example.com/r',
        });
        fail('expected error');
      } catch (error) {
        expect(error).toBeInstanceOf(PaymentError);
        expect((error as PaymentError).method).toBe('klarna');
      }
      expect(confirmKlarnaPayment).toHaveBeenCalledTimes(1);
    });

    it('blocks concurrent Direct confirmation via session + gate', async () => {
      let resolveConfirm: (value: unknown) => void = () => undefined;
      confirmKlarnaPayment.and.returnValue(
        new Promise((resolve) => {
          resolveConfirm = resolve;
        }),
      );

      const first = adapter.confirmDirectPayment({
        clientSecret: 'sec',
        returnUrl: 'https://example.com/r',
      });

      await expectAsync(
        adapter.confirmDirectPayment({
          clientSecret: 'sec2',
          returnUrl: 'https://example.com/r2',
        }),
      ).toBeRejectedWith(jasmine.any(PaymentError));

      resolveConfirm({ paymentIntent: { id: 'pi', status: 'succeeded' } });
      await first;
      expect(confirmKlarnaPayment).toHaveBeenCalledTimes(1);
    });

    it('marks requires_capture as authorization-only success', async () => {
      confirmKlarnaPayment.and.resolveTo({
        paymentIntent: { id: 'pi_auth', status: 'requires_capture' },
      });
      const result = await adapter.confirmDirectPayment({
        clientSecret: 'sec',
        returnUrl: 'https://example.com/r',
      });
      expect(result.status).toBe('success');
      expect(result.metadata?.['authorizationOnly']).toBe(true);
      expect(result.metadata?.['stripeStatus']).toBe('requires_capture');
    });

    it('does not call Direct APIs from initialize or return recovery', async () => {
      await adapter.initialize();
      retrievePaymentIntent.and.resolveTo({
        paymentIntent: { id: 'pi', status: 'succeeded' },
      });
      await adapter.retrieveReturningPayment('sec');
      expect(confirmKlarnaPayment).not.toHaveBeenCalled();
    });
  });
});
