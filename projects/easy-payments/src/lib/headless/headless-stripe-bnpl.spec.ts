import { TestBed } from '@angular/core/testing';
import { provideHttpClient, withXhr } from '@angular/common/http';
import { PLATFORM_ID } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { provideEasyPayments } from '../config/provide-easy-payments';
import { BackendService } from '../services/backend.service';
import { PaymentError } from '../errors/payment-error';
import type { PaymentProduct } from '../models';
import { StripeCardAdapter } from '../adapters/stripe/stripe-card.adapter';
import { KlarnaAdapter } from '../adapters/klarna/klarna.adapter';
import { AffirmAdapter } from '../adapters/affirm/affirm.adapter';
import { StripeSdkLoader } from '../adapters/stripe/stripe-sdk.loader';
import {
  STRIPE_PENDING_STORAGE_KEY,
  STRIPE_RETURN_METHOD_PARAM,
} from '../adapters/stripe/stripe-redirect-return';
import { EasyPaymentsHeadless } from './easy-payments-headless.service';
import { HeadlessSessionRegistry } from './headless-session-registry';
import type { HeadlessCheckoutSession } from './headless.types';

const PRODUCT: PaymentProduct = {
  id: 'premium-plan',
  name: 'Premium',
  amount: 99,
  currency: 'USD',
};

describe('HeadlessCheckoutSession Klarna & Affirm (H3.2)', () => {
  let headless: EasyPaymentsHeadless;
  let registry: HeadlessSessionRegistry;
  let backend: jasmine.SpyObj<BackendService>;
  let sdkLoader: jasmine.SpyObj<StripeSdkLoader>;
  let stripeCard: StripeCardAdapter;
  let klarna: KlarnaAdapter;
  let affirm: AffirmAdapter;

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
    sessionStorage.removeItem(STRIPE_PENDING_STORAGE_KEY);

    backend = jasmine.createSpyObj<BackendService>('BackendService', [
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
    stripeCard = TestBed.inject(StripeCardAdapter);
    klarna = TestBed.inject(KlarnaAdapter);
    affirm = TestBed.inject(AffirmAdapter);
    registry.clearForTests();
  });

  afterEach(() => {
    registry.clearForTests();
    sessionStorage.removeItem(STRIPE_PENDING_STORAGE_KEY);
  });

  async function readySession(
    overrides: Partial<Parameters<EasyPaymentsHeadless['createSession']>[0]> = {},
  ): Promise<HeadlessCheckoutSession> {
    const session = headless.createSession({
      product: overrides.product ?? PRODUCT,
      methods: overrides.methods ?? ['card', 'klarna', 'affirm'],
      checkoutInstanceId:
        overrides.checkoutInstanceId ?? `bnpl-${Math.random().toString(36).slice(2, 8)}`,
      checkout: overrides.checkout,
      locale: overrides.locale,
      translations: overrides.translations,
      theme: overrides.theme,
    });
    await session.initialize();
    return session;
  }

  it('mounts Klarna into a merchant container', async () => {
    const session = await readySession();
    const host = document.createElement('div');
    const handle = await session.mount('klarna', host);

    expect(backend.createKlarnaPayment).toHaveBeenCalled();
    expect(mountSpy).toHaveBeenCalledWith(host);
    expect(klarna.hasMountedElement(session.id)).toBeTrue();
    expect(handle.method).toBe('klarna');
    expect(session.selectedMethod()).toBe('klarna');
    await session.destroy();
  });

  it('mounts Affirm into a merchant container', async () => {
    const session = await readySession();
    const host = document.createElement('div');
    const handle = await session.mount('affirm', host);

    expect(backend.createAffirmPayment).toHaveBeenCalled();
    expect(mountSpy).toHaveBeenCalledWith(host);
    expect(affirm.hasMountedElement(session.id)).toBeTrue();
    expect(handle.method).toBe('affirm');
    expect(session.selectedMethod()).toBe('affirm');
    await session.destroy();
  });

  it('confirms Klarna successfully and emits started + success', async () => {
    confirmPayment.and.resolveTo({
      paymentIntent: { id: 'pi_klarna', status: 'succeeded' },
    });
    const session = await readySession();
    await session.mount('klarna', document.createElement('div'));

    const started = firstValueFrom(session.events.started);
    const success = firstValueFrom(session.events.success);
    await session.confirm();

    await expectAsync(started).toBeResolvedTo(
      jasmine.objectContaining({ method: 'klarna', provider: 'klarna', amount: 99 }),
    );
    await expectAsync(success).toBeResolvedTo(
      jasmine.objectContaining({ status: 'success', method: 'klarna' }),
    );
    expect(session.state()).toBe('success');
    await session.destroy();
  });

  it('confirms Affirm successfully', async () => {
    confirmPayment.and.resolveTo({
      paymentIntent: { id: 'pi_affirm', status: 'succeeded' },
    });
    const session = await readySession();
    await session.mount('affirm', document.createElement('div'));
    const success = firstValueFrom(session.events.success);
    await session.confirm();
    await expectAsync(success).toBeResolvedTo(
      jasmine.objectContaining({ status: 'success', method: 'affirm' }),
    );
    expect(session.state()).toBe('success');
    await session.destroy();
  });

  it('rejects mount when Klarna is unavailable', async () => {
    const session = headless.createSession({
      product: PRODUCT,
      methods: ['klarna'],
      checkoutInstanceId: 'klarna-unavail',
    });
    const { EasyPaymentsConfigService } = await import('../config/easy-payments-config.service');
    TestBed.inject(EasyPaymentsConfigService).replace({
      enableMockMode: false,
      providers: { stripe: { publishableKey: 'pk_test_123456789' } },
      backend: {},
    });
    await session.initialize();
    await expectAsync(session.mount('klarna', document.createElement('div'))).toBeRejectedWith(
      jasmine.objectContaining({ code: 'PROVIDER_UNAVAILABLE' }),
    );
    await session.destroy();
  });

  it('cleans up after Klarna mount failure', async () => {
    const session = await readySession({ methods: ['klarna'] });
    backend.createKlarnaPayment.and.rejectWith(
      new PaymentError({
        code: 'BACKEND_ERROR',
        message: 'klarna backend down',
        method: 'klarna',
        provider: 'klarna',
      }),
    );
    await expectAsync(session.mount('klarna', document.createElement('div'))).toBeRejectedWith(
      jasmine.objectContaining({ code: 'BACKEND_ERROR' }),
    );
    expect(klarna.hasMountedElement(session.id)).toBeFalse();
    await session.destroy();
  });

  it('rejects confirm with wrong selected method and without mount', async () => {
    const session = await readySession();
    await session.mount('klarna', document.createElement('div'));
    session.selectMethod('affirm');
    await expectAsync(session.confirm()).toBeRejectedWith(
      jasmine.objectContaining({ message: jasmine.stringMatching(/mount\("affirm"/) }),
    );

    session.selectMethod('card');
    await expectAsync(session.confirm()).toBeRejectedWith(
      jasmine.objectContaining({ message: jasmine.stringMatching(/mount\("card"/) }),
    );
    await session.destroy();
  });

  it('rejects confirm without mount', async () => {
    const session = await readySession({ methods: ['klarna'] });
    session.selectMethod('klarna');
    await expectAsync(session.confirm()).toBeRejectedWith(
      jasmine.objectContaining({ message: jasmine.stringMatching(/Mount the Payment Element/) }),
    );
    await session.destroy();
  });

  it('blocks duplicate Klarna confirmation', async () => {
    let resolveConfirm!: (value: unknown) => void;
    confirmPayment.and.returnValue(
      new Promise((resolve) => {
        resolveConfirm = resolve;
      }),
    );
    const session = await readySession({ methods: ['klarna'] });
    await session.mount('klarna', document.createElement('div'));
    const first = session.confirm();
    await expectAsync(session.confirm()).toBeRejectedWith(
      jasmine.objectContaining({ message: jasmine.stringMatching(/already in progress/) }),
    );
    resolveConfirm({ paymentIntent: { id: 'pi_klarna', status: 'succeeded' } });
    await first;
    await session.destroy();
  });

  it('supports Klarna remount and idempotent unmount', async () => {
    const session = await readySession({ methods: ['klarna'] });
    const a = document.createElement('div');
    const b = document.createElement('div');
    const first = await session.mount('klarna', a);
    const second = await session.mount('klarna', b);
    first.unmount();
    expect(klarna.hasMountedElement(session.id)).toBeTrue();
    second.unmount();
    second.unmount();
    expect(klarna.hasMountedElement(session.id)).toBeFalse();
    await session.destroy();
  });

  it('switches Card → Klarna and Klarna → Affirm without leaking mounts', async () => {
    const session = await readySession();
    await session.mount('card', document.createElement('div'));
    expect(stripeCard.hasMountedElement(session.id)).toBeTrue();

    await session.mount('klarna', document.createElement('div'));
    expect(stripeCard.hasMountedElement(session.id)).toBeFalse();
    expect(klarna.hasMountedElement(session.id)).toBeTrue();
    expect(session.selectedMethod()).toBe('klarna');

    await session.mount('affirm', document.createElement('div'));
    expect(klarna.hasMountedElement(session.id)).toBeFalse();
    expect(affirm.hasMountedElement(session.id)).toBeTrue();
    expect(session.selectedMethod()).toBe('affirm');
    await session.destroy();
  });

  it('keeps independent Klarna sessions isolated', async () => {
    const a = await readySession({ checkoutInstanceId: 'bnpl-iso-a', methods: ['klarna'] });
    const b = await readySession({ checkoutInstanceId: 'bnpl-iso-b', methods: ['klarna'] });
    await a.mount('klarna', document.createElement('div'));
    await b.mount('klarna', document.createElement('div'));
    expect(klarna.hasMountedElement('bnpl-iso-a')).toBeTrue();
    expect(klarna.hasMountedElement('bnpl-iso-b')).toBeTrue();
    await a.destroy();
    expect(klarna.hasMountedElement('bnpl-iso-a')).toBeFalse();
    expect(klarna.hasMountedElement('bnpl-iso-b')).toBeTrue();
    await b.destroy();
  });

  it('ignores stale Klarna confirm after unmount and destroy during confirm', async () => {
    let resolveConfirm!: (value: unknown) => void;
    confirmPayment.and.returnValue(
      new Promise((resolve) => {
        resolveConfirm = resolve;
      }),
    );
    const session = await readySession({ checkoutInstanceId: 'bnpl-stale', methods: ['klarna'] });
    const handle = await session.mount('klarna', document.createElement('div'));
    const pending = session.confirm();
    handle.unmount();
    resolveConfirm({ paymentIntent: { id: 'pi_klarna', status: 'succeeded' } });
    await pending;
    expect(session.state()).not.toBe('success');
    expect(session.lastResult()).toBeNull();

    confirmPayment.and.returnValue(
      new Promise((resolve) => {
        resolveConfirm = resolve;
      }),
    );
    const session2 = await readySession({
      checkoutInstanceId: 'bnpl-destroy-confirm',
      methods: ['klarna'],
    });
    await session2.mount('klarna', document.createElement('div'));
    const pending2 = session2.confirm();
    await session2.destroy();
    resolveConfirm({ paymentIntent: { id: 'pi_x', status: 'succeeded' } });
    await pending2;
    expect(session2.state()).toBe('destroyed');
    await session.destroy();
  });

  it('enforces the Stripe confirmation gate across Klarna sessions', async () => {
    let releaseFirst!: (value: unknown) => void;
    confirmPayment.and.returnValue(
      new Promise((resolve) => {
        releaseFirst = resolve;
      }),
    );
    const a = await readySession({ checkoutInstanceId: 'bnpl-gate-a', methods: ['klarna'] });
    const b = await readySession({ checkoutInstanceId: 'bnpl-gate-b', methods: ['klarna'] });
    await a.mount('klarna', document.createElement('div'));
    await b.mount('klarna', document.createElement('div'));

    const first = a.confirm();
    await expectAsync(b.confirm()).toBeRejectedWith(
      jasmine.objectContaining({ code: 'PROVIDER_UNAVAILABLE' }),
    );

    releaseFirst({ paymentIntent: { id: 'pi_a', status: 'succeeded' } });
    await first;
    expect(a.state()).toBe('success');
    await a.destroy();
    await b.destroy();
  });

  it('stamps ep_method on Klarna return_url without writing checkout/buttons ownership', async () => {
    confirmPayment.and.resolveTo({
      paymentIntent: { id: 'pi_klarna', status: 'succeeded' },
    });
    const session = await readySession({
      methods: ['klarna'],
      checkout: { successUrl: 'https://merchant.example/return' },
    });
    await session.mount('klarna', document.createElement('div'));
    await session.confirm();

    expect(confirmPayment).toHaveBeenCalled();
    const args = confirmPayment.calls.mostRecent().args[0] as {
      confirmParams?: { return_url?: string };
    };
    const returnUrl = args.confirmParams?.return_url ?? '';
    expect(returnUrl).toContain(`${STRIPE_RETURN_METHOD_PARAM}=klarna`);
    expect(returnUrl).toContain('ep_attempt=');
    expect(sessionStorage.getItem(STRIPE_PENDING_STORAGE_KEY)).toBeNull();
    await session.destroy();
  });

  it('does not treat AUTHENTICATION_REQUIRED as success (no false redirect success)', async () => {
    confirmPayment.and.resolveTo({
      paymentIntent: { id: 'pi_klarna', status: 'requires_action' },
    });
    const session = await readySession({ methods: ['klarna'] });
    await session.mount('klarna', document.createElement('div'));
    const pending = firstValueFrom(session.events.pending);
    await session.confirm();
    await expectAsync(pending).toBeResolvedTo(
      jasmine.objectContaining({ status: 'processing', method: 'klarna' }),
    );
    expect(session.state()).toBe('pending');
    expect(session.lastResult()?.status).toBe('processing');
    await session.destroy();
  });

  it('maps Affirm processing intents to pending', async () => {
    confirmPayment.and.resolveTo({
      paymentIntent: { id: 'pi_affirm', status: 'processing' },
    });
    const session = await readySession({ methods: ['affirm'] });
    await session.mount('affirm', document.createElement('div'));
    const pending = firstValueFrom(session.events.pending);
    await session.confirm();
    await expectAsync(pending).toBeResolvedTo(
      jasmine.objectContaining({ status: 'processing', method: 'affirm' }),
    );
    expect(session.state()).toBe('pending');
    await session.destroy();
  });

  it('emits cancel for Klarna cancellation', async () => {
    confirmPayment.and.resolveTo({
      paymentIntent: { id: 'pi_klarna', status: 'canceled' },
    });
    const session = await readySession({ methods: ['klarna'] });
    await session.mount('klarna', document.createElement('div'));
    const cancel = firstValueFrom(session.events.cancel);
    await session.confirm();
    await expectAsync(cancel).toBeResolvedTo(
      jasmine.objectContaining({ status: 'cancelled', method: 'klarna' }),
    );
    expect(session.state()).toBe('cancelled');
    await session.destroy();
  });

  it('emits error on Affirm confirmation failure', async () => {
    confirmPayment.and.resolveTo({
      error: { message: 'affirm declined', code: 'payment_intent_authentication_failure' },
    });
    const session = await readySession({ methods: ['affirm'] });
    await session.mount('affirm', document.createElement('div'));
    await expectAsync(session.confirm()).toBeRejected();
    expect(session.state()).toBe('error');
    expect(session.lastError()).toBeTruthy();
    await session.destroy();
  });

  it('destroys during Klarna mount without leaving a mounted element', async () => {
    let resolveCreate!: (value: {
      provider: 'klarna';
      clientSecret: string;
      paymentIntentId: string;
      sessionId: string;
    }) => void;
    backend.createKlarnaPayment.and.returnValue(
      new Promise((resolve) => {
        resolveCreate = resolve;
      }),
    );
    const session = await readySession({
      checkoutInstanceId: 'bnpl-destroy-mount',
      methods: ['klarna'],
    });
    const pending = session.mount('klarna', document.createElement('div'));
    await session.destroy();
    resolveCreate({
      provider: 'klarna',
      clientSecret: 'pi_klarna_secret',
      paymentIntentId: 'pi_klarna',
      sessionId: 'sess_klarna',
    });
    await expectAsync(pending).toBeRejectedWith(
      jasmine.objectContaining({ message: jasmine.stringMatching(/destroyed during mount/) }),
    );
    expect(klarna.hasMountedElement('bnpl-destroy-mount')).toBeFalse();
  });

  it('cleans up Klarna and Affirm resources on session destroy', async () => {
    const session = await readySession({ checkoutInstanceId: 'bnpl-cleanup' });
    await session.mount('klarna', document.createElement('div'));
    expect(klarna.hasMountedElement('bnpl-cleanup')).toBeTrue();
    await session.destroy();
    expect(klarna.hasMountedElement('bnpl-cleanup')).toBeFalse();
    expect(affirm.hasMountedElement('bnpl-cleanup')).toBeFalse();
    expect(registry.has('bnpl-cleanup')).toBeFalse();
  });
});
