import { TestBed } from '@angular/core/testing';
import { provideHttpClient, withXhr } from '@angular/common/http';
import { PLATFORM_ID } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { provideEasyPayments } from '../config/provide-easy-payments';
import { BackendService } from '../services/backend.service';
import { PaymentError } from '../errors/payment-error';
import type { PaymentProduct } from '../models';
import { UsBankAccountAdapter } from '../adapters/us-bank-account/us-bank-account.adapter';
import { StripeSdkLoader } from '../adapters/stripe/stripe-sdk.loader';
import { StripeRedirectRecoveryService } from '../adapters/stripe/stripe-redirect-recovery.service';
import { EasyPaymentsHeadless } from './easy-payments-headless.service';
import { HeadlessSessionRegistry } from './headless-session-registry';
import type { HeadlessCheckoutSession } from './headless.types';

const PRODUCT: PaymentProduct = {
  id: 'premium-plan',
  name: 'Premium',
  amount: 99,
  currency: 'USD',
};

describe('HeadlessCheckoutSession US bank account (ACH)', () => {
  let headless: EasyPaymentsHeadless;
  let registry: HeadlessSessionRegistry;
  let backend: jasmine.SpyObj<BackendService>;
  let sdkLoader: jasmine.SpyObj<StripeSdkLoader>;
  let adapter: UsBankAccountAdapter;

  const mountSpy = jasmine.createSpy('mount');
  const unmountSpy = jasmine.createSpy('unmount');
  const submit = jasmine.createSpy('submit').and.resolveTo({ error: undefined });
  const update = jasmine.createSpy('update');
  const create = jasmine.createSpy('create').and.callFake(() => ({
    mount: mountSpy,
    unmount: unmountSpy,
  }));
  const elements = jasmine.createSpy('elements').and.callFake(() => ({
    create,
    submit,
    update,
  }));
  const confirmPayment = jasmine.createSpy('confirmPayment');
  const retrievePaymentIntent = jasmine.createSpy('retrievePaymentIntent');

  const stripeMock = {
    elements,
    confirmPayment,
    retrievePaymentIntent,
  };

  beforeEach(() => {
    mountSpy.calls.reset();
    unmountSpy.calls.reset();
    submit.calls.reset();
    submit.and.resolveTo({ error: undefined });
    create.calls.reset();
    elements.calls.reset();
    confirmPayment.calls.reset();
    retrievePaymentIntent.calls.reset();

    backend = jasmine.createSpyObj<BackendService>('BackendService', [
      'createUsBankAccountPayment',
      'createStripePayment',
      'createPayPalOrder',
      'capturePayPalOrder',
    ]);
    backend.createUsBankAccountPayment.and.resolveTo({
      provider: 'usBankAccount',
      clientSecret: 'pi_ach_secret',
      paymentIntentId: 'pi_ach_123',
      sessionId: 'sess_ach_1',
    });

    sdkLoader = jasmine.createSpyObj<StripeSdkLoader>('StripeSdkLoader', ['load']);
    sdkLoader.load.and.resolveTo(stripeMock as never);

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withXhr()),
        { provide: PLATFORM_ID, useValue: 'browser' },
        provideEasyPayments({
          enableMockMode: false,
          providers: {
            stripe: { publishableKey: 'pk_test_ach_headless' },
            usBankAccount: {},
          },
          backend: {
            createUsBankAccountPaymentUrl: '/api/payments/us-bank-account/create',
          },
        }),
        { provide: BackendService, useValue: backend },
        { provide: StripeSdkLoader, useValue: sdkLoader },
      ],
    });

    headless = TestBed.inject(EasyPaymentsHeadless);
    registry = TestBed.inject(HeadlessSessionRegistry);
    adapter = TestBed.inject(UsBankAccountAdapter);
    registry.clearForTests();
    TestBed.inject(StripeRedirectRecoveryService).resetForTests();
  });

  afterEach(() => {
    registry.clearForTests();
    TestBed.inject(StripeRedirectRecoveryService).resetForTests();
  });

  async function readySession(
    overrides: Partial<Parameters<EasyPaymentsHeadless['createSession']>[0]> = {},
  ): Promise<HeadlessCheckoutSession> {
    const session = headless.createSession({
      product: overrides.product ?? PRODUCT,
      methods: overrides.methods ?? ['us-bank-account'],
      checkoutInstanceId:
        overrides.checkoutInstanceId ?? `ach-${Math.random().toString(36).slice(2, 8)}`,
      checkout: overrides.checkout,
      locale: overrides.locale,
      translations: overrides.translations,
      theme: overrides.theme,
    });
    await session.initialize();
    return session;
  }

  it('accepts us-bank-account in HeadlessSessionOptions.methods', () => {
    expect(() =>
      headless.createSession({
        product: PRODUCT,
        methods: ['us-bank-account'],
        checkoutInstanceId: 'ach-opt-in',
      }),
    ).not.toThrow();
  });

  it('mounts the ACH Payment Element into a merchant container', async () => {
    const session = await readySession();
    session.selectMethod('us-bank-account');
    const host = document.createElement('div');
    const handle = await session.mount('us-bank-account', host);

    expect(backend.createUsBankAccountPayment).toHaveBeenCalled();
    expect(elements).toHaveBeenCalled();
    expect(mountSpy).toHaveBeenCalledWith(host);
    expect(adapter.hasMountedElement(session.id)).toBeTrue();
    expect(handle.method).toBe('us-bank-account');
    expect(session.selectedMethod()).toBe('us-bank-account');
    await session.destroy();
  });

  it('maps processing intents to pending without inviting retry', async () => {
    confirmPayment.and.resolveTo({
      paymentIntent: { id: 'pi_ach_123', status: 'processing' },
    });
    const session = await readySession();
    await session.mount('us-bank-account', document.createElement('div'));

    const pending = firstValueFrom(session.events.pending);
    const successes: unknown[] = [];
    session.events.success.subscribe((value) => successes.push(value));

    await session.confirm();
    await expectAsync(pending).toBeResolvedTo(
      jasmine.objectContaining({
        status: 'processing',
        method: 'us-bank-account',
      }),
    );
    expect(session.state()).toBe('pending');
    expect(successes.length).toBe(0);
    await expectAsync(session.confirm()).toBeRejectedWith(
      jasmine.objectContaining({ message: jasmine.stringMatching(/pending/) }),
    );
    await session.destroy();
  });

  it('emits success for succeeded ACH intents', async () => {
    confirmPayment.and.resolveTo({
      paymentIntent: { id: 'pi_ach_123', status: 'succeeded' },
    });
    const session = await readySession();
    await session.mount('us-bank-account', document.createElement('div'));

    const success = firstValueFrom(session.events.success);
    await session.confirm();
    await expectAsync(success).toBeResolvedTo(
      jasmine.objectContaining({ status: 'success', transactionId: 'pi_ach_123' }),
    );
    expect(session.state()).toBe('success');
    await session.destroy();
  });

  it('blocks duplicate in-flight ACH confirm', async () => {
    let resolveConfirm!: (value: unknown) => void;
    confirmPayment.and.returnValue(
      new Promise((resolve) => {
        resolveConfirm = resolve;
      }),
    );
    const session = await readySession();
    await session.mount('us-bank-account', document.createElement('div'));

    const first = session.confirm();
    await expectAsync(session.confirm()).toBeRejectedWith(
      jasmine.objectContaining({ message: jasmine.stringMatching(/already in progress/) }),
    );
    resolveConfirm({ paymentIntent: { id: 'pi_ach_123', status: 'processing' } });
    await first;
    expect(session.state()).toBe('pending');
    await session.destroy();
  });

  it('rejects ACH mount when create URL is missing', async () => {
    const session = headless.createSession({
      product: PRODUCT,
      methods: ['us-bank-account'],
      checkoutInstanceId: 'ach-no-backend',
    });
    const { EasyPaymentsConfigService } = await import('../config/easy-payments-config.service');
    TestBed.inject(EasyPaymentsConfigService).replace({
      enableMockMode: false,
      providers: {
        stripe: { publishableKey: 'pk_test_ach_headless' },
        usBankAccount: {},
      },
      backend: {},
    });
    await session.initialize();
    await expectAsync(
      session.mount('us-bank-account', document.createElement('div')),
    ).toBeRejectedWith(jasmine.objectContaining({ code: 'PROVIDER_UNAVAILABLE' }));
    await session.destroy();
  });

  it('recovers ACH return via retrieve only (no second confirm)', async () => {
    retrievePaymentIntent.and.resolveTo({
      paymentIntent: { id: 'pi_ach_return', status: 'processing' },
    });
    const session = await readySession({ checkoutInstanceId: 'ach-return' });

    const url = new URL(window.location.href);
    url.searchParams.set('ep_method', 'us-bank-account');
    url.searchParams.set('payment_intent', 'pi_ach_return');
    url.searchParams.set('payment_intent_client_secret', 'pi_ach_return_secret');
    url.searchParams.set('redirect_status', 'succeeded');
    window.history.replaceState({}, '', url.href);

    const pending = firstValueFrom(session.events.pending);
    const result = await session.recoverReturn();

    expect(result?.status).toBe('processing');
    expect(retrievePaymentIntent).toHaveBeenCalled();
    expect(confirmPayment).not.toHaveBeenCalled();
    await expectAsync(pending).toBeResolvedTo(
      jasmine.objectContaining({ status: 'processing', method: 'us-bank-account' }),
    );
    expect(session.state()).toBe('pending');

    // Idempotent recoverReturn after settle; confirm must not start another payment.
    expect(await session.recoverReturn()).toEqual(
      jasmine.objectContaining({ status: 'processing', method: 'us-bank-account' }),
    );
    await expectAsync(session.confirm()).toBeRejectedWith(
      jasmine.objectContaining({ message: jasmine.stringMatching(/pending/) }),
    );

    await session.destroy();
  });

  it('rejects unsupported Headless methods without regressing ACH opt-in', () => {
    expect(() =>
      headless.createSession({
        product: PRODUCT,
        methods: ['not-a-method' as never],
        checkoutInstanceId: 'bad-method',
      }),
    ).toThrowError(PaymentError);
  });
});
