import { TestBed } from '@angular/core/testing';
import { provideEasyPayments } from '../config/provide-easy-payments';
import { BackendService } from '../services/backend.service';
import { BrowserGuard } from '../utils/browser-guard';
import { FakeBrowserGuard, SAMPLE_PRODUCT } from '../testing/test-doubles';
import { StripeSdkLoader } from '../adapters/stripe/stripe-sdk.loader';
import { StripeCardAdapter } from '../adapters/stripe/stripe-card.adapter';
import { KlarnaAdapter } from '../adapters/klarna/klarna.adapter';
import { AffirmAdapter } from '../adapters/affirm/affirm.adapter';
import { StripeConfirmationGate } from '../adapters/stripe/stripe-confirmation-gate';
import { PaymentError } from '../errors/payment-error';
import { PaymentResult } from '../models';

interface FakeElement {
  mount: jasmine.Spy;
  unmount: jasmine.Spy;
  destroy: jasmine.Spy;
}

interface FakeElementsGroup {
  id: number;
  clientSecret: string;
  element: FakeElement | null;
  create: jasmine.Spy;
  submit: jasmine.Spy;
  update: jasmine.Spy;
}

interface PendingConfirm {
  elements: FakeElementsGroup;
  resolve: (status: string) => void;
}

function createFakeStripe() {
  let seq = 0;
  const groups: FakeElementsGroup[] = [];
  const pending: PendingConfirm[] = [];
  const state = { deferred: false, status: 'succeeded' };

  const stripe = {
    elements: jasmine.createSpy('elements').and.callFake((options: { clientSecret: string }) => {
      const group: FakeElementsGroup = {
        id: ++seq,
        clientSecret: options.clientSecret,
        element: null,
        create: jasmine.createSpy('create'),
        submit: jasmine.createSpy('submit').and.resolveTo({ error: undefined }),
        update: jasmine.createSpy('update'),
      };
      group.create.and.callFake(() => {
        group.element = {
          mount: jasmine.createSpy('mount'),
          unmount: jasmine.createSpy('unmount'),
          destroy: jasmine.createSpy('destroy'),
        };
        return group.element;
      });
      groups.push(group);
      return group;
    }),
    confirmPayment: jasmine
      .createSpy('confirmPayment')
      .and.callFake(({ elements }: { elements: FakeElementsGroup }) => {
        const settle = (status: string) => ({
          error: undefined,
          paymentIntent: { id: `pi_for_${elements.clientSecret}`, status },
        });
        if (state.deferred) {
          return new Promise((resolve) => {
            pending.push({ elements, resolve: (status) => resolve(settle(status)) });
          });
        }
        return Promise.resolve(settle(state.status));
      }),
  };

  return { stripe, groups, pending, state };
}

async function waitForPending(fake: { pending: unknown[] }, count: number): Promise<void> {
  for (let i = 0; i < 50 && fake.pending.length < count; i++) {
    await Promise.resolve();
  }
  expect(fake.pending.length).toBe(count);
}

describe('Multi-instance Stripe Payment Element isolation', () => {
  let fake: ReturnType<typeof createFakeStripe>;
  let backend: jasmine.SpyObj<BackendService>;
  let secretSeq: number;
  const host = () => document.createElement('div');

  beforeEach(() => {
    fake = createFakeStripe();
    secretSeq = 0;
    backend = jasmine.createSpyObj<BackendService>('BackendService', [
      'createStripePayment',
      'createKlarnaPayment',
      'createAffirmPayment',
    ]);
    const nextSession = () => {
      secretSeq += 1;
      return {
        clientSecret: `cs_${secretSeq}`,
        paymentIntentId: `pi_${secretSeq}`,
        sessionId: `sess_${secretSeq}`,
      };
    };
    backend.createStripePayment.and.callFake(async () => ({ provider: 'stripe', ...nextSession() }));
    backend.createKlarnaPayment.and.callFake(async () => nextSession() as never);
    backend.createAffirmPayment.and.callFake(async () => nextSession() as never);

    const sdkLoader = jasmine.createSpyObj<StripeSdkLoader>('StripeSdkLoader', ['load']);
    sdkLoader.load.and.resolveTo(fake.stripe as never);

    TestBed.configureTestingModule({
      providers: [
        provideEasyPayments({
          enableMockMode: false,
          providers: { stripe: { publishableKey: 'pk_test_123' } },
          backend: {
            createPaymentUrl: '/api/payments/create',
            klarnaCreatePaymentUrl: '/api/klarna/create',
            affirmCreatePaymentUrl: '/api/affirm/create',
          },
        }),
        { provide: BrowserGuard, useClass: FakeBrowserGuard },
        { provide: BackendService, useValue: backend },
        { provide: StripeSdkLoader, useValue: sdkLoader },
      ],
    });
  });

  type PeAdapter = {
    mountPaymentElement(
      container: HTMLElement,
      clientSecret: string,
      theme: 'light' | 'dark',
      locale?: string,
      ownerId?: string,
    ): Promise<void>;
    confirmPayment(returnUrl?: string, ownerId?: string): Promise<PaymentResult>;
    hasMountedElement(ownerId?: string): boolean;
    isConfirming(ownerId?: string): boolean;
    destroy(ownerId?: string): Promise<void>;
    initialize(): Promise<void>;
  };

  const cases: {
    name: string;
    inject: () => PeAdapter;
    createSession: (adapter: PeAdapter, ownerId: string) => Promise<{ clientSecret: string }>;
  }[] = [
    {
      name: 'Card',
      inject: () => TestBed.inject(StripeCardAdapter) as unknown as PeAdapter,
      createSession: (adapter, ownerId) =>
        (adapter as unknown as StripeCardAdapter).createPaymentSession(
          { ...SAMPLE_PRODUCT },
          undefined,
          ownerId,
        ),
    },
    {
      name: 'Klarna',
      inject: () => TestBed.inject(KlarnaAdapter) as unknown as PeAdapter,
      createSession: (adapter, ownerId) =>
        (adapter as unknown as KlarnaAdapter).createPaymentSession(
          { ...SAMPLE_PRODUCT },
          undefined,
          undefined,
          ownerId,
        ),
    },
    {
      name: 'Affirm',
      inject: () => TestBed.inject(AffirmAdapter) as unknown as PeAdapter,
      createSession: (adapter, ownerId) =>
        (adapter as unknown as AffirmAdapter).createPaymentSession(
          { ...SAMPLE_PRODUCT },
          undefined,
          undefined,
          ownerId,
        ),
    },
  ];

  async function mountOwner(adapter: PeAdapter, create: (typeof cases)[number]['createSession'], ownerId: string) {
    const session = await create(adapter, ownerId);
    await adapter.mountPaymentElement(host(), session.clientSecret, 'light', undefined, ownerId);
    return session.clientSecret;
  }

  for (const testCase of cases) {
    describe(testCase.name, () => {
      let adapter: PeAdapter;

      beforeEach(async () => {
        adapter = testCase.inject();
        await adapter.initialize();
      });

      it('Payment A confirms its own PaymentIntent even after Payment B mounted later', async () => {
        const secretA = await mountOwner(adapter, testCase.createSession, 'host-a');
        const secretB = await mountOwner(adapter, testCase.createSession, 'host-b');
        expect(secretA).not.toBe(secretB);

        await adapter.confirmPayment(undefined, 'host-a');

        const used = fake.stripe.confirmPayment.calls.mostRecent().args[0].elements as FakeElementsGroup;
        expect(used.clientSecret).toBe(secretA);
      });

      it('mounting host B does not unmount host A', async () => {
        await mountOwner(adapter, testCase.createSession, 'host-a');
        const groupA = fake.groups[0];
        await mountOwner(adapter, testCase.createSession, 'host-b');

        expect(groupA.element?.unmount).not.toHaveBeenCalled();
        expect(adapter.hasMountedElement('host-a')).toBeTrue();
        expect(adapter.hasMountedElement('host-b')).toBeTrue();
      });

      it('destroying host A leaves host B mounted and payable', async () => {
        await mountOwner(adapter, testCase.createSession, 'host-a');
        const secretB = await mountOwner(adapter, testCase.createSession, 'host-b');
        const groupB = fake.groups[1];

        await adapter.destroy('host-a');

        expect(adapter.hasMountedElement('host-a')).toBeFalse();
        expect(adapter.hasMountedElement('host-b')).toBeTrue();
        expect(groupB.element?.unmount).not.toHaveBeenCalled();
        const result = await adapter.confirmPayment(undefined, 'host-b');
        expect(result.status).toBe('success');
        const used = fake.stripe.confirmPayment.calls.mostRecent().args[0].elements as FakeElementsGroup;
        expect(used.clientSecret).toBe(secretB);
      });

      it('a host without a mounted element cannot confirm a sibling element', async () => {
        await mountOwner(adapter, testCase.createSession, 'host-a');
        await expectAsync(adapter.confirmPayment(undefined, 'host-b')).toBeRejectedWith(
          jasmine.objectContaining({ code: 'PROVIDER_UNAVAILABLE' }),
        );
        expect(fake.stripe.confirmPayment).not.toHaveBeenCalled();
      });

      it('rejects a concurrent confirm from another host before it reaches Stripe', async () => {
        await mountOwner(adapter, testCase.createSession, 'host-a');
        await mountOwner(adapter, testCase.createSession, 'host-b');
        fake.state.deferred = true;

        const first = adapter.confirmPayment(undefined, 'host-a');
        await waitForPending(fake, 1);

        let rejection: PaymentError | null = null;
        try {
          await adapter.confirmPayment(undefined, 'host-b');
        } catch (error) {
          rejection = error as PaymentError;
        }
        expect(rejection?.code).toBe('PROVIDER_UNAVAILABLE');
        expect(fake.stripe.confirmPayment).toHaveBeenCalledTimes(1);
        expect(adapter.isConfirming('host-a')).toBeTrue();
        expect(adapter.isConfirming('host-b')).toBeFalse();

        fake.pending[0].resolve('succeeded');
        expect((await first).status).toBe('success');

        fake.state.deferred = false;
        const second = await adapter.confirmPayment(undefined, 'host-b');
        expect(second.status).toBe('success');
        expect(TestBed.inject(StripeConfirmationGate).isHeld()).toBeFalse();
      });

      it('rejects a duplicate confirm from the same host (no double submit)', async () => {
        await mountOwner(adapter, testCase.createSession, 'host-a');
        fake.state.deferred = true;
        const first = adapter.confirmPayment(undefined, 'host-a');
        await expectAsync(adapter.confirmPayment(undefined, 'host-a')).toBeRejectedWith(
          jasmine.objectContaining({ code: 'PAYMENT_FAILED' }),
        );
        await waitForPending(fake, 1);
        fake.pending[0].resolve('succeeded');
        await first;
        expect(fake.stripe.confirmPayment).toHaveBeenCalledTimes(1);
      });

      it('never reports a processing PaymentIntent as success', async () => {
        await mountOwner(adapter, testCase.createSession, 'host-a');
        fake.state.status = 'processing';
        await expectAsync(adapter.confirmPayment(undefined, 'host-a')).toBeRejectedWith(
          jasmine.objectContaining({ code: 'PAYMENT_FAILED' }),
        );
        expect(TestBed.inject(StripeConfirmationGate).isHeld()).toBeFalse();
      });

      it('ten owners keep ten independent sessions and destroy releases each one', async () => {
        const secrets: string[] = [];
        for (let i = 0; i < 10; i++) {
          secrets.push(await mountOwner(adapter, testCase.createSession, `host-${i}`));
        }
        expect(new Set(secrets).size).toBe(10);

        for (let i = 9; i >= 0; i--) {
          await adapter.confirmPayment(undefined, `host-${i}`);
          const used = fake.stripe.confirmPayment.calls.mostRecent().args[0]
            .elements as FakeElementsGroup;
          expect(used.clientSecret).toBe(secrets[i]);
        }

        for (let i = 0; i < 10; i++) {
          await adapter.destroy(`host-${i}`);
        }
        const store = (adapter as unknown as { sessions: { size(): number } }).sessions;
        expect(store.size()).toBe(0);
        for (const group of fake.groups) {
          expect(group.element?.unmount).toHaveBeenCalledTimes(1);
        }
      });

      it('legacy calls without ownerId keep the single-host behaviour', async () => {
        const session = await testCase.createSession(adapter, undefined as unknown as string);
        await adapter.mountPaymentElement(host(), session.clientSecret, 'light');
        expect(adapter.hasMountedElement()).toBeTrue();
        const result = await adapter.confirmPayment();
        expect(result.status).toBe('success');
        await adapter.destroy();
        expect(adapter.hasMountedElement()).toBeFalse();
      });
    });
  }

  it('the page gate serializes confirmations across Card and Klarna hosts', async () => {
    const card = TestBed.inject(StripeCardAdapter);
    const klarna = TestBed.inject(KlarnaAdapter);
    await card.initialize();
    await klarna.initialize();
    const cardSession = await card.createPaymentSession({ ...SAMPLE_PRODUCT }, undefined, 'card-1');
    await card.mountPaymentElement(host(), cardSession.clientSecret, 'light', undefined, 'card-1');
    const klarnaSession = await klarna.createPaymentSession(
      { ...SAMPLE_PRODUCT },
      undefined,
      undefined,
      'klarna-1',
    );
    await klarna.mountPaymentElement(host(), klarnaSession.clientSecret, 'light', undefined, 'klarna-1');

    fake.state.deferred = true;
    const cardPending = card.confirmPayment(undefined, 'card-1');
    await expectAsync(klarna.confirmPayment(undefined, 'klarna-1')).toBeRejectedWith(
      jasmine.objectContaining({ code: 'PROVIDER_UNAVAILABLE', method: 'klarna' }),
    );
    await waitForPending(fake, 1);
    fake.pending[0].resolve('succeeded');
    await cardPending;
    expect(fake.stripe.confirmPayment).toHaveBeenCalledTimes(1);
  });
});
