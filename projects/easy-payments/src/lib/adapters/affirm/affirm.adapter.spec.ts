import { TestBed } from '@angular/core/testing';
import { provideEasyPayments } from '../../config/provide-easy-payments';
import { EasyPaymentsConfigService } from '../../config/easy-payments-config.service';
import { BackendService } from '../../services/backend.service';
import { PaymentError } from '../../errors/payment-error';
import { SAMPLE_PRODUCT } from '../../testing/test-doubles';
import { AffirmAdapter } from './affirm.adapter';
import { StripeSdkLoader } from '../stripe/stripe-sdk.loader';
import { StripeRedirectRecoveryService } from '../stripe/stripe-redirect-recovery.service';

describe('AffirmAdapter', () => {
  let adapter: AffirmAdapter;
  let backend: jasmine.SpyObj<BackendService>;
  let sdkLoader: jasmine.SpyObj<StripeSdkLoader>;
  let redirectRecovery: jasmine.SpyObj<StripeRedirectRecoveryService>;

  const mount = jasmine.createSpy('mount');
  const unmount = jasmine.createSpy('unmount');
  const submit = jasmine.createSpy('submit').and.resolveTo({ error: undefined });
  const update = jasmine.createSpy('update');
  const create = jasmine.createSpy('create').and.returnValue({ mount, unmount });
  const elements = jasmine.createSpy('elements').and.returnValue({ create, submit, update });
  const confirmPayment = jasmine.createSpy('confirmPayment');
  const confirmAffirmPayment = jasmine.createSpy('confirmAffirmPayment');

  const stripeMock = {
    elements,
    confirmPayment,
    confirmAffirmPayment,
  };

  beforeEach(() => {
    TestBed.resetTestingModule();
    backend = jasmine.createSpyObj<BackendService>('BackendService', ['createAffirmPayment']);
    sdkLoader = jasmine.createSpyObj<StripeSdkLoader>('StripeSdkLoader', ['load']);
    redirectRecovery = jasmine.createSpyObj<StripeRedirectRecoveryService>(
      'StripeRedirectRecoveryService',
      ['consumeReturn', 'wasReturnConsumed'],
    );
    sdkLoader.load.and.resolveTo(stripeMock as never);
    redirectRecovery.consumeReturn.and.resolveTo(null);
    redirectRecovery.wasReturnConsumed.and.returnValue(false);
    history.replaceState({}, '', '/');
    confirmPayment.calls.reset();
    confirmAffirmPayment.calls.reset();
    elements.calls.reset();
    create.calls.reset();
    submit.calls.reset();

    TestBed.configureTestingModule({
      providers: [
        provideEasyPayments({
          enableMockMode: false,
          providers: {
            stripe: { publishableKey: 'pk_test_123456789' },
            affirm: { purchaseCountry: 'US', locale: 'en-US' },
          },
          backend: {
            affirmCreatePaymentUrl: '/api/payments/affirm/create',
          },
        }),
        { provide: BackendService, useValue: backend },
        { provide: StripeSdkLoader, useValue: sdkLoader },
        { provide: StripeRedirectRecoveryService, useValue: redirectRecovery },
      ],
    });

    adapter = TestBed.inject(AffirmAdapter);
  });

  it('initializes without loading Stripe.js', async () => {
    await adapter.initialize();
    expect(sdkLoader.load).not.toHaveBeenCalled();
    expect(
      await adapter.isAvailable({ product: { ...SAMPLE_PRODUCT }, theme: 'light' }),
    ).toBeTrue();
  });

  it('is unavailable when Affirm is not configured', async () => {
    TestBed.inject(EasyPaymentsConfigService).replace({
      enableMockMode: false,
      providers: {
        stripe: { publishableKey: 'pk_test_123456789' },
      },
      backend: { affirmCreatePaymentUrl: '/api/payments/affirm/create' },
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
        affirm: { purchaseCountry: 'US' },
      },
      backend: { affirmCreatePaymentUrl: '/api/payments/affirm/create' },
    });
    await adapter.initialize();
    expect(
      await adapter.isAvailable({ product: { ...SAMPLE_PRODUCT }, theme: 'light' }),
    ).toBeFalse();
  });

  it('is unavailable when affirmCreatePaymentUrl is missing', async () => {
    TestBed.inject(EasyPaymentsConfigService).replace({
      enableMockMode: false,
      providers: {
        stripe: { publishableKey: 'pk_test_123456789' },
        affirm: {},
      },
      backend: {},
    });
    await adapter.initialize();
    expect(
      await adapter.isAvailable({ product: { ...SAMPLE_PRODUCT }, theme: 'light' }),
    ).toBeFalse();
  });

  it('is unavailable for unsupported currencies', async () => {
    await adapter.initialize();
    expect(
      await adapter.isAvailable({
        product: { ...SAMPLE_PRODUCT, currency: 'EUR' },
        theme: 'light',
      }),
    ).toBeFalse();
  });

  it('is unavailable when total is below Affirm minimum', async () => {
    await adapter.initialize();
    expect(
      await adapter.isAvailable({
        product: { ...SAMPLE_PRODUCT, amount: 20, quantity: 1 },
        theme: 'light',
      }),
    ).toBeFalse();
    expect(
      await adapter.isAvailable({
        product: { ...SAMPLE_PRODUCT, amount: 20, quantity: 2 },
        theme: 'light',
      }),
    ).toBeTrue();
  });

  it('creates a payment session once with product identity (no client amount)', async () => {
    backend.createAffirmPayment.and.resolveTo({
      provider: 'affirm',
      clientSecret: 'pi_affirm_secret',
      paymentIntentId: 'pi_affirm_1',
      sessionId: 'sess_a1',
    });

    const session = await adapter.createPaymentSession({ ...SAMPLE_PRODUCT, quantity: 2 });

    expect(backend.createAffirmPayment).toHaveBeenCalledTimes(1);
    expect(backend.createAffirmPayment).toHaveBeenCalledWith({
      productId: 'premium-plan',
      quantity: 2,
      currency: 'USD',
    });
    expect(session.clientSecret).toBe('pi_affirm_secret');
  });

  it('forwards validated metadata and rejects nested values before the backend call', async () => {
    backend.createAffirmPayment.and.resolveTo({
      provider: 'affirm',
      clientSecret: 'pi_affirm_secret',
      paymentIntentId: 'pi_affirm_1',
    });

    await adapter.createPaymentSession({
      ...SAMPLE_PRODUCT,
      metadata: { orderId: 'ORDER-12345' },
    });
    expect(backend.createAffirmPayment.calls.mostRecent().args[0]).toEqual(
      jasmine.objectContaining({
        metadata: { orderId: 'ORDER-12345' },
      }),
    );

    backend.createAffirmPayment.calls.reset();
    await expectAsync(
      adapter.createPaymentSession({
        ...SAMPLE_PRODUCT,
        metadata: { orderId: { nested: 'no' } as unknown as string },
      }),
    ).toBeRejectedWith(jasmine.objectContaining({ code: 'CONFIG_INVALID' }));
    expect(backend.createAffirmPayment).not.toHaveBeenCalled();
  });

  it('normalizes a successful Affirm confirmation', async () => {
    backend.createAffirmPayment.and.resolveTo({
      provider: 'affirm',
      clientSecret: 'pi_affirm_secret',
      paymentIntentId: 'pi_affirm_1',
    });
    confirmPayment.and.resolveTo({
      paymentIntent: { id: 'pi_affirm_1', status: 'succeeded' },
    });

    await adapter.createPaymentSession({ ...SAMPLE_PRODUCT });
    await adapter.mountPaymentElement(document.createElement('div'), 'pi_affirm_secret', 'light');

    const result = await adapter.confirmPayment('https://example.com/return');
    expect(result.status).toBe('success');
    expect(result.method).toBe('affirm');
    expect(result.provider).toBe('affirm');
    expect(result.transactionId).toBe('pi_affirm_1');
    expect(result.metadata?.['gateway']).toBe('stripe');
  });

  it('normalizes a cancelled Affirm confirmation', async () => {
    backend.createAffirmPayment.and.resolveTo({
      provider: 'affirm',
      clientSecret: 'pi_affirm_secret',
      paymentIntentId: 'pi_affirm_1',
    });
    confirmPayment.and.resolveTo({
      paymentIntent: { id: 'pi_affirm_1', status: 'canceled' },
    });

    await adapter.createPaymentSession({ ...SAMPLE_PRODUCT });
    await adapter.mountPaymentElement(document.createElement('div'), 'pi_affirm_secret', 'light');

    const result = await adapter.confirmPayment();
    expect(result.status).toBe('cancelled');
    expect(result.method).toBe('affirm');
    expect(result.provider).toBe('affirm');
  });

  it('maps Stripe confirm errors to Affirm method/provider', async () => {
    backend.createAffirmPayment.and.resolveTo({
      provider: 'affirm',
      clientSecret: 'pi_affirm_secret',
    });
    confirmPayment.and.resolveTo({
      error: { type: 'invalid_request_error', message: 'Affirm declined' },
    });

    await adapter.createPaymentSession({ ...SAMPLE_PRODUCT });
    await adapter.mountPaymentElement(document.createElement('div'), 'pi_affirm_secret', 'light');

    try {
      await adapter.confirmPayment();
      fail('expected decline');
    } catch (error) {
      expect(error).toBeInstanceOf(PaymentError);
      expect((error as PaymentError).method).toBe('affirm');
      expect((error as PaymentError).provider).toBe('affirm');
    }
  });

  it('delegates consumeStripeReturn to StripeRedirectRecoveryService', async () => {
    redirectRecovery.consumeReturn.and.resolveTo({
      status: 'success',
      method: 'affirm',
      provider: 'affirm',
      transactionId: 'pi_aff',
    });
    redirectRecovery.wasReturnConsumed.and.returnValue(true);

    const result = await adapter.consumeStripeReturn();
    expect(redirectRecovery.consumeReturn).toHaveBeenCalled();
    expect(result?.transactionId).toBe('pi_aff');
    expect(adapter.wasReturnConsumed()).toBeTrue();
  });

  it('stamps ep_method=affirm on confirmPayment return_url', async () => {
    backend.createAffirmPayment.and.resolveTo({
      provider: 'affirm',
      clientSecret: 'pi_affirm_secret',
      paymentIntentId: 'pi_affirm_1',
    });
    confirmPayment.and.resolveTo({
      paymentIntent: { id: 'pi_affirm_1', status: 'succeeded' },
    });

    await adapter.createPaymentSession({ ...SAMPLE_PRODUCT });
    await adapter.mountPaymentElement(document.createElement('div'), 'pi_affirm_secret', 'light');
    await adapter.confirmPayment('https://example.com/checkout');

    const args = confirmPayment.calls.mostRecent().args[0];
    expect(args.redirect).toBe('if_required');
    expect(args.confirmParams.return_url).toContain('ep_method=affirm');
  });

  describe('confirmDirectPayment', () => {
    it('calls confirmAffirmPayment without mounting Payment Element', async () => {
      confirmAffirmPayment.and.resolveTo({
        paymentIntent: { id: 'pi_aff_direct', status: 'succeeded' },
      });

      const result = await adapter.confirmDirectPayment({
        clientSecret: 'pi_affirm_direct_secret',
        returnUrl: 'https://example.com/return?ep_method=affirm',
        customer: {
          email: 'buyer@example.com',
          name: 'Jenny Rosen',
          address: {
            line1: '509 Amsterdam Ave',
            city: 'New York',
            state: 'NY',
            postalCode: '10024',
            country: 'US',
          },
        },
        shipping: {
          name: 'Jenny Rosen',
          address: {
            line1: '509 Amsterdam Ave',
            city: 'New York',
            state: 'NY',
            postalCode: '10024',
            country: 'US',
          },
        },
      });

      expect(confirmAffirmPayment).toHaveBeenCalledWith(
        'pi_affirm_direct_secret',
        jasmine.objectContaining({
          return_url: 'https://example.com/return?ep_method=affirm',
          payment_method: jasmine.objectContaining({
            billing_details: jasmine.objectContaining({
              email: 'buyer@example.com',
              address: jasmine.objectContaining({ country: 'US', postal_code: '10024' }),
            }),
          }),
          shipping: jasmine.objectContaining({ name: 'Jenny Rosen' }),
        }),
      );
      expect(confirmPayment).not.toHaveBeenCalled();
      expect(submit).not.toHaveBeenCalled();
      expect(elements).not.toHaveBeenCalled();
      expect(backend.createAffirmPayment).not.toHaveBeenCalled();
      expect(result.status).toBe('success');
      expect(result.method).toBe('affirm');
    });

    it('maps Direct declines without retrying', async () => {
      confirmAffirmPayment.and.resolveTo({
        error: { type: 'card_error', message: 'Affirm declined' },
      });
      try {
        await adapter.confirmDirectPayment({
          clientSecret: 'sec',
          returnUrl: 'https://example.com/r',
        });
        fail('expected decline');
      } catch (error) {
        expect(error).toBeInstanceOf(PaymentError);
        expect((error as PaymentError).provider).toBe('affirm');
      }
      expect(confirmAffirmPayment).toHaveBeenCalledTimes(1);
    });

    it('rejects incomplete request config without Stripe calls', async () => {
      await expectAsync(
        adapter.confirmDirectPayment({ clientSecret: 'sec', returnUrl: '' }),
      ).toBeRejectedWith(jasmine.any(PaymentError));
      expect(confirmAffirmPayment).not.toHaveBeenCalled();
    });

    it('leaves PE confirmPayment path unchanged when used separately', async () => {
      backend.createAffirmPayment.and.resolveTo({
        provider: 'affirm',
        clientSecret: 'pi_affirm_secret',
      });
      confirmPayment.and.resolveTo({
        paymentIntent: { id: 'pi_pe', status: 'succeeded' },
      });
      await adapter.createPaymentSession({ ...SAMPLE_PRODUCT });
      await adapter.mountPaymentElement(document.createElement('div'), 'pi_affirm_secret', 'light');
      await adapter.confirmPayment('https://example.com/pe');
      expect(confirmPayment).toHaveBeenCalled();
      expect(confirmAffirmPayment).not.toHaveBeenCalled();
    });
  });
});
