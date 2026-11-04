import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideEasyPayments } from '../config/provide-easy-payments';
import { BrowserGuard } from '../utils/browser-guard';
import { FakeBrowserGuard, SAMPLE_PRODUCT } from '../testing/test-doubles';
import { EasyPaymentsComponent } from '../components/payments/easy-payments.component';
import { EasyPaymentButtonsComponent } from '../components/payment-buttons/easy-payment-buttons.component';
import {
  decideStripeReturnOwner,
  StripeRedirectRecoveryService,
  type StripeReturnCandidate,
  type StripeReturnHost,
} from '../adapters/stripe/stripe-redirect-recovery.service';
import {
  clearStripePendingReturn,
  clearStripePendingReturnFor,
  isStripePendingReturnExpired,
  markHeadlessPendingReturn,
  markStripePendingReturn,
  readStripePendingReturn,
  readStripeReturnParams,
  STRIPE_PENDING_TTL_MS,
  type StripeReturnHostKind,
} from '../adapters/stripe/stripe-redirect-return';
import { CheckoutHostContext } from '../services/checkout-host-context';
import { PaymentError } from '../errors/payment-error';
import { PaymentMethod, PaymentResult } from '../models';

const ATTEMPT = 'a1b2c3d4e5f60718';
const OTHER_ATTEMPT = 'ffffeeee00001111';
const METHODS: PaymentMethod[] = ['klarna', 'affirm', 'card'];

interface HostHandle {
  kind: StripeReturnHostKind;
  fixture: ComponentFixture<EasyPaymentButtonsComponent | EasyPaymentsComponent>;
  successes: PaymentResult[];
  errors: PaymentError[];
  cancels: PaymentResult[];
  started: unknown[];
  destroyed: boolean;
}

function createHost(
  kind: StripeReturnHostKind,
  productId: string = SAMPLE_PRODUCT.id,
  methods: PaymentMethod[] = METHODS,
  checkoutInstanceId?: string,
): HostHandle {
  const fixture =
    kind === 'buttons'
      ? TestBed.createComponent(EasyPaymentButtonsComponent)
      : TestBed.createComponent(EasyPaymentsComponent);
  fixture.componentRef.setInput('product', { ...SAMPLE_PRODUCT, id: productId });
  fixture.componentRef.setInput('methods', methods);
  if (checkoutInstanceId) {
    fixture.componentRef.setInput('checkoutInstanceId', checkoutInstanceId);
  }
  const handle: HostHandle = {
    kind,
    fixture,
    successes: [],
    errors: [],
    cancels: [],
    started: [],
    destroyed: false,
  };
  const component = fixture.componentInstance;
  component.success.subscribe((r: PaymentResult) => handle.successes.push(r));
  component.error.subscribe((e: PaymentError) => handle.errors.push(e));
  component.cancel.subscribe((r: PaymentResult) => handle.cancels.push(r));
  component.started.subscribe((s: unknown) => handle.started.push(s));
  return handle;
}

function destroyHost(host: HostHandle): void {
  host.fixture.destroy();
  host.destroyed = true;
}

/** Renders all hosts in one pass (like one app tick), then waits for claims and recovery. */
async function settle(hosts: HostHandle[]): Promise<void> {
  const live = hosts.filter((h) => !h.destroyed);
  live.forEach((h) => h.fixture.detectChanges());
  for (const h of live) {
    await h.fixture.whenStable();
  }
  await Promise.resolve();
  await Promise.resolve();
  live.forEach((h) => h.fixture.detectChanges());
}

function totalEvents(host: HostHandle): number {
  return host.successes.length + host.errors.length + host.cancels.length + host.started.length;
}

function setReturnUrl(params: Record<string, string>): void {
  history.replaceState({}, '', `/?${new URLSearchParams(params).toString()}`);
}

function returnUrl(extra: Record<string, string> = {}): Record<string, string> {
  return {
    payment_intent: 'pi_ret',
    payment_intent_client_secret: 'pi_ret_secret_x',
    ep_method: 'klarna',
    ...extra,
  };
}

function markOrigin(
  hostKind: StripeReturnHostKind,
  hostOrdinal: number,
  productId: string = SAMPLE_PRODUCT.id,
  checkoutInstanceId?: string,
) {
  markStripePendingReturn('klarna', productId, undefined, {
    attemptId: ATTEMPT,
    hostKind,
    hostOrdinal,
    ...(checkoutInstanceId ? { checkoutInstanceId } : {}),
  });
}

function successResult(): PaymentResult {
  return { status: 'success', method: 'klarna', provider: 'klarna', transactionId: 'pi_ret' };
}

describe('Stripe redirect return ownership', () => {
  describe('decideStripeReturnOwner (pure rule)', () => {
    const candidate = (
      host: string,
      kind: StripeReturnHostKind,
      ordinal: number,
      productId = 'p',
      methods: PaymentMethod[] = ['klarna'],
      instanceId = host,
    ): StripeReturnCandidate<string> => ({ host, kind, productId, ordinal, methods, instanceId });
    const params = (attemptId: string | null, method: 'klarna' | null = 'klarna') => ({
      paymentIntentId: 'pi',
      clientSecret: 'cs',
      redirectStatus: null,
      method,
      attemptId,
    });
    const marker = (extra: object = {}) => ({
      method: 'klarna' as const,
      productId: 'p',
      at: Date.now(),
      ...extra,
    });

    it('fails closed without a method', () => {
      expect(decideStripeReturnOwner([candidate('a', 'buttons', 0)], params(null, null), null)).toEqual({
        kind: 'unattributed',
        reason: 'MISSING_METHOD',
      });
    });

    it('rejects a stale attempt that does not match the pending marker', () => {
      expect(
        decideStripeReturnOwner(
          [candidate('a', 'buttons', 0)],
          params(OTHER_ATTEMPT),
          marker({ attemptId: ATTEMPT, hostKind: 'buttons', hostOrdinal: 0 }),
        ),
      ).toEqual({ kind: 'unattributed', reason: 'STALE_ATTEMPT' });
    });

    it('attributes by stable checkoutInstanceId even when ordinals differ', () => {
      const candidates = [
        candidate('first', 'buttons', 0, 'p', ['klarna'], 'slot-b'),
        candidate('second', 'buttons', 1, 'p', ['klarna'], 'slot-a'),
      ];
      const m = marker({
        attemptId: ATTEMPT,
        hostKind: 'buttons',
        hostOrdinal: 0,
        checkoutInstanceId: 'slot-a',
      });
      expect(decideStripeReturnOwner(candidates, params(ATTEMPT), m)).toEqual({
        kind: 'owner',
        owner: 'second',
      });
    });

    it('waits when the stable checkoutInstanceId is not mounted yet', () => {
      const m = marker({
        attemptId: ATTEMPT,
        hostKind: 'buttons',
        checkoutInstanceId: 'slot-late',
      });
      expect(
        decideStripeReturnOwner(
          [candidate('early', 'buttons', 0, 'p', ['klarna'], 'slot-other')],
          params(ATTEMPT),
          m,
        ),
      ).toEqual({ kind: 'wait' });
    });

    it('attributes to the exact host kind, product and ordinal (legacy markers)', () => {
      const candidates = [
        candidate('b0', 'buttons', 0),
        candidate('c0', 'checkout', 0),
        candidate('b1', 'buttons', 1),
      ];
      const m = marker({ attemptId: ATTEMPT, hostKind: 'buttons', hostOrdinal: 1 });
      expect(decideStripeReturnOwner(candidates, params(ATTEMPT), m)).toEqual({ kind: 'owner', owner: 'b1' });
    });

    it('waits when the originating host is not mounted (legacy ordinal)', () => {
      const m = marker({ attemptId: ATTEMPT, hostKind: 'checkout', hostOrdinal: 3 });
      expect(decideStripeReturnOwner([candidate('c0', 'checkout', 0)], params(ATTEMPT), m)).toEqual({
        kind: 'wait',
      });
    });

    it('never guesses between several legacy-eligible hosts', () => {
      const candidates = [candidate('a', 'buttons', 0), candidate('b', 'checkout', 0)];
      expect(decideStripeReturnOwner(candidates, params(null), null)).toEqual({
        kind: 'unattributed',
        reason: 'AMBIGUOUS_HOSTS',
      });
    });

    it('keeps legacy single-host recovery and ignores hosts without the method', () => {
      const candidates = [
        candidate('a', 'buttons', 0, 'p', ['card']),
        candidate('b', 'checkout', 0, 'p', ['klarna']),
      ];
      expect(decideStripeReturnOwner(candidates, params(null), null)).toEqual({ kind: 'owner', owner: 'b' });
    });

    it('narrows legacy markers by productId', () => {
      const candidates = [candidate('a', 'buttons', 0, 'p'), candidate('b', 'buttons', 0, 'q')];
      expect(decideStripeReturnOwner(candidates, params(null), marker())).toEqual({
        kind: 'owner',
        owner: 'a',
      });
    });

    it('fails closed when ep_attempt is present without a matching live marker (no legacy single-host claim)', () => {
      expect(
        decideStripeReturnOwner(
          [candidate('c0', 'checkout', 0), candidate('b0', 'buttons', 0)],
          params(ATTEMPT),
          null,
        ),
      ).toEqual({ kind: 'unattributed', reason: 'STALE_ATTEMPT' });
    });

    it('does not let checkout claim a Headless marker (waits for Headless owner)', () => {
      const m = marker({
        attemptId: ATTEMPT,
        hostKind: 'headless',
        checkoutInstanceId: 'hl-a',
      });
      expect(
        decideStripeReturnOwner(
          [candidate('c0', 'checkout', 0, 'p', ['klarna'], 'hl-a')],
          params(ATTEMPT),
          m,
        ),
      ).toEqual({ kind: 'wait' });
    });

    it('does not let buttons claim a Headless marker (waits for Headless owner)', () => {
      const m = marker({
        attemptId: ATTEMPT,
        hostKind: 'headless',
        checkoutInstanceId: 'hl-a',
      });
      expect(
        decideStripeReturnOwner(
          [candidate('b0', 'buttons', 0, 'p', ['klarna'], 'hl-a')],
          params(ATTEMPT),
          m,
        ),
      ).toEqual({ kind: 'wait' });
    });

    it('does not let Headless claim a checkout marker', () => {
      const m = marker({
        attemptId: ATTEMPT,
        hostKind: 'checkout',
        checkoutInstanceId: 'co-a',
      });
      expect(
        decideStripeReturnOwner(
          [candidate('h0', 'headless', 0, 'p', ['klarna'], 'co-a')],
          params(ATTEMPT),
          m,
        ),
      ).toEqual({ kind: 'wait' });
    });

    it('does not let Headless claim a buttons marker', () => {
      const m = marker({
        attemptId: ATTEMPT,
        hostKind: 'buttons',
        checkoutInstanceId: 'btn-a',
      });
      expect(
        decideStripeReturnOwner(
          [candidate('h0', 'headless', 0, 'p', ['klarna'], 'btn-a')],
          params(ATTEMPT),
          m,
        ),
      ).toEqual({ kind: 'wait' });
    });

    it('attributes matching Headless attempt + instance', () => {
      const m = marker({
        attemptId: ATTEMPT,
        hostKind: 'headless',
        checkoutInstanceId: 'hl-a',
      });
      expect(
        decideStripeReturnOwner(
          [
            candidate('h-a', 'headless', 0, 'p', ['klarna'], 'hl-a'),
            candidate('h-b', 'headless', 1, 'p', ['klarna'], 'hl-b'),
          ],
          params(ATTEMPT),
          m,
        ),
      ).toEqual({ kind: 'owner', owner: 'h-a' });
    });

    it('rejects Headless session B claiming session A marker', () => {
      const m = marker({
        attemptId: ATTEMPT,
        hostKind: 'headless',
        checkoutInstanceId: 'hl-a',
      });
      expect(
        decideStripeReturnOwner(
          [candidate('h-b', 'headless', 0, 'p', ['klarna'], 'hl-b')],
          params(ATTEMPT),
          m,
        ),
      ).toEqual({ kind: 'wait' });
    });

    it('rejects wrong Headless attempt id', () => {
      const m = marker({
        attemptId: ATTEMPT,
        hostKind: 'headless',
        checkoutInstanceId: 'hl-a',
      });
      expect(
        decideStripeReturnOwner(
          [candidate('h-a', 'headless', 0, 'p', ['klarna'], 'hl-a')],
          params(OTHER_ATTEMPT),
          m,
        ),
      ).toEqual({ kind: 'unattributed', reason: 'STALE_ATTEMPT' });
    });

    it('rejects wrong payment method on Headless marker', () => {
      const m = marker({
        method: 'affirm',
        attemptId: ATTEMPT,
        hostKind: 'headless',
        checkoutInstanceId: 'hl-a',
      });
      expect(
        decideStripeReturnOwner(
          [candidate('h-a', 'headless', 0, 'p', ['klarna', 'affirm'], 'hl-a')],
          params(ATTEMPT, 'klarna'),
          m,
        ),
      ).toEqual({ kind: 'unattributed', reason: 'STALE_ATTEMPT' });
    });

    it('rejects expired Headless markers (fail closed)', () => {
      const m = marker({
        attemptId: ATTEMPT,
        hostKind: 'headless',
        checkoutInstanceId: 'hl-a',
        at: Date.now() - STRIPE_PENDING_TTL_MS - 1,
      });
      expect(
        decideStripeReturnOwner(
          [candidate('h-a', 'headless', 0, 'p', ['klarna'], 'hl-a')],
          params(ATTEMPT),
          m,
        ),
      ).toEqual({ kind: 'unattributed', reason: 'STALE_ATTEMPT' });
    });

    it('rejects Headless markers with missing timestamp', () => {
      const m = marker({
        attemptId: ATTEMPT,
        hostKind: 'headless',
        checkoutInstanceId: 'hl-a',
        at: undefined as unknown as number,
      });
      expect(
        decideStripeReturnOwner(
          [candidate('h-a', 'headless', 0, 'p', ['klarna'], 'hl-a')],
          params(ATTEMPT),
          m,
        ),
      ).toEqual({ kind: 'unattributed', reason: 'STALE_ATTEMPT' });
    });

    it('legacy single-host fallback never claims when only Headless candidates exist with ep_attempt', () => {
      expect(
        decideStripeReturnOwner(
          [candidate('h0', 'headless', 0)],
          params(ATTEMPT),
          null,
        ),
      ).toEqual({ kind: 'unattributed', reason: 'STALE_ATTEMPT' });
    });
  });

  describe('Headless pending marker storage (H4.2)', () => {
    afterEach(() => {
      clearStripePendingReturn();
    });

    it('writes hostKind headless with attempt, instance, method, product, and timestamp', () => {
      markHeadlessPendingReturn('klarna', 'premium', {
        attemptId: ATTEMPT,
        checkoutInstanceId: 'hl-a',
      });
      const pending = readStripePendingReturn();
      expect(pending).toEqual(
        jasmine.objectContaining({
          method: 'klarna',
          productId: 'premium',
          attemptId: ATTEMPT,
          hostKind: 'headless',
          checkoutInstanceId: 'hl-a',
        }),
      );
      expect(typeof pending?.at).toBe('number');
      expect(isStripePendingReturnExpired(pending!)).toBeFalse();
    });

    it('refuses to overwrite a different unresolved Headless session marker', () => {
      markHeadlessPendingReturn('klarna', 'premium', {
        attemptId: ATTEMPT,
        checkoutInstanceId: 'hl-a',
      });
      expect(() =>
        markHeadlessPendingReturn('klarna', 'premium', {
          attemptId: OTHER_ATTEMPT,
          checkoutInstanceId: 'hl-b',
        }),
      ).toThrowMatching((e) => e instanceof PaymentError && e.code === 'PAYMENT_FAILED');
      expect(readStripePendingReturn()?.checkoutInstanceId).toBe('hl-a');
    });

    it('allows the same Headless instance to replace its own attempt', () => {
      markHeadlessPendingReturn('klarna', 'premium', {
        attemptId: ATTEMPT,
        checkoutInstanceId: 'hl-a',
      });
      markHeadlessPendingReturn('affirm', 'premium', {
        attemptId: OTHER_ATTEMPT,
        checkoutInstanceId: 'hl-a',
      });
      expect(readStripePendingReturn()).toEqual(
        jasmine.objectContaining({
          method: 'affirm',
          attemptId: OTHER_ATTEMPT,
          checkoutInstanceId: 'hl-a',
          hostKind: 'headless',
        }),
      );
    });

    it('refuses to overwrite an unresolved checkout/buttons marker', () => {
      markStripePendingReturn('klarna', 'premium', undefined, {
        attemptId: ATTEMPT,
        hostKind: 'buttons',
        checkoutInstanceId: 'btn-a',
      });
      expect(() =>
        markHeadlessPendingReturn('klarna', 'premium', {
          attemptId: OTHER_ATTEMPT,
          checkoutInstanceId: 'hl-a',
        }),
      ).toThrowMatching((e) => e instanceof PaymentError && e.code === 'PAYMENT_FAILED');
    });

    it('treats corrupted JSON as missing (no ownership)', () => {
      sessionStorage.setItem('ep.stripe.redirect.pending', '{not-json');
      expect(readStripePendingReturn()).toBeNull();
    });

    it('treats expired stored markers as missing and clears them', () => {
      sessionStorage.setItem(
        'ep.stripe.redirect.pending',
        JSON.stringify({
          method: 'klarna',
          productId: 'p',
          attemptId: ATTEMPT,
          hostKind: 'headless',
          checkoutInstanceId: 'hl-a',
          at: Date.now() - STRIPE_PENDING_TTL_MS - 5_000,
        }),
      );
      expect(readStripePendingReturn()).toBeNull();
      expect(sessionStorage.getItem('ep.stripe.redirect.pending')).toBeNull();
    });

    it('clearStripePendingReturnFor only clears the matching attempt', () => {
      markHeadlessPendingReturn('klarna', 'premium', {
        attemptId: ATTEMPT,
        checkoutInstanceId: 'hl-a',
      });
      clearStripePendingReturnFor(OTHER_ATTEMPT);
      expect(readStripePendingReturn()?.attemptId).toBe(ATTEMPT);
      clearStripePendingReturnFor(ATTEMPT);
      expect(readStripePendingReturn()).toBeNull();
    });

    it('surfaces storage access failure when sessionStorage is unavailable', () => {
      const broken = {
        getItem: () => {
          throw new Error('denied');
        },
        setItem: () => {
          throw new Error('denied');
        },
        removeItem: () => undefined,
        clear: () => undefined,
        key: () => null,
        length: 0,
      } as Storage;
      expect(() =>
        markHeadlessPendingReturn(
          'klarna',
          'premium',
          { attemptId: ATTEMPT, checkoutInstanceId: 'hl-a' },
          broken,
        ),
      ).toThrowMatching((e) => e instanceof PaymentError && e.code === 'PROVIDER_UNAVAILABLE');
    });
  });

  describe('service ownership hand-off', () => {
    afterEach(() => {
      history.replaceState({}, '', '/');
      clearStripePendingReturn();
      TestBed.inject(StripeRedirectRecoveryService).resetForTests();
    });

    it('hands an unconsumed return to a remounted host when the owner is destroyed first', async () => {
      TestBed.configureTestingModule({
        providers: [
          provideEasyPayments({ enableMockMode: true, providers: {} }),
          { provide: BrowserGuard, useValue: new FakeBrowserGuard() },
        ],
      });
      setReturnUrl(returnUrl({ ep_attempt: ATTEMPT }));
      markStripePendingReturn('klarna', SAMPLE_PRODUCT.id, undefined, {
        attemptId: ATTEMPT,
        hostKind: 'buttons',
        checkoutInstanceId: 'stable-a',
      });
      const service = TestBed.inject(StripeRedirectRecoveryService);
      const hostA: StripeReturnHost = {
        kind: 'buttons',
        productId: () => SAMPLE_PRODUCT.id,
        instanceId: () => 'stable-a',
      };
      service.registerHost(hostA);
      expect(await service.claimReturn(hostA, ['klarna'])).toBe('owner');

      service.unregisterHost(hostA);
      const hostB: StripeReturnHost = {
        kind: 'buttons',
        productId: () => SAMPLE_PRODUCT.id,
        instanceId: () => 'stable-a',
      };
      service.registerHost(hostB);
      expect(await service.claimReturn(hostB, ['klarna'])).toBe('owner');
    });
  });

  describe('component hosts (mock mode, retrieve stubbed)', () => {
    let retrieve: jasmine.Spy;
    let warn: jasmine.Spy;

    beforeEach(async () => {
      await TestBed.configureTestingModule({
        imports: [EasyPaymentButtonsComponent, EasyPaymentsComponent],
        providers: [
          provideEasyPayments({ enableMockMode: true, providers: {} }),
          { provide: BrowserGuard, useValue: new FakeBrowserGuard() },
        ],
      }).compileComponents();
      const recovery = TestBed.inject(StripeRedirectRecoveryService);
      recovery.resetForTests();
      retrieve = spyOn(recovery, 'retrieveReturningPayment');
      retrieve.and.resolveTo(successResult());
      warn = spyOn(console, 'warn');
    });

    afterEach(() => {
      history.replaceState({}, '', '/');
      clearStripePendingReturn();
      TestBed.inject(StripeRedirectRecoveryService).resetForTests();
    });

    function warned(code: string): boolean {
      return warn.calls.allArgs().some((args) => String(args[0]).includes(code));
    }

    it('one buttons host with an attempt marker recovers once and clears URL + marker', async () => {
      setReturnUrl(returnUrl({ ep_attempt: ATTEMPT }));
      markOrigin('buttons', 0);
      const host = createHost('buttons');
      await settle([host]);

      expect(host.successes.length).toBe(1);
      expect(host.started.length).toBe(0);
      expect(retrieve).toHaveBeenCalledTimes(1);
      expect(readStripeReturnParams().attemptId).toBeNull();
      expect(readStripePendingReturn()).toBeNull();
    });

    it('two buttons hosts: only the originating host recovers; the sibling reverts silently', async () => {
      setReturnUrl(returnUrl({ ep_attempt: ATTEMPT }));
      markOrigin('buttons', 1);
      const hosts = [createHost('buttons'), createHost('buttons')];
      await settle(hosts);

      expect(hosts[1].successes.length).toBe(1);
      expect(totalEvents(hosts[0])).toBe(0);
      const sibling = hosts[0].fixture.componentInstance as EasyPaymentButtonsComponent;
      expect(sibling.selectedMethod()).toBeNull();
      expect(sibling.providerBusy()).toBeFalse();
      expect(retrieve).toHaveBeenCalledTimes(1);
    });

    it('ten buttons hosts: exactly the originating host (#7) recovers', async () => {
      setReturnUrl(returnUrl({ ep_attempt: ATTEMPT }));
      markOrigin('buttons', 6);
      const hosts = Array.from({ length: 10 }, () => createHost('buttons'));
      await settle(hosts);

      hosts.forEach((h, i) => {
        expect(h.successes.length).withContext(`host ${i}`).toBe(i === 6 ? 1 : 0);
        expect(h.errors.length).withContext(`host ${i}`).toBe(0);
        expect(h.started.length).withContext(`host ${i}`).toBe(0);
      });
      expect(retrieve).toHaveBeenCalledTimes(1);
    });

    it('ten hosts with different products: ownership follows the marker product', async () => {
      setReturnUrl(returnUrl({ ep_attempt: ATTEMPT }));
      markOrigin('buttons', 0, 'product-4');
      const hosts = Array.from({ length: 10 }, (_, i) => createHost('buttons', `product-${i}`));
      await settle(hosts);

      hosts.forEach((h, i) => expect(h.successes.length).withContext(`host ${i}`).toBe(i === 4 ? 1 : 0));
    });

    for (const order of ['interleaved', 'buttons-first', 'checkouts-first'] as const) {
      it(`5 checkouts + 5 buttons (${order}): only checkout #4 recovers`, async () => {
        setReturnUrl(returnUrl({ ep_attempt: ATTEMPT }));
        markOrigin('checkout', 3);
        const kinds: StripeReturnHostKind[] =
          order === 'interleaved'
            ? Array.from({ length: 10 }, (_, i) => (i % 2 ? 'buttons' : 'checkout'))
            : order === 'buttons-first'
              ? [...Array(5).fill('buttons'), ...Array(5).fill('checkout')]
              : [...Array(5).fill('checkout'), ...Array(5).fill('buttons')];
        const hosts = kinds.map((kind) => createHost(kind));
        await settle(hosts);

        const checkouts = hosts.filter((h) => h.kind === 'checkout');
        hosts.forEach((h) => {
          const isOwner = h === checkouts[3];
          expect(h.successes.length).toBe(isOwner ? 1 : 0);
          expect(h.errors.length + h.cancels.length + h.started.length).toBe(0);
        });
        checkouts.forEach((h) => {
          const view = (h.fixture.componentInstance as EasyPaymentsComponent).viewState();
          expect(view).toBe(h === checkouts[3] ? 'success' : 'checkout');
          const phase = h.fixture.debugElement.injector.get(CheckoutHostContext).returnPhaseFor('klarna');
          expect(phase).toBe(h === checkouts[3] ? 'owner' : 'none');
        });
        expect(retrieve).toHaveBeenCalledTimes(1);
      });
    }

    it('legacy return (no ep_attempt) with a single host keeps 1.1 behavior', async () => {
      setReturnUrl(returnUrl());
      const host = createHost('checkout');
      await settle([host]);
      expect(host.successes.length).toBe(1);
    });

    it('legacy return with several eligible hosts is not guessed: no events, URL cleared, diagnostic', async () => {
      setReturnUrl(returnUrl());
      const hosts = [createHost('checkout'), createHost('buttons')];
      await settle(hosts);

      hosts.forEach((h) => expect(totalEvents(h)).toBe(0));
      expect(retrieve).not.toHaveBeenCalled();
      expect(readStripeReturnParams().method).toBeNull();
      expect(warned('AMBIGUOUS_HOSTS')).toBeTrue();
      expect((hosts[0].fixture.componentInstance as EasyPaymentsComponent).viewState()).toBe('checkout');
    });

    it('stale attempt is rejected without events and keeps the newer pending marker', async () => {
      setReturnUrl(returnUrl({ ep_attempt: OTHER_ATTEMPT }));
      markOrigin('buttons', 0);
      const host = createHost('buttons');
      await settle([host]);

      expect(totalEvents(host)).toBe(0);
      expect(retrieve).not.toHaveBeenCalled();
      expect(warned('STALE_ATTEMPT')).toBeTrue();
      expect(readStripePendingReturn()?.attemptId).toBe(ATTEMPT);
      expect(readStripeReturnParams().attemptId).toBeNull();
    });

    it('origin host not mounted yet: waits, then the late host recovers', async () => {
      setReturnUrl(returnUrl({ ep_attempt: ATTEMPT }));
      markOrigin('buttons', 2);
      const hosts = [createHost('buttons'), createHost('buttons')];
      await settle(hosts);

      hosts.forEach((h) => expect(totalEvents(h)).toBe(0));
      expect(warned('STRIPE_RETURN_OWNER_NOT_MOUNTED')).toBeTrue();
      expect(readStripeReturnParams().attemptId).toBe(ATTEMPT);

      const late = createHost('buttons');
      await settle([late]);
      expect(late.successes.length).toBe(1);
      hosts.forEach((h) => expect(totalEvents(h)).toBe(0));
      expect(retrieve).toHaveBeenCalledTimes(1);
    });

    it('origin host destroyed before the claim: no sibling steals the return; a remount recovers', async () => {
      setReturnUrl(returnUrl({ ep_attempt: ATTEMPT }));
      markOrigin('buttons', 2);
      const hosts = [createHost('buttons'), createHost('buttons'), createHost('buttons')];
      destroyHost(hosts[2]);
      await settle(hosts);

      hosts.forEach((h) => expect(totalEvents(h)).toBe(0));
      expect(retrieve).not.toHaveBeenCalled();

      const remount = createHost('buttons');
      await settle([remount]);
      expect(remount.successes.length).toBe(1);
    });

    it('reload after a handled return does not recover or emit again', async () => {
      setReturnUrl(returnUrl({ ep_attempt: ATTEMPT }));
      markOrigin('buttons', 0);
      const first = createHost('buttons');
      await settle([first]);
      expect(first.successes.length).toBe(1);

      destroyHost(first);
      const again = createHost('buttons');
      await settle([again]);
      expect(totalEvents(again)).toBe(0);
      expect(retrieve).toHaveBeenCalledTimes(1);
    });

    it('failed redirect status is an error on the owner only (never success)', async () => {
      setReturnUrl(returnUrl({ ep_attempt: ATTEMPT, redirect_status: 'failed' }));
      markOrigin('buttons', 1);
      const hosts = [createHost('buttons'), createHost('buttons')];
      await settle(hosts);

      expect(hosts[1].errors.length).toBe(1);
      expect(hosts[1].successes.length).toBe(0);
      expect(totalEvents(hosts[0])).toBe(0);
      expect(retrieve).not.toHaveBeenCalled();
    });

    it('cancelled return emits cancel on the owner only', async () => {
      retrieve.and.resolveTo({ status: 'cancelled', method: 'klarna', provider: 'klarna' });
      setReturnUrl(returnUrl({ ep_attempt: ATTEMPT }));
      markOrigin('checkout', 0);
      const hosts = [createHost('checkout'), createHost('buttons')];
      await settle(hosts);

      expect(hosts[0].cancels.length).toBe(1);
      expect(hosts[0].successes.length).toBe(0);
      expect(totalEvents(hosts[1])).toBe(0);
    });

    it('still-processing return emits pending (never success or failed error)', async () => {
      retrieve.and.resolveTo({
        status: 'processing',
        method: 'klarna',
        provider: 'klarna',
        message: 'Klarna payment is still processing.',
      });
      setReturnUrl(returnUrl({ ep_attempt: ATTEMPT }));
      markOrigin('buttons', 0);
      const hosts = [createHost('buttons'), createHost('checkout')];
      const pending: PaymentResult[] = [];
      (hosts[0].fixture.componentInstance as EasyPaymentButtonsComponent).pending.subscribe((r) =>
        pending.push(r),
      );
      await settle(hosts);

      expect(pending.length).toBe(1);
      expect(pending[0].status).toBe('processing');
      expect(hosts[0].successes.length).toBe(0);
      expect(hosts[0].errors.length).toBe(0);
      expect(totalEvents(hosts[1])).toBe(0);
    });

    it('malformed ep_attempt is ignored (treated as a legacy return)', async () => {
      setReturnUrl(returnUrl({ ep_attempt: '../<script>' }));
      const host = createHost('buttons');
      await settle([host]);
      expect(host.successes.length).toBe(1);
    });

    it('unknown ep_method without Stripe params is not a return', async () => {
      setReturnUrl({ ep_method: 'bogus' });
      const host = createHost('buttons');
      await settle([host]);
      expect(totalEvents(host)).toBe(0);
      expect((host.fixture.componentInstance as EasyPaymentButtonsComponent).selectedMethod()).toBeNull();
      expect(retrieve).not.toHaveBeenCalled();
    });

    it('a host destroyed while its recovery is in flight emits nothing', async () => {
      let resolveRetrieve!: (r: PaymentResult) => void;
      retrieve.and.returnValue(new Promise<PaymentResult>((resolve) => (resolveRetrieve = resolve)));
      setReturnUrl(returnUrl({ ep_attempt: ATTEMPT }));
      markOrigin('buttons', 0);
      const host = createHost('buttons');
      host.fixture.detectChanges();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      expect(retrieve).toHaveBeenCalledTimes(1);

      destroyHost(host);
      resolveRetrieve(successResult());
      await new Promise((r) => setTimeout(r, 0));
      expect(totalEvents(host)).toBe(0);
    });

    it('reordered hosts: stable checkoutInstanceId still owns the return', async () => {
      setReturnUrl(returnUrl({ ep_attempt: ATTEMPT }));
      markOrigin('buttons', 0, SAMPLE_PRODUCT.id, 'plan-slot-b');
      // Render order flipped vs the ordinal stored in the marker.
      const hosts = [
        createHost('buttons', SAMPLE_PRODUCT.id, METHODS, 'plan-slot-a'),
        createHost('buttons', SAMPLE_PRODUCT.id, METHODS, 'plan-slot-b'),
      ];
      await settle(hosts);

      expect(hosts[0].successes.length).toBe(0);
      expect(hosts[1].successes.length).toBe(1);
      expect(retrieve).toHaveBeenCalledTimes(1);
    });

    it('conditional / delayed mount: waits, then recovers when the stable id appears', async () => {
      setReturnUrl(returnUrl({ ep_attempt: ATTEMPT }));
      markOrigin('buttons', 0, SAMPLE_PRODUCT.id, 'deferred-host');
      const early = createHost('buttons', SAMPLE_PRODUCT.id, METHODS, 'other-host');
      await settle([early]);
      expect(totalEvents(early)).toBe(0);
      expect(retrieve).not.toHaveBeenCalled();
      expect(warned('STRIPE_RETURN_OWNER_NOT_MOUNTED')).toBeTrue();

      const late = createHost('buttons', SAMPLE_PRODUCT.id, METHODS, 'deferred-host');
      await settle([late]);
      expect(late.successes.length).toBe(1);
      expect(totalEvents(early)).toBe(0);
    });

    it('reload with the same merchant checkoutInstanceId recovers once', async () => {
      setReturnUrl(returnUrl({ ep_attempt: ATTEMPT }));
      markOrigin('checkout', 0, SAMPLE_PRODUCT.id, 'merchant-checkout-1');
      const first = createHost('checkout', SAMPLE_PRODUCT.id, METHODS, 'merchant-checkout-1');
      await settle([first]);
      expect(first.successes.length).toBe(1);

      destroyHost(first);
      // Simulate a fresh page load: URL/marker already cleared by consumeReturn.
      const remount = createHost('checkout', SAMPLE_PRODUCT.id, METHODS, 'merchant-checkout-1');
      await settle([remount]);
      expect(totalEvents(remount)).toBe(0);
      expect(retrieve).toHaveBeenCalledTimes(1);
    });

    it('ambiguous legacy return with several same-product hosts fails closed', async () => {
      setReturnUrl(returnUrl());
      const hosts = [
        createHost('buttons', SAMPLE_PRODUCT.id, METHODS, 'a'),
        createHost('buttons', SAMPLE_PRODUCT.id, METHODS, 'b'),
      ];
      await settle(hosts);
      hosts.forEach((h) => expect(totalEvents(h)).toBe(0));
      expect(retrieve).not.toHaveBeenCalled();
      expect(warned('AMBIGUOUS_HOSTS')).toBeTrue();
    });
  });
});
