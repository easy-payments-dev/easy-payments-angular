import { TestBed } from '@angular/core/testing';
import { provideHttpClient, withXhr } from '@angular/common/http';
import { PLATFORM_ID } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { provideEasyPayments } from '../config/provide-easy-payments';
import { BackendService } from '../services/backend.service';
import { PaymentError } from '../errors/payment-error';
import type { PaymentProduct } from '../models';
import { StripeCardAdapter } from '../adapters/stripe/stripe-card.adapter';
import { StripeSdkLoader } from '../adapters/stripe/stripe-sdk.loader';
import { EasyPaymentsHeadless } from './easy-payments-headless.service';
import { HeadlessSessionRegistry } from './headless-session-registry';
import type { HeadlessCheckoutSession } from './headless.types';

const PRODUCT: PaymentProduct = {
  id: 'premium-plan',
  name: 'Premium',
  amount: 99,
  currency: 'USD',
};

describe('HeadlessCheckoutSession Stripe Card (H3.1)', () => {
  let headless: EasyPaymentsHeadless;
  let registry: HeadlessSessionRegistry;
  let backend: jasmine.SpyObj<BackendService>;
  let sdkLoader: jasmine.SpyObj<StripeSdkLoader>;
  let adapter: StripeCardAdapter;

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

  const stripeMock = {
    elements,
    confirmPayment,
  };

  beforeEach(() => {
    mountSpy.calls.reset();
    unmountSpy.calls.reset();
    submit.calls.reset();
    submit.and.resolveTo({ error: undefined });
    create.calls.reset();
    elements.calls.reset();
    confirmPayment.calls.reset();

    backend = jasmine.createSpyObj<BackendService>('BackendService', [
      'createStripePayment',
      'createPayPalOrder',
      'capturePayPalOrder',
    ]);
    backend.createStripePayment.and.resolveTo({
      provider: 'stripe',
      clientSecret: 'pi_test_secret',
      paymentIntentId: 'pi_123',
      sessionId: 'sess_1',
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

    headless = TestBed.inject(EasyPaymentsHeadless);
    registry = TestBed.inject(HeadlessSessionRegistry);
    adapter = TestBed.inject(StripeCardAdapter);
    registry.clearForTests();
  });

  afterEach(() => {
    registry.clearForTests();
  });

  async function readySession(
    overrides: Partial<Parameters<EasyPaymentsHeadless['createSession']>[0]> = {},
  ): Promise<HeadlessCheckoutSession> {
    const session = headless.createSession({
      product: overrides.product ?? PRODUCT,
      methods: overrides.methods ?? ['card'],
      checkoutInstanceId:
        overrides.checkoutInstanceId ?? `card-${Math.random().toString(36).slice(2, 8)}`,
      checkout: overrides.checkout,
      locale: overrides.locale,
      translations: overrides.translations,
      theme: overrides.theme,
    });
    await session.initialize();
    return session;
  }

  it('mounts the Stripe Payment Element into a merchant container', async () => {
    const session = await readySession();
    session.selectMethod('card');
    const host = document.createElement('div');
    const handle = await session.mount('card', host);

    expect(backend.createStripePayment).toHaveBeenCalled();
    expect(elements).toHaveBeenCalled();
    expect(mountSpy).toHaveBeenCalledWith(host);
    expect(adapter.hasMountedElement(session.id)).toBeTrue();
    expect(handle.method).toBe('card');
    expect(session.selectedMethod()).toBe('card');
  });

  it('rejects an invalid mount container', async () => {
    const session = await readySession();
    await expectAsync(session.mount('card', null as never)).toBeRejectedWith(
      jasmine.objectContaining({ code: 'CONFIG_INVALID' }),
    );
  });

  it('rejects mount before initialize', async () => {
    const session = headless.createSession({
      product: PRODUCT,
      methods: ['card'],
      checkoutInstanceId: 'pre-init',
    });
    await expectAsync(session.mount('card', document.createElement('div'))).toBeRejectedWith(
      jasmine.objectContaining({ message: jasmine.stringMatching(/initialize/) }),
    );
    await session.destroy();
  });

  it('rejects mount when Card is unavailable', async () => {
    const session = headless.createSession({
      product: PRODUCT,
      methods: ['card'],
      checkoutInstanceId: 'no-backend',
    });
    // Reconfigure after create: replace config so availability fails.
    const { EasyPaymentsConfigService } = await import('../config/easy-payments-config.service');
    TestBed.inject(EasyPaymentsConfigService).replace({
      enableMockMode: false,
      providers: {},
      backend: {},
    });
    await session.initialize();
    await expectAsync(session.mount('card', document.createElement('div'))).toBeRejectedWith(
      jasmine.objectContaining({ code: 'PROVIDER_UNAVAILABLE' }),
    );
    await session.destroy();
  });

  it('rejects unsupported methods and cleans up after mount failure', async () => {
    const session = await readySession({ methods: ['card', 'paypal'] });
    await expectAsync(
      session.mount('apple-pay', document.createElement('div')),
    ).toBeRejectedWith(
      jasmine.objectContaining({
        code: 'PROVIDER_NOT_IMPLEMENTED',
        message: jasmine.stringMatching(/Apple Pay/),
      }),
    );

    backend.createStripePayment.and.rejectWith(
      new PaymentError({ code: 'BACKEND_ERROR', message: 'backend down', method: 'card', provider: 'stripe' }),
    );
    await expectAsync(session.mount('card', document.createElement('div'))).toBeRejectedWith(
      jasmine.objectContaining({ code: 'BACKEND_ERROR' }),
    );
    expect(adapter.hasMountedElement(session.id)).toBeFalse();
    await session.destroy();
  });

  it('supports remount into another container and idempotent unmount', async () => {
    const session = await readySession();
    const a = document.createElement('div');
    const b = document.createElement('div');
    const firstHandle = await session.mount('card', a);
    expect(mountSpy).toHaveBeenCalledWith(a);

    const secondHandle = await session.mount('card', b);
    expect(mountSpy).toHaveBeenCalledWith(b);

    // Stale handle from a superseded mount must not tear down the active mount.
    firstHandle.unmount();
    expect(adapter.hasMountedElement(session.id)).toBeTrue();

    secondHandle.unmount();
    secondHandle.unmount();
    expect(adapter.hasMountedElement(session.id)).toBeFalse();
    await session.destroy();
  });

  it('rejects confirm without mount or without card selected', async () => {
    const session = await readySession({ methods: ['card'] });
    await expectAsync(session.confirm()).toBeRejectedWith(
      jasmine.objectContaining({ message: jasmine.stringMatching(/selectedMethod|Mount|mount/) }),
    );

    session.selectMethod('card');
    await expectAsync(session.confirm()).toBeRejectedWith(
      jasmine.objectContaining({ message: jasmine.stringMatching(/Mount the Payment Element/) }),
    );
    await session.destroy();
  });

  it('confirms successfully and emits started + success', async () => {
    confirmPayment.and.resolveTo({
      paymentIntent: { id: 'pi_123', status: 'succeeded' },
    });
    const session = await readySession();
    await session.mount('card', document.createElement('div'));

    const started = firstValueFrom(session.events.started);
    const success = firstValueFrom(session.events.success);
    await session.confirm();
    await expectAsync(started).toBeResolvedTo(
      jasmine.objectContaining({ method: 'card', provider: 'stripe', amount: 99 }),
    );
    await expectAsync(success).toBeResolvedTo(
      jasmine.objectContaining({ status: 'success', transactionId: 'pi_123' }),
    );
    expect(session.state()).toBe('success');
    expect(session.lastResult()?.status).toBe('success');
    await session.destroy();
  });

  it('maps processing intents to pending without inviting retry', async () => {
    confirmPayment.and.resolveTo({
      paymentIntent: { id: 'pi_123', status: 'processing' },
    });
    const session = await readySession();
    await session.mount('card', document.createElement('div'));
    const pending = firstValueFrom(session.events.pending);
    await session.confirm();
    await expectAsync(pending).toBeResolvedTo(
      jasmine.objectContaining({ status: 'processing' }),
    );
    expect(session.state()).toBe('pending');
    await expectAsync(session.confirm()).toBeRejectedWith(
      jasmine.objectContaining({ message: jasmine.stringMatching(/pending/) }),
    );
    await session.destroy();
  });

  it('emits cancel for cancelled intents and PAYMENT_CANCELLED errors', async () => {
    confirmPayment.and.resolveTo({
      paymentIntent: { id: 'pi_123', status: 'canceled' },
    });
    const session = await readySession();
    await session.mount('card', document.createElement('div'));
    const cancel = firstValueFrom(session.events.cancel);
    await session.confirm();
    await expectAsync(cancel).toBeResolvedTo(
      jasmine.objectContaining({ status: 'cancelled' }),
    );
    expect(session.state()).toBe('cancelled');

    confirmPayment.and.resolveTo({
      error: { message: 'canceled by user', type: 'invalid_request_error' },
    });
    // Remount for a fresh attempt after cancel.
    await session.mount('card', document.createElement('div'));
    const cancel2 = firstValueFrom(session.events.cancel);
    // mapStripeError may map differently — force adapter throw path:
    confirmPayment.and.rejectWith(
      new PaymentError({
        code: 'PAYMENT_CANCELLED',
        message: 'Buyer cancelled.',
        method: 'card',
        provider: 'stripe',
      }),
    );
    await session.confirm();
    await expectAsync(cancel2).toBeResolvedTo(
      jasmine.objectContaining({ status: 'cancelled' }),
    );
    await session.destroy();
  });

  it('emits error on confirmation failure and blocks duplicate in-flight confirm', async () => {
    let resolveConfirm!: (value: unknown) => void;
    confirmPayment.and.returnValue(
      new Promise((resolve) => {
        resolveConfirm = resolve;
      }),
    );
    const session = await readySession();
    await session.mount('card', document.createElement('div'));

    const first = session.confirm();
    await expectAsync(session.confirm()).toBeRejectedWith(
      jasmine.objectContaining({ message: jasmine.stringMatching(/already in progress/) }),
    );
    resolveConfirm({ error: { message: 'card declined', code: 'card_declined' } });
    await expectAsync(first).toBeRejected();
    expect(session.state()).toBe('error');
    expect(session.lastError()).toBeTruthy();
    await session.destroy();
  });

  it('enforces the page-global Stripe confirmation gate across sessions', async () => {
    let releaseFirst!: (value: unknown) => void;
    confirmPayment.and.returnValue(
      new Promise((resolve) => {
        releaseFirst = resolve;
      }),
    );

    const a = await readySession({ checkoutInstanceId: 'gate-a' });
    const b = await readySession({ checkoutInstanceId: 'gate-b' });
    await a.mount('card', document.createElement('div'));
    await b.mount('card', document.createElement('div'));

    const first = a.confirm();
    await expectAsync(b.confirm()).toBeRejectedWith(
      jasmine.objectContaining({ code: 'PROVIDER_UNAVAILABLE' }),
    );
    expect(b.state()).toBe('error');

    releaseFirst({ paymentIntent: { id: 'pi_a', status: 'succeeded' } });
    await first;
    expect(a.state()).toBe('success');

    confirmPayment.and.resolveTo({
      paymentIntent: { id: 'pi_b', status: 'succeeded' },
    });
    // Remount B after error so confirm is allowed again.
    await b.mount('card', document.createElement('div'));
    await b.confirm();
    expect(b.state()).toBe('success');

    await a.destroy();
    await b.destroy();
  });

  it('ignores stale confirm results after unmount and destroy during confirm', async () => {
    let resolveConfirm!: (value: unknown) => void;
    confirmPayment.and.returnValue(
      new Promise((resolve) => {
        resolveConfirm = resolve;
      }),
    );
    const session = await readySession({ checkoutInstanceId: 'stale-confirm' });
    const handle = await session.mount('card', document.createElement('div'));
    const pending = session.confirm();
    handle.unmount();
    resolveConfirm({ paymentIntent: { id: 'pi_123', status: 'succeeded' } });
    await pending;
    expect(session.state()).not.toBe('success');
    expect(session.lastResult()).toBeNull();

    confirmPayment.and.returnValue(
      new Promise((resolve) => {
        resolveConfirm = resolve;
      }),
    );
    const session2 = await readySession({ checkoutInstanceId: 'destroy-confirm' });
    await session2.mount('card', document.createElement('div'));
    const pending2 = session2.confirm();
    await session2.destroy();
    resolveConfirm({ paymentIntent: { id: 'pi_999', status: 'succeeded' } });
    await pending2;
    expect(session2.state()).toBe('destroyed');
    await session.destroy();
  });

  it('destroys during mount without leaving a mounted element', async () => {
    let resolveCreate!: (value: {
      provider: 'stripe';
      clientSecret: string;
      paymentIntentId: string;
      sessionId: string;
    }) => void;
    backend.createStripePayment.and.returnValue(
      new Promise((resolve) => {
        resolveCreate = resolve;
      }),
    );
    const session = await readySession({ checkoutInstanceId: 'destroy-mount' });
    const pending = session.mount('card', document.createElement('div'));
    await session.destroy();
    resolveCreate({
      provider: 'stripe',
      clientSecret: 'pi_test_secret',
      paymentIntentId: 'pi_123',
      sessionId: 'sess_1',
    });
    await expectAsync(pending).toBeRejectedWith(
      jasmine.objectContaining({ message: jasmine.stringMatching(/destroyed during mount/) }),
    );
    expect(adapter.hasMountedElement('destroy-mount')).toBeFalse();
  });

  it('keeps two Headless Card sessions isolated for mounts', async () => {
    confirmPayment.and.resolveTo({
      paymentIntent: { id: 'pi_ok', status: 'succeeded' },
    });
    const a = await readySession({ checkoutInstanceId: 'iso-a' });
    const b = await readySession({ checkoutInstanceId: 'iso-b' });
    await a.mount('card', document.createElement('div'));
    await b.mount('card', document.createElement('div'));
    expect(adapter.hasMountedElement('iso-a')).toBeTrue();
    expect(adapter.hasMountedElement('iso-b')).toBeTrue();

    await a.destroy();
    expect(adapter.hasMountedElement('iso-a')).toBeFalse();
    expect(adapter.hasMountedElement('iso-b')).toBeTrue();
    await b.destroy();
  });

  it('cleans up Stripe resources on session destroy', async () => {
    const session = await readySession({ checkoutInstanceId: 'cleanup' });
    await session.mount('card', document.createElement('div'));
    expect(adapter.hasMountedElement('cleanup')).toBeTrue();
    await session.destroy();
    expect(adapter.hasMountedElement('cleanup')).toBeFalse();
    expect(registry.has('cleanup')).toBeFalse();
  });
});
