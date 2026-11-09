import { TestBed } from '@angular/core/testing';
import { provideHttpClient, withXhr } from '@angular/common/http';
import { PLATFORM_ID } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { provideEasyPayments } from '../config/provide-easy-payments';
import { BackendService } from '../services/backend.service';
import { PaymentError } from '../errors/payment-error';
import type { PaymentProduct, PaymentResult } from '../models';
import { StripeSdkLoader } from '../adapters/stripe/stripe-sdk.loader';
import { StripeRedirectRecoveryService } from '../adapters/stripe/stripe-redirect-recovery.service';
import {
  clearStripePendingReturn,
  markHeadlessPendingReturn,
  markStripePendingReturn,
  readStripePendingReturn,
  readStripeReturnParams,
  STRIPE_PENDING_STORAGE_KEY,
  STRIPE_PENDING_TTL_MS,
} from '../adapters/stripe/stripe-redirect-return';
import { resetTestLocation, setTestLocation } from '../testing/test-history';
import { EasyPaymentsHeadless } from './easy-payments-headless.service';
import { HeadlessSessionRegistry } from './headless-session-registry';
import type { HeadlessCheckoutSession } from './headless.types';

const PRODUCT: PaymentProduct = {
  id: 'premium-plan',
  name: 'Premium',
  amount: 99,
  currency: 'USD',
};

const ATTEMPT = 'a1b2c3d4e5f60718';
const OTHER_ATTEMPT = 'ffffeeee00001111';

describe('HeadlessCheckoutSession recoverReturn (H4.3)', () => {
  let headless: EasyPaymentsHeadless;
  let registry: HeadlessSessionRegistry;
  let recovery: StripeRedirectRecoveryService;
  let retrieve: jasmine.Spy;
  const liveSessions: HeadlessCheckoutSession[] = [];

  const stripeMock = {
    elements: jasmine.createSpy('elements'),
    confirmPayment: jasmine.createSpy('confirmPayment'),
    retrievePaymentIntent: jasmine.createSpy('retrievePaymentIntent'),
  };

  beforeEach(() => {
    sessionStorage.removeItem(STRIPE_PENDING_STORAGE_KEY);
    resetTestLocation();
    liveSessions.length = 0;

    const backend = jasmine.createSpyObj<BackendService>('BackendService', [
      'createStripePayment',
      'createKlarnaPayment',
      'createAffirmPayment',
      'createPayPalOrder',
      'capturePayPalOrder',
    ]);
    backend.createStripePayment.and.resolveTo({
      provider: 'stripe',
      clientSecret: 'pi_card_secret',
      paymentIntentId: 'pi_card',
      sessionId: 'sess_card',
    });
    backend.createKlarnaPayment.and.resolveTo({
      provider: 'klarna',
      clientSecret: 'pi_klarna_secret',
      paymentIntentId: 'pi_klarna',
      sessionId: 'sess_klarna',
    });
    backend.createAffirmPayment.and.resolveTo({
      provider: 'affirm',
      clientSecret: 'pi_affirm_secret',
      paymentIntentId: 'pi_affirm',
      sessionId: 'sess_affirm',
    });

    const sdkLoader = jasmine.createSpyObj<StripeSdkLoader>('StripeSdkLoader', ['load']);
    sdkLoader.load.and.resolveTo(stripeMock as never);

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withXhr()),
        { provide: PLATFORM_ID, useValue: 'browser' },
        provideEasyPayments({
          enableMockMode: false,
          providers: {
            stripe: { publishableKey: 'pk_test_123456789' },
            klarna: {},
            affirm: {},
          },
          backend: {
            createPaymentUrl: '/api/payments/create',
            klarnaCreatePaymentUrl: '/api/payments/klarna',
            affirmCreatePaymentUrl: '/api/payments/affirm',
          },
        }),
        { provide: BackendService, useValue: backend },
        { provide: StripeSdkLoader, useValue: sdkLoader },
      ],
    });

    headless = TestBed.inject(EasyPaymentsHeadless);
    registry = TestBed.inject(HeadlessSessionRegistry);
    recovery = TestBed.inject(StripeRedirectRecoveryService);
    recovery.resetForTests();
    retrieve = spyOn(recovery, 'retrieveReturningPayment');
    registry.clearForTests();
  });

  afterEach(async () => {
    await Promise.all(
      liveSessions.splice(0).map(async (session) => {
        if (session.state() !== 'destroyed') {
          try {
            await session.destroy();
          } catch {
            // Ignore teardown failures — isolation is the goal.
          }
        }
      }),
    );
    registry.clearForTests();
    recovery.resetForTests();
    sessionStorage.removeItem(STRIPE_PENDING_STORAGE_KEY);
    resetTestLocation();
  });

  function setReturnUrl(
    method: 'klarna' | 'affirm' = 'klarna',
    extra: Record<string, string> = {},
  ): void {
    setTestLocation(
      `/?${new URLSearchParams({
        payment_intent: 'pi_ret',
        payment_intent_client_secret: 'pi_ret_secret_x',
        ep_method: method,
        ep_attempt: ATTEMPT,
        ...extra,
      }).toString()}`,
    );
  }

  function markHeadless(
    method: 'klarna' | 'affirm' = 'klarna',
    checkoutInstanceId = 'hl-recover',
    attemptId = ATTEMPT,
  ): void {
    markHeadlessPendingReturn(method, PRODUCT.id, { attemptId, checkoutInstanceId });
  }

  async function readySession(
    overrides: {
      checkoutInstanceId?: string | null;
      methods?: Array<'klarna' | 'affirm' | 'card'>;
      product?: PaymentProduct;
    } = {},
  ): Promise<HeadlessCheckoutSession> {
    const options: Parameters<EasyPaymentsHeadless['createSession']>[0] = {
      product: overrides.product ?? PRODUCT,
      methods: overrides.methods ?? ['klarna', 'affirm'],
    };
    if (overrides.checkoutInstanceId !== null) {
      options.checkoutInstanceId =
        overrides.checkoutInstanceId === undefined
          ? 'hl-recover'
          : overrides.checkoutInstanceId;
    }
    const session = headless.createSession(options);
    liveSessions.push(session);
    await session.initialize();
    return session;
  }

  function successResult(method: 'klarna' | 'affirm' = 'klarna'): PaymentResult {
    return {
      status: 'success',
      method,
      provider: method,
      transactionId: 'pi_ret',
      message: `${method} ok`,
    };
  }

  it('recovers Klarna success after session recreate without mounting', async () => {
    setReturnUrl('klarna');
    markHeadless('klarna', 'hl-recover');
    retrieve.and.resolveTo(successResult('klarna'));

    const session = await readySession({ checkoutInstanceId: 'hl-recover', methods: ['klarna'] });
    const started = firstValueFrom(session.events.started);
    const success = firstValueFrom(session.events.success);

    const result = await session.recoverReturn();

    expect(result).toEqual(jasmine.objectContaining({ status: 'success', method: 'klarna' }));
    await expectAsync(started).toBeResolvedTo(jasmine.objectContaining({ method: 'klarna' }));
    await expectAsync(success).toBeResolvedTo(jasmine.objectContaining({ status: 'success' }));
    expect(session.state()).toBe('success');
    expect(retrieve).toHaveBeenCalled();
    expect(readStripePendingReturn()).toBeNull();
    expect(readStripeReturnParams().clientSecret).toBeNull();
    await session.destroy();
  });

  it('recovers Affirm success', async () => {
    setReturnUrl('affirm');
    markHeadless('affirm', 'hl-affirm');
    retrieve.and.resolveTo(successResult('affirm'));

    const session = await readySession({
      checkoutInstanceId: 'hl-affirm',
      methods: ['affirm'],
    });
    const result = await session.recoverReturn();
    expect(result?.method).toBe('affirm');
    expect(session.state()).toBe('success');
    await session.destroy();
  });

  it('rejects recovery without a stable merchant checkoutInstanceId', async () => {
    setReturnUrl('klarna');
    markHeadless('klarna', 'hl-auto');
    const session = headless.createSession({
      product: PRODUCT,
      methods: ['klarna'],
    });
    liveSessions.push(session);
    await session.initialize();
    await expectAsync(session.recoverReturn()).toBeRejectedWith(
      jasmine.objectContaining({ code: 'CONFIG_INVALID' }),
    );
    expect(retrieve).not.toHaveBeenCalled();
    await session.destroy();
  });

  it('returns null for wrong checkoutInstanceId without consuming', async () => {
    setReturnUrl('klarna');
    markHeadless('klarna', 'hl-owner');
    retrieve.and.resolveTo(successResult());

    const session = await readySession({ checkoutInstanceId: 'hl-other' });
    expect(await session.recoverReturn()).toBeNull();
    expect(retrieve).not.toHaveBeenCalled();
    expect(session.state()).toBe('ready');
    expect(readStripePendingReturn()?.checkoutInstanceId).toBe('hl-owner');
    await session.destroy();
  });

  it('returns null when there are no return parameters', async () => {
    const session = await readySession();
    expect(await session.recoverReturn()).toBeNull();
    expect(retrieve).not.toHaveBeenCalled();
    expect(session.state()).toBe('ready');
    await session.destroy();
  });

  it('returns null for an unrelated Checkout/Buttons marker', async () => {
    setReturnUrl('klarna');
    markStripePendingReturn('klarna', PRODUCT.id, undefined, {
      attemptId: ATTEMPT,
      hostKind: 'checkout',
      checkoutInstanceId: 'hl-recover',
    });
    retrieve.and.resolveTo(successResult());

    const session = await readySession({ checkoutInstanceId: 'hl-recover' });
    expect(await session.recoverReturn()).toBeNull();
    expect(retrieve).not.toHaveBeenCalled();
    await session.destroy();
  });

  it('returns null when the pending marker is missing', async () => {
    setReturnUrl('klarna');
    const session = await readySession();
    expect(await session.recoverReturn()).toBeNull();
    expect(retrieve).not.toHaveBeenCalled();
    await session.destroy();
  });

  it('returns null for an expired Headless marker', async () => {
    setReturnUrl('klarna');
    sessionStorage.setItem(
      STRIPE_PENDING_STORAGE_KEY,
      JSON.stringify({
        method: 'klarna',
        productId: PRODUCT.id,
        attemptId: ATTEMPT,
        hostKind: 'headless',
        checkoutInstanceId: 'hl-recover',
        at: Date.now() - STRIPE_PENDING_TTL_MS - 1,
      }),
    );
    const session = await readySession();
    expect(await session.recoverReturn()).toBeNull();
    expect(retrieve).not.toHaveBeenCalled();
    await session.destroy();
  });

  it('returns null for a corrupted marker', async () => {
    setReturnUrl('klarna');
    sessionStorage.setItem(STRIPE_PENDING_STORAGE_KEY, '{not-json');
    const session = await readySession();
    expect(await session.recoverReturn()).toBeNull();
    expect(retrieve).not.toHaveBeenCalled();
    await session.destroy();
  });

  it('returns null for a tampered attempt id', async () => {
    setReturnUrl('klarna', { ep_attempt: OTHER_ATTEMPT });
    markHeadless('klarna', 'hl-recover', ATTEMPT);
    const session = await readySession();
    expect(await session.recoverReturn()).toBeNull();
    expect(retrieve).not.toHaveBeenCalled();
    await session.destroy();
  });

  it('returns null for a tampered payment method', async () => {
    setReturnUrl('affirm');
    markHeadless('klarna', 'hl-recover');
    const session = await readySession();
    expect(await session.recoverReturn()).toBeNull();
    expect(retrieve).not.toHaveBeenCalled();
    await session.destroy();
  });

  it('maps Stripe processing to pending with a single pending event', async () => {
    setReturnUrl('klarna');
    markHeadless();
    retrieve.and.resolveTo({
      status: 'processing',
      method: 'klarna',
      provider: 'klarna',
      transactionId: 'pi_ret',
      message: 'processing',
    });
    const session = await readySession();
    const pending = firstValueFrom(session.events.pending);
    const result = await session.recoverReturn();
    expect(result?.status).toBe('processing');
    expect(session.state()).toBe('pending');
    await expectAsync(pending).toBeResolved();
    await session.destroy();
  });

  it('maps requires_capture through the existing success contract', async () => {
    setReturnUrl('klarna');
    markHeadless();
    retrieve.and.resolveTo({
      status: 'success',
      method: 'klarna',
      provider: 'klarna',
      transactionId: 'pi_ret',
      metadata: {
        stripeStatus: 'requires_capture',
        gateway: 'stripe',
        authorizationOnly: true,
      },
    });
    const session = await readySession();
    const result = await session.recoverReturn();
    expect(result?.status).toBe('success');
    expect(result?.metadata?.['stripeStatus']).toBe('requires_capture');
    expect(result?.metadata?.['authorizationOnly']).toBe(true);
    await session.destroy();
  });

  it('maps requires_action to AUTHENTICATION_REQUIRED error (not success/pending)', async () => {
    setReturnUrl('klarna');
    markHeadless();
    retrieve.and.rejectWith(
      new PaymentError({
        code: 'AUTHENTICATION_REQUIRED',
        message: 'still requires action',
        method: 'klarna',
        provider: 'klarna',
      }),
    );
    const session = await readySession();
    const errors: PaymentError[] = [];
    session.events.error.subscribe((e) => errors.push(e));
    await expectAsync(session.recoverReturn()).toBeRejectedWith(
      jasmine.objectContaining({ code: 'AUTHENTICATION_REQUIRED' }),
    );
    expect(session.state()).toBe('error');
    expect(session.lastResult()?.status).not.toBe('success');
    expect(errors.length).toBe(1);
    await session.destroy();
  });

  it('maps requires_confirmation like requires_action (typed error)', async () => {
    setReturnUrl('klarna');
    markHeadless();
    retrieve.and.rejectWith(
      new PaymentError({
        code: 'AUTHENTICATION_REQUIRED',
        message: 'requires confirmation',
        method: 'klarna',
        provider: 'klarna',
      }),
    );
    const session = await readySession();
    await expectAsync(session.recoverReturn()).toBeRejectedWith(
      jasmine.objectContaining({ code: 'AUTHENTICATION_REQUIRED' }),
    );
    expect(session.state()).toBe('error');
    await session.destroy();
  });

  it('maps Stripe cancellation', async () => {
    setReturnUrl('klarna');
    markHeadless();
    retrieve.and.resolveTo({
      status: 'cancelled',
      method: 'klarna',
      provider: 'klarna',
      message: 'cancelled',
    });
    const session = await readySession();
    const cancel = firstValueFrom(session.events.cancel);
    const result = await session.recoverReturn();
    expect(result?.status).toBe('cancelled');
    expect(session.state()).toBe('cancelled');
    await expectAsync(cancel).toBeResolved();
    await session.destroy();
  });

  it('maps Stripe retrieval failure to error once', async () => {
    setReturnUrl('klarna');
    markHeadless();
    retrieve.and.rejectWith(
      new PaymentError({
        code: 'PAYMENT_FAILED',
        message: 'retrieve failed',
        method: 'klarna',
        provider: 'klarna',
      }),
    );
    const session = await readySession();
    const errors: PaymentError[] = [];
    session.events.error.subscribe((e) => errors.push(e));

    await expectAsync(session.recoverReturn()).toBeRejectedWith(
      jasmine.objectContaining({ code: 'PAYMENT_FAILED' }),
    );
    expect(session.state()).toBe('error');
    expect(errors.length).toBe(1);

    await expectAsync(session.recoverReturn()).toBeRejectedWith(
      jasmine.objectContaining({ code: 'PAYMENT_FAILED' }),
    );
    expect(errors.length).toBe(1);
    await session.destroy();
  });

  it('is idempotent for duplicate recoverReturn after success', async () => {
    setReturnUrl('klarna');
    markHeadless();
    retrieve.and.resolveTo(successResult());
    const session = await readySession();
    const successes: PaymentResult[] = [];
    session.events.success.subscribe((r) => successes.push(r));

    const first = await session.recoverReturn();
    const second = await session.recoverReturn();
    expect(first?.status).toBe('success');
    expect(second?.status).toBe('success');
    expect(successes.length).toBe(1);
    expect(retrieve).toHaveBeenCalledTimes(1);
    await session.destroy();
  });

  it('shares one promise for concurrent recoverReturn calls', async () => {
    setReturnUrl('klarna');
    markHeadless();
    let release!: (value: PaymentResult) => void;
    retrieve.and.returnValue(
      new Promise<PaymentResult>((resolve) => {
        release = resolve;
      }),
    );
    const session = await readySession();
    const a = session.recoverReturn();
    const b = session.recoverReturn();
    release(successResult());
    const [ra, rb] = await Promise.all([a, b]);
    expect(ra?.status).toBe('success');
    expect(rb?.status).toBe('success');
    expect(retrieve).toHaveBeenCalledTimes(1);
    await session.destroy();
  });

  it('lets only the matching Headless session win a race', async () => {
    setReturnUrl('klarna');
    markHeadless('klarna', 'hl-a');
    retrieve.and.resolveTo(successResult());

    const a = await readySession({ checkoutInstanceId: 'hl-a' });
    const b = await readySession({ checkoutInstanceId: 'hl-b' });

    const [ra, rb] = await Promise.all([a.recoverReturn(), b.recoverReturn()]);
    expect(ra?.status).toBe('success');
    expect(rb).toBeNull();
    expect(a.state()).toBe('success');
    expect(b.state()).toBe('ready');
    await a.destroy();
    await b.destroy();
  });

  it('ignores destroy during recovery without emitting success', async () => {
    setReturnUrl('klarna');
    markHeadless();
    let release!: (value: PaymentResult) => void;
    retrieve.and.returnValue(
      new Promise<PaymentResult>((resolve) => {
        release = resolve;
      }),
    );
    const session = await readySession();
    const successes: PaymentResult[] = [];
    session.events.success.subscribe((r) => successes.push(r));

    const pending = session.recoverReturn();
    await session.destroy();
    release(successResult());
    expect(await pending).toBeNull();
    expect(successes.length).toBe(0);
    expect(session.state()).toBe('destroyed');
  });

  it('requires initialize before recoverReturn', async () => {
    const session = headless.createSession({
      product: PRODUCT,
      methods: ['klarna'],
      checkoutInstanceId: 'hl-init',
    });
    liveSessions.push(session);
    await expectAsync(session.recoverReturn()).toBeRejectedWith(
      jasmine.objectContaining({ code: 'CONFIG_INVALID' }),
    );
    await session.destroy();
  });

  it('clears URL and marker after owned consume', async () => {
    setReturnUrl('klarna');
    markHeadless();
    retrieve.and.resolveTo(successResult());
    const session = await readySession();
    await session.recoverReturn();
    expect(sessionStorage.getItem(STRIPE_PENDING_STORAGE_KEY)).toBeNull();
    expect(readStripeReturnParams().paymentIntentId).toBeNull();
    expect(readStripeReturnParams().attemptId).toBeNull();
    await session.destroy();
  });

  it('does not clear another session marker when not the owner', async () => {
    setReturnUrl('klarna');
    markHeadless('klarna', 'hl-owner');
    const session = await readySession({ checkoutInstanceId: 'hl-other' });
    await session.recoverReturn();
    expect(readStripePendingReturn()?.checkoutInstanceId).toBe('hl-owner');
    clearStripePendingReturn();
    await session.destroy();
  });

  it('preserves marker on transient verification failure and allows safe retry', async () => {
    setReturnUrl('klarna');
    markHeadless();
    retrieve.and.rejectWith(
      new PaymentError({
        code: 'NETWORK_ERROR',
        message: 'network down',
        method: 'klarna',
        provider: 'klarna',
      }),
    );
    const session = await readySession();
    const errors: PaymentError[] = [];
    session.events.error.subscribe((e) => errors.push(e));

    await expectAsync(session.recoverReturn()).toBeRejectedWith(
      jasmine.objectContaining({ code: 'NETWORK_ERROR' }),
    );
    expect(session.state()).toBe('error');
    expect(readStripePendingReturn()?.checkoutInstanceId).toBe('hl-recover');
    expect(readStripeReturnParams().clientSecret).toBeTruthy();
    expect(recovery.wasReturnConsumed()).toBeFalse();

    retrieve.and.resolveTo(successResult());
    const result = await session.recoverReturn();
    expect(result?.status).toBe('success');
    expect(session.state()).toBe('success');
    expect(errors.length).toBe(1);
    expect(readStripePendingReturn()).toBeNull();
    await session.destroy();
  });

  it('rejects mount/selectMethod/confirm while recovery is processing', async () => {
    setReturnUrl('klarna');
    markHeadless();
    let release!: (value: PaymentResult) => void;
    retrieve.and.returnValue(
      new Promise<PaymentResult>((resolve) => {
        release = resolve;
      }),
    );
    const session = await readySession({ methods: ['klarna', 'affirm'] });
    const pending = session.recoverReturn();

    expect(() => session.selectMethod('affirm')).toThrowMatching(
      (e) => e instanceof PaymentError && e.code === 'PAYMENT_FAILED',
    );
    await expectAsync(session.mount('affirm', document.createElement('div'))).toBeRejectedWith(
      jasmine.objectContaining({ code: 'PAYMENT_FAILED' }),
    );
    await expectAsync(session.confirm()).toBeRejectedWith(
      jasmine.objectContaining({ code: 'PAYMENT_FAILED' }),
    );

    release(successResult());
    await pending;
    await session.destroy();
  });

  it('rejects mount/selectMethod/confirm while payment is pending', async () => {
    setReturnUrl('klarna');
    markHeadless();
    retrieve.and.resolveTo({
      status: 'processing',
      method: 'klarna',
      provider: 'klarna',
      transactionId: 'pi_ret',
    });
    const session = await readySession({ methods: ['klarna', 'affirm'] });
    await session.recoverReturn();
    expect(session.state()).toBe('pending');

    expect(() => session.selectMethod('affirm')).toThrowMatching(
      (e) => e instanceof PaymentError && e.code === 'PAYMENT_FAILED',
    );
    await expectAsync(session.mount('klarna', document.createElement('div'))).toBeRejectedWith(
      jasmine.objectContaining({ code: 'PAYMENT_FAILED' }),
    );
    await expectAsync(session.confirm()).toBeRejectedWith(
      jasmine.objectContaining({ code: 'PAYMENT_FAILED' }),
    );
    await expectAsync(session.recoverReturn()).toBeResolvedTo(
      jasmine.objectContaining({ status: 'processing' }),
    );
    await session.destroy();
  });

  it('allows refreshAvailability while pending without mutating payment state', async () => {
    setReturnUrl('klarna');
    markHeadless();
    retrieve.and.resolveTo({
      status: 'processing',
      method: 'klarna',
      provider: 'klarna',
      transactionId: 'pi_ret',
    });
    const session = await readySession();
    await session.recoverReturn();
    expect(session.state()).toBe('pending');
    await session.refreshAvailability();
    expect(session.state()).toBe('pending');
    expect(session.lastResult()?.status).toBe('processing');
    await session.destroy();
  });

  it('maps requires_payment_method failure without success', async () => {
    setReturnUrl('klarna');
    markHeadless();
    retrieve.and.rejectWith(
      new PaymentError({
        code: 'PAYMENT_FAILED',
        message: 'requires payment method',
        method: 'klarna',
        provider: 'klarna',
      }),
    );
    const session = await readySession();
    await expectAsync(session.recoverReturn()).toBeRejectedWith(
      jasmine.objectContaining({ code: 'PAYMENT_FAILED' }),
    );
    expect(session.state()).toBe('error');
    expect(session.lastResult()).toBeNull();
    await session.destroy();
  });

  it('maps unknown PaymentIntent status to failure', async () => {
    setReturnUrl('klarna');
    markHeadless();
    retrieve.and.rejectWith(
      new PaymentError({
        code: 'PAYMENT_FAILED',
        message: 'Unexpected PaymentIntent status: mystery.',
        method: 'klarna',
        provider: 'klarna',
      }),
    );
    const session = await readySession();
    await expectAsync(session.recoverReturn()).toBeRejectedWith(
      jasmine.objectContaining({ code: 'PAYMENT_FAILED' }),
    );
    expect(session.state()).toBe('error');
    await session.destroy();
  });

  it('does not emit terminal events for browser refresh after consume (new session)', async () => {
    setReturnUrl('klarna');
    markHeadless();
    retrieve.and.resolveTo(successResult());
    const first = await readySession({ checkoutInstanceId: 'hl-refresh' });
    await first.recoverReturn();
    await first.destroy();

    // Consumed return: URL/marker cleared — new session sees no return.
    const second = await readySession({ checkoutInstanceId: 'hl-refresh' });
    const successes: PaymentResult[] = [];
    second.events.success.subscribe((r) => successes.push(r));
    expect(await second.recoverReturn()).toBeNull();
    expect(successes.length).toBe(0);
    expect(second.state()).toBe('ready');
    await second.destroy();
  });

  it('keeps Headless vs Checkout marker isolation during recovery attempt', async () => {
    setReturnUrl('klarna');
    markStripePendingReturn('klarna', PRODUCT.id, undefined, {
      attemptId: ATTEMPT,
      hostKind: 'checkout',
      checkoutInstanceId: 'co-1',
    });
    retrieve.and.resolveTo(successResult());
    const session = await readySession({ checkoutInstanceId: 'co-1' });
    expect(await session.recoverReturn()).toBeNull();
    expect(retrieve).not.toHaveBeenCalled();
    expect(readStripePendingReturn()?.hostKind).toBe('checkout');
    await session.destroy();
  });
});
