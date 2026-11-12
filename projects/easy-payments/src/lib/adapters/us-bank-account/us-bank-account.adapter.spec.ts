import { TestBed } from '@angular/core/testing';
import { provideEasyPayments } from '../../config/provide-easy-payments';
import { SAMPLE_PRODUCT } from '../../testing/test-doubles';
import { PaymentError } from '../../errors/payment-error';
import { BackendService } from '../../services/backend.service';
import { StripeSdkLoader } from '../stripe/stripe-sdk.loader';
import {
  ACH_RETURN_METHOD,
  setAchDelayForTests,
} from './us-bank-account-return';
import { UsBankAccountAdapter } from './us-bank-account.adapter';

describe('UsBankAccountAdapter', () => {
  let adapter: UsBankAccountAdapter;
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
    backend = jasmine.createSpyObj<BackendService>('BackendService', [
      'createUsBankAccountPayment',
    ]);
    sdkLoader = jasmine.createSpyObj<StripeSdkLoader>('StripeSdkLoader', ['load']);
    sdkLoader.load.and.resolveTo(stripeMock as never);

    mount.calls.reset();
    unmount.calls.reset();
    submit.calls.reset();
    submit.and.resolveTo({ error: undefined });
    update.calls.reset();
    create.calls.reset();
    create.and.returnValue({ mount, unmount });
    elements.calls.reset();
    elements.and.returnValue({ create, submit, update });
    confirmPayment.calls.reset();
    retrievePaymentIntent.calls.reset();

    TestBed.configureTestingModule({
      providers: [
        provideEasyPayments({
          providers: {
            stripe: { publishableKey: 'pk_test_ach_adapter' },
            usBankAccount: {},
          },
          backend: {
            createUsBankAccountPaymentUrl: 'http://localhost/api/payments/us-bank-account/create',
          },
        }),
        { provide: BackendService, useValue: backend },
        { provide: StripeSdkLoader, useValue: sdkLoader },
      ],
    });

    adapter = TestBed.inject(UsBankAccountAdapter);
  });

  it('is available when Stripe pk + ACH create URL + USD product are configured', async () => {
    await adapter.initialize();

    await expectAsync(
      adapter.isAvailable({
        product: { ...SAMPLE_PRODUCT, currency: 'USD' },
        theme: 'light',
      }),
    ).toBeResolvedTo(true);
  });

  it('is unavailable for non-USD presentment', async () => {
    await adapter.initialize();

    await expectAsync(
      adapter.isAvailable({
        product: { ...SAMPLE_PRODUCT, currency: 'EUR' },
        theme: 'light',
      }),
    ).toBeResolvedTo(false);
  });

  it('rejects direct createPayment for real ACH (Payment Element required)', async () => {
    await adapter.initialize();

    await expectAsync(
      adapter.createPayment({
        method: 'us-bank-account',
        context: { product: { ...SAMPLE_PRODUCT }, theme: 'light' },
      }),
    ).toBeRejectedWith(jasmine.any(PaymentError));
  });

  it('creates an ACH session via createUsBankAccountPayment without forwarding amount', async () => {
    backend.createUsBankAccountPayment.and.resolveTo({
      provider: 'usBankAccount',
      clientSecret: 'pi_ach_secret',
      paymentIntentId: 'pi_ach_1',
    });
    await adapter.initialize();

    const session = await adapter.createPaymentSession({ ...SAMPLE_PRODUCT, amount: 99 });
    expect(session.clientSecret).toBe('pi_ach_secret');
    expect(session.paymentIntentId).toBe('pi_ach_1');
    expect(backend.createUsBankAccountPayment).toHaveBeenCalledWith(
      jasmine.objectContaining({
        productId: SAMPLE_PRODUCT.id,
        quantity: SAMPLE_PRODUCT.quantity ?? 1,
        currency: SAMPLE_PRODUCT.currency,
      }),
    );
    const body = backend.createUsBankAccountPayment.calls.mostRecent().args[0] as Record<
      string,
      unknown
    >;
    expect(body['amount']).toBeUndefined();
  });

  it('maps Stripe processing to PaymentResult.status processing (never success)', () => {
    const normalize = adapter as unknown as {
      normalizeIntent: (
        paymentIntent: { id?: string; status?: string } | undefined,
        session: { paymentIntentId?: string; sessionId?: string },
      ) => { status: string; method: string; provider: string };
    };

    const result = normalize.normalizeIntent(
      { id: 'pi_processing', status: 'processing' },
      { paymentIntentId: 'pi_processing', sessionId: 'sess_1' },
    );

    expect(result.status).toBe('processing');
    expect(result.method).toBe('us-bank-account');
    expect(result.provider).toBe('usBankAccount');
  });

  it('maps requires_action to AUTHENTICATION_REQUIRED (not success)', () => {
    const normalize = adapter as unknown as {
      normalizeIntent: (
        paymentIntent: { id?: string; status?: string } | undefined,
        session: { paymentIntentId?: string; sessionId?: string },
      ) => unknown;
    };

    expect(() =>
      normalize.normalizeIntent(
        { id: 'pi_action', status: 'requires_action' },
        { paymentIntentId: 'pi_action' },
      ),
    ).toThrowMatching(
      (error: unknown) =>
        error instanceof PaymentError && error.code === 'AUTHENTICATION_REQUIRED',
    );
  });

  async function mountReadySession(): Promise<void> {
    backend.createUsBankAccountPayment.and.resolveTo({
      provider: 'usBankAccount',
      clientSecret: 'pi_ach_secret',
      paymentIntentId: 'pi_ach_1',
    });
    await adapter.initialize();
    await adapter.createPaymentSession({ ...SAMPLE_PRODUCT, currency: 'USD' });
    await adapter.mountPaymentElement(
      document.createElement('div'),
      'pi_ach_secret',
      'light',
    );
  }

  it('always passes return_url with ep_method=us-bank-account on confirmPayment', async () => {
    await mountReadySession();
    confirmPayment.and.resolveTo({
      paymentIntent: { id: 'pi_ach_1', status: 'processing' },
    });

    await adapter.confirmPayment();

    expect(confirmPayment).toHaveBeenCalled();
    const args = confirmPayment.calls.mostRecent().args[0] as {
      confirmParams?: { return_url?: string };
      redirect?: string;
    };
    expect(args.redirect).toBe('if_required');
    expect(args.confirmParams?.return_url).toContain(
      `${window.location.origin}${window.location.pathname}`,
    );
    expect(args.confirmParams?.return_url).toContain(`ep_method=${ACH_RETURN_METHOD}`);
  });

  it('maps confirmPayment processing to processing (never success)', async () => {
    await mountReadySession();
    confirmPayment.and.resolveTo({
      paymentIntent: { id: 'pi_ach_1', status: 'processing' },
    });

    const result = await adapter.confirmPayment(`${window.location.origin}/return`);
    expect(result.status).toBe('processing');
    expect(result.method).toBe('us-bank-account');
    expect(result.provider).toBe('usBankAccount');
    expect(result.transactionId).toBe('pi_ach_1');
  });

  it('maps confirmPayment succeeded to success', async () => {
    await mountReadySession();
    confirmPayment.and.resolveTo({
      paymentIntent: { id: 'pi_ach_1', status: 'succeeded' },
    });

    const result = await adapter.confirmPayment(`${window.location.origin}/return`);
    expect(result.status).toBe('success');
    expect(result.transactionId).toBe('pi_ach_1');
  });

  it('retrieves PaymentIntent when confirmPayment returns no intent body', async () => {
    await mountReadySession();
    confirmPayment.and.resolveTo({ paymentIntent: undefined });
    retrievePaymentIntent.and.resolveTo({
      paymentIntent: { id: 'pi_ach_1', status: 'processing' },
    });

    const result = await adapter.confirmPayment();
    expect(retrievePaymentIntent).toHaveBeenCalledWith('pi_ach_secret');
    expect(result.status).toBe('processing');
  });

  it('reconciles the same PaymentIntent when confirmPayment hangs (stall regression)', async () => {
    setAchDelayForTests(() => Promise.resolve());
    try {
      await mountReadySession();
      // Never resolves — reproduces the stuck “Processing payment…” spinner.
      confirmPayment.and.returnValue(new Promise(() => undefined));
      retrievePaymentIntent.and.resolveTo({
        paymentIntent: { id: 'pi_ach_1', status: 'succeeded' },
      });

      const result = await adapter.confirmPayment();
      expect(retrievePaymentIntent).toHaveBeenCalledWith('pi_ach_secret');
      expect(result.status).toBe('success');
      expect(result.transactionId).toBe('pi_ach_1');
      expect(confirmPayment).toHaveBeenCalled();
    } finally {
      setAchDelayForTests(null);
    }
  });

  it('returns status-check processing when hang reconcile cannot verify status', async () => {
    setAchDelayForTests(() => Promise.resolve());
    try {
      await mountReadySession();
      confirmPayment.and.returnValue(new Promise(() => undefined));
      retrievePaymentIntent.and.resolveTo({
        paymentIntent: { id: 'pi_ach_1', status: 'requires_action' },
      });

      const result = await adapter.confirmPayment();
      expect(result.status).toBe('processing');
      expect(result.metadata?.['statusCheck']).toBe(true);
      expect(confirmPayment).toHaveBeenCalled();
    } finally {
      setAchDelayForTests(null);
    }
  });

  it('recoverReturningPayment retrieves only (never confirms a second payment)', async () => {
    await adapter.initialize();
    await adapter.ensureStripeLoaded();
    retrievePaymentIntent.and.resolveTo({
      paymentIntent: { id: 'pi_return', status: 'processing' },
    });

    const result = await adapter.recoverReturningPayment('pi_return_secret');
    expect(confirmPayment).not.toHaveBeenCalled();
    expect(retrievePaymentIntent).toHaveBeenCalledWith('pi_return_secret');
    expect(result.status).toBe('processing');
    expect(result.transactionId).toBe('pi_return');
  });
});
