import { TestBed } from '@angular/core/testing';
import { provideEasyPayments } from '../../config/provide-easy-payments';
import { EasyPaymentsConfigService } from '../../config/easy-payments-config.service';
import { BackendService } from '../../services/backend.service';
import { PaymentError } from '../../errors/payment-error';
import { SAMPLE_PRODUCT } from '../../testing/test-doubles';
import { StripeCardAdapter } from './stripe-card.adapter';
import { StripeSdkLoader } from './stripe-sdk.loader';

describe('StripeCardAdapter', () => {
  let adapter: StripeCardAdapter;
  let backend: jasmine.SpyObj<BackendService>;
  let sdkLoader: jasmine.SpyObj<StripeSdkLoader>;

  const mount = jasmine.createSpy('mount');
  const unmount = jasmine.createSpy('unmount');
  const submit = jasmine.createSpy('submit').and.resolveTo({ error: undefined });
  const update = jasmine.createSpy('update');
  const create = jasmine.createSpy('create').and.returnValue({ mount, unmount });
  const elements = jasmine.createSpy('elements').and.returnValue({ create, submit, update });
  const confirmPayment = jasmine.createSpy('confirmPayment');

  const stripeMock = {
    elements,
    confirmPayment,
  };

  beforeEach(() => {
    backend = jasmine.createSpyObj<BackendService>('BackendService', ['createStripePayment']);
    sdkLoader = jasmine.createSpyObj<StripeSdkLoader>('StripeSdkLoader', ['load']);
    sdkLoader.load.and.resolveTo(stripeMock as never);

    TestBed.configureTestingModule({
      providers: [
        provideEasyPayments({
          enableMockMode: false,
          providers: {
            stripe: { publishableKey: 'pk_test_123456789' },
          },
          backend: {
            createPaymentUrl: '/api/payments/create',
          },
        }),
        { provide: BackendService, useValue: backend },
        { provide: StripeSdkLoader, useValue: sdkLoader },
      ],
    });

    adapter = TestBed.inject(StripeCardAdapter);
  });

  it('initializes without loading Stripe.js', async () => {
    await adapter.initialize();
    expect(sdkLoader.load).not.toHaveBeenCalled();
    expect(
      await adapter.isAvailable({ product: { ...SAMPLE_PRODUCT }, theme: 'light' }),
    ).toBeTrue();
  });

  it('is unavailable when publishable key is missing', async () => {
    TestBed.inject(EasyPaymentsConfigService).replace({
      enableMockMode: false,
      providers: {},
      backend: { createPaymentUrl: '/api/payments/create' },
    });
    await adapter.initialize();
    expect(
      await adapter.isAvailable({ product: { ...SAMPLE_PRODUCT }, theme: 'light' }),
    ).toBeFalse();
  });

  it('is unavailable when backend createPaymentUrl is missing', async () => {
    TestBed.inject(EasyPaymentsConfigService).replace({
      enableMockMode: false,
      providers: { stripe: { publishableKey: 'pk_test_123456789' } },
      backend: {},
    });
    await adapter.initialize();
    expect(
      await adapter.isAvailable({ product: { ...SAMPLE_PRODUCT }, theme: 'light' }),
    ).toBeFalse();
  });

  it('rejects secret keys during ensureStripeLoaded', async () => {
    TestBed.inject(EasyPaymentsConfigService).replace({
      enableMockMode: false,
      providers: { stripe: { publishableKey: 'sk_test_secret' } },
      backend: { createPaymentUrl: '/api/payments/create' },
    });

    await expectAsync(adapter.ensureStripeLoaded()).toBeRejectedWith(
      jasmine.objectContaining({ code: 'CONFIG_INVALID' }),
    );
    expect(sdkLoader.load).not.toHaveBeenCalled();
  });

  it('loads Stripe.js only when ensureStripeLoaded is called', async () => {
    await adapter.initialize();
    await adapter.ensureStripeLoaded();
    expect(sdkLoader.load).toHaveBeenCalledWith('pk_test_123456789');
  });

  it('creates a payment session with productId and quantity (not trusted amount)', async () => {
    backend.createStripePayment.and.resolveTo({
      provider: 'stripe',
      clientSecret: 'pi_test_secret',
      paymentIntentId: 'pi_123',
      sessionId: 'sess_1',
    });

    const session = await adapter.createPaymentSession({ ...SAMPLE_PRODUCT, quantity: 2 });

    expect(backend.createStripePayment).toHaveBeenCalledWith(
      jasmine.objectContaining({
        provider: 'stripe',
        productId: 'premium-plan',
        quantity: 2,
        currency: 'USD',
        amount: 99.99,
      }),
    );
    expect(session.clientSecret).toBe('pi_test_secret');
  });

  it('sends validated merchant metadata and does not call the backend when it is invalid', async () => {
    backend.createStripePayment.and.resolveTo({
      provider: 'stripe',
      clientSecret: 'pi_test_secret',
      paymentIntentId: 'pi_123',
    });

    await adapter.createPaymentSession({
      ...SAMPLE_PRODUCT,
      metadata: { orderId: 'ORDER-12345' },
    });

    const sent = backend.createStripePayment.calls.mostRecent().args[0];
    expect(sent.metadata?.['orderId']).toBe('ORDER-12345');
    expect(sent.metadata?.['productName']).toBe(SAMPLE_PRODUCT.name);
    expect(sent.amount).toBe(SAMPLE_PRODUCT.amount);

    backend.createStripePayment.calls.reset();
    await expectAsync(
      adapter.createPaymentSession({
        ...SAMPLE_PRODUCT,
        metadata: { productId: 'other-plan' },
      }),
    ).toBeRejectedWith(jasmine.objectContaining({ code: 'CONFIG_INVALID' }));
    expect(backend.createStripePayment).not.toHaveBeenCalled();
  });

  it('rejects backend responses without clientSecret', async () => {
    backend.createStripePayment.and.resolveTo({
      provider: 'stripe',
      clientSecret: '',
    });

    await expectAsync(adapter.createPaymentSession({ ...SAMPLE_PRODUCT })).toBeRejectedWith(
      jasmine.objectContaining({ code: 'BACKEND_ERROR' }),
    );
  });

  it('rejects invalid backend responses', async () => {
    backend.createStripePayment.and.resolveTo(null as never);

    await expectAsync(adapter.createPaymentSession({ ...SAMPLE_PRODUCT })).toBeRejectedWith(
      jasmine.objectContaining({ code: 'BACKEND_ERROR' }),
    );
  });

  it('mounts Payment Element and confirms a successful payment', async () => {
    backend.createStripePayment.and.resolveTo({
      provider: 'stripe',
      clientSecret: 'pi_test_secret',
      paymentIntentId: 'pi_123',
    });
    confirmPayment.and.resolveTo({
      paymentIntent: { id: 'pi_123', status: 'succeeded' },
    });

    await adapter.createPaymentSession({ ...SAMPLE_PRODUCT });
    const host = document.createElement('div');
    await adapter.mountPaymentElement(host, 'pi_test_secret', 'light');
    expect(elements).toHaveBeenCalledWith(
      jasmine.objectContaining({
        clientSecret: 'pi_test_secret',
        appearance: jasmine.objectContaining({ theme: 'stripe' }),
      }),
    );
    expect(create).toHaveBeenCalledWith(
      'payment',
      jasmine.objectContaining({
        wallets: jasmine.objectContaining({
          applePay: 'never',
          googlePay: 'never',
          link: 'never',
        }),
      }),
    );
    expect(mount).toHaveBeenCalledWith(host);
    expect(adapter.hasMountedElement()).toBeTrue();

    const result = await adapter.confirmPayment('https://example.com/return');
    expect(submit).toHaveBeenCalled();
    expect(confirmPayment).toHaveBeenCalled();
    expect(result.status).toBe('success');
    expect(result.method).toBe('card');
    expect(result.provider).toBe('stripe');
    expect(result.transactionId).toBe('pi_123');
  });

  it('prevents duplicate confirmations', async () => {
    backend.createStripePayment.and.resolveTo({
      provider: 'stripe',
      clientSecret: 'pi_test_secret',
    });
    let releaseConfirm: (value: unknown) => void = () => undefined;
    confirmPayment.and.returnValue(
      new Promise((resolve) => {
        releaseConfirm = resolve;
      }),
    );

    await adapter.createPaymentSession({ ...SAMPLE_PRODUCT });
    await adapter.mountPaymentElement(document.createElement('div'), 'pi_test_secret', 'dark');

    const first = adapter.confirmPayment();
    await Promise.resolve();
    await expectAsync(adapter.confirmPayment()).toBeRejectedWith(
      jasmine.objectContaining({ code: 'PAYMENT_FAILED' }),
    );
    releaseConfirm({ paymentIntent: { id: 'pi_1', status: 'succeeded' } });
    await first;
  });

  it('normalizes Stripe confirm errors', async () => {
    backend.createStripePayment.and.resolveTo({
      provider: 'stripe',
      clientSecret: 'pi_test_secret',
    });
    confirmPayment.and.resolveTo({
      error: { type: 'card_error', code: 'card_declined', message: 'Declined' },
    });

    await adapter.createPaymentSession({ ...SAMPLE_PRODUCT });
    await adapter.mountPaymentElement(document.createElement('div'), 'pi_test_secret', 'light');

    try {
      await adapter.confirmPayment();
      fail('expected decline');
    } catch (error) {
      expect(error).toBeInstanceOf(PaymentError);
      expect((error as PaymentError).code).toBe('CARD_DECLINED');
    }
  });

  it('updates appearance without remounting', async () => {
    backend.createStripePayment.and.resolveTo({
      provider: 'stripe',
      clientSecret: 'pi_test_secret',
    });
    await adapter.createPaymentSession({ ...SAMPLE_PRODUCT });
    await adapter.mountPaymentElement(document.createElement('div'), 'pi_test_secret', 'light');
    await adapter.updateAppearance('dark');
    expect(update).toHaveBeenCalledWith(
      jasmine.objectContaining({
        appearance: jasmine.objectContaining({ theme: 'night' }),
      }),
    );
  });
});
