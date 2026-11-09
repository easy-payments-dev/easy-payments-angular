import { TestBed } from '@angular/core/testing';
import { provideHttpClient, withXhr } from '@angular/common/http';
import { PLATFORM_ID } from '@angular/core';
import { firstValueFrom, isObservable } from 'rxjs';
import { provideEasyPayments } from '../config/provide-easy-payments';
import { PaymentError } from '../errors/payment-error';
import type { PaymentProduct } from '../models';
import { PaymentOrchestratorService } from '../services/payment-orchestrator.service';
import { StripeRedirectRecoveryService } from '../adapters/stripe/stripe-redirect-recovery.service';
import { EasyPaymentsHeadless } from './easy-payments-headless.service';
import { HeadlessSessionRegistry } from './headless-session-registry';
import { toHeadlessMethodStatus } from './headless-method-meta';
import { resolveHeadlessTheme } from './resolve-headless-theme';
import type { HeadlessCheckoutSession } from './headless.types';
import * as PublicApi from '../../public-api';

const PRODUCT: PaymentProduct = {
  id: 'premium-plan',
  name: 'Premium',
  amount: 99,
  currency: 'USD',
};

describe('resolveHeadlessTheme', () => {
  it('resolves explicit and system themes without a ThemeService', () => {
    expect(resolveHeadlessTheme('light', true)).toBe('light');
    expect(resolveHeadlessTheme('dark', false)).toBe('dark');
    expect(resolveHeadlessTheme('system', true)).toBe('dark');
    expect(resolveHeadlessTheme(undefined, false)).toBe('light');
  });
});

describe('toHeadlessMethodStatus', () => {
  it('keeps Apple Pay loading instead of inventing unavailability', () => {
    const status = toHeadlessMethodStatus({
      method: 'apple-pay',
      isMock: false,
      available: false,
      status: 'checking',
      readiness: 'loading',
      diagnosticCode: 'PROVIDER_AVAILABILITY_PENDING',
    });
    expect(status.readiness).toBe('loading');
    expect(status.available).toBeFalse();
    expect(status.requiresMount).toBeTrue();
    expect(status.interaction).toBe('wallet-button');
    expect(status.readinessNote).toContain('Express Checkout');
  });

  it('maps mock adapters to mock interaction', () => {
    const status = toHeadlessMethodStatus({
      method: 'card',
      isMock: true,
      available: true,
      readiness: 'ready',
    });
    expect(status.interaction).toBe('mock');
    expect(status.mock).toBeTrue();
  });
});

describe('EasyPaymentsHeadless / HeadlessCheckoutSession', () => {
  let headless: EasyPaymentsHeadless;
  let registry: HeadlessSessionRegistry;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withXhr()),
        { provide: PLATFORM_ID, useValue: 'browser' },
        provideEasyPayments({
          enableMockMode: true,
          providers: {},
        }),
      ],
    });
    headless = TestBed.inject(EasyPaymentsHeadless);
    registry = TestBed.inject(HeadlessSessionRegistry);
    registry.clearForTests();
    TestBed.inject(StripeRedirectRecoveryService).resetForTests();
  });

  afterEach(async () => {
    registry.clearForTests();
    TestBed.inject(StripeRedirectRecoveryService).resetForTests();
  });

  function create(
    overrides: Partial<Parameters<EasyPaymentsHeadless['createSession']>[0]> = {},
  ): HeadlessCheckoutSession {
    return headless.createSession({
      product: PRODUCT,
      methods: ['card', 'paypal'],
      ...overrides,
    });
  }

  it('exports the public Headless API surface', () => {
    expect(PublicApi.EasyPaymentsHeadless).toBe(EasyPaymentsHeadless);
    expect(typeof PublicApi.EasyPaymentsHeadless).toBe('function');
  });

  it('creates a session with an auto-generated id and idle state', () => {
    const session = create();
    expect(session.id).toMatch(/^headless-\d+$/);
    expect(session.state()).toBe('idle');
    expect(session.selectedMethod()).toBeNull();
    expect(session.availableMethods()).toEqual([]);
    expect(session.lastError()).toBeNull();
    expect(session.lastResult()).toBeNull();
    expect(registry.has(session.id)).toBeTrue();
  });

  it('accepts an explicit checkoutInstanceId', () => {
    const session = create({ checkoutInstanceId: 'account-checkout' });
    expect(session.id).toBe('account-checkout');
  });

  it('rejects an invalid checkoutInstanceId', () => {
    expect(() => create({ checkoutInstanceId: 'bad id!' })).toThrowError(
      /checkoutInstanceId must match/,
    );
  });

  it('rejects colliding live checkoutInstanceIds', () => {
    create({ checkoutInstanceId: 'shared-slot' });
    expect(() => create({ checkoutInstanceId: 'shared-slot' })).toThrowError(
      /already active/,
    );
  });

  it('allows reusing an id after destroy', async () => {
    const first = create({ checkoutInstanceId: 'reuse-me' });
    await first.destroy();
    const second = create({ checkoutInstanceId: 'reuse-me' });
    expect(second.id).toBe('reuse-me');
    await second.destroy();
  });

  it('rejects empty, duplicate, or unknown methods', () => {
    expect(() => create({ methods: [] })).toThrowError(/non-empty/);
    expect(() => create({ methods: ['card', 'card'] })).toThrowError(/Duplicate/);
    expect(() =>
      create({ methods: ['venmo' as never] }),
    ).toThrowError(/Unsupported/);
  });

  it('rejects an invalid product at createSession', () => {
    expect(() =>
      create({
        product: { id: '', name: 'X', amount: 1, currency: 'USD' },
      }),
    ).toThrowError(/Product ID/);
  });

  it('initializes to ready and projects mock readiness', async () => {
    const session = create({ methods: ['card', 'paypal', 'apple-pay'] });
    await session.initialize();
    expect(session.state()).toBe('ready');
    expect(session.lastResult()).toBeNull();

    const methods = session.availableMethods();
    expect(methods.map((m) => m.method)).toEqual(['card', 'paypal', 'apple-pay']);
    expect(methods.every((m) => m.requiresMount)).toBeTrue();
    expect(methods.find((m) => m.method === 'card')?.interaction).toBe('mock');
    expect(methods.find((m) => m.method === 'paypal')?.available).toBeTrue();
  });

  it('duplicate initialize is a no-op when already ready', async () => {
    const session = create();
    await session.initialize();
    await session.initialize();
    expect(session.state()).toBe('ready');
  });

  it('shares a single in-flight initialize promise', async () => {
    const session = create();
    const a = session.initialize();
    const b = session.initialize();
    await Promise.all([a, b]);
    expect(session.state()).toBe('ready');
  });

  it('records initialize failure, emits error, and allows retry', async () => {
    const session = create();
    const orchestrator = TestBed.inject(PaymentOrchestratorService);
    const initSpy = spyOn(orchestrator, 'initialize').and.rejectWith(
      new PaymentError({ code: 'SDK_LOAD_FAILED', message: 'boom' }),
    );

    const errors: PaymentError[] = [];
    session.events.error.subscribe((e) => errors.push(e));

    await expectAsync(session.initialize()).toBeRejectedWith(
      jasmine.objectContaining({ code: 'SDK_LOAD_FAILED' }),
    );
    expect(session.state()).toBe('error');
    expect(session.lastError()?.code).toBe('SDK_LOAD_FAILED');
    expect(errors.length).toBe(1);

    initSpy.and.resolveTo();
    await session.initialize();
    expect(session.state()).toBe('ready');
    expect(session.lastError()).toBeNull();
  });

  it('selects methods, suppresses duplicates, and emits methodChange', async () => {
    const session = create({ methods: ['card', 'paypal'] });
    await session.initialize();

    const changes: unknown[] = [];
    session.events.methodChange.subscribe((e) => changes.push(e));

    session.selectMethod('paypal');
    session.selectMethod('paypal');
    session.selectMethod('card');
    session.selectMethod(null);

    expect(changes.length).toBe(3);
    expect(session.selectedMethod()).toBeNull();
    expect((changes[0] as { method: string }).method).toBe('paypal');
  });

  it('rejects selecting a method outside the session allow-list', async () => {
    const session = create({ methods: ['card'] });
    await session.initialize();
    expect(() => session.selectMethod('paypal')).toThrowError(/not configured/);
  });

  it('keeps independent state across concurrent sessions', async () => {
    const a = create({ checkoutInstanceId: 'session-a', methods: ['card'] });
    const b = create({ checkoutInstanceId: 'session-b', methods: ['paypal'] });
    await Promise.all([a.initialize(), b.initialize()]);

    a.selectMethod('card');
    b.selectMethod('paypal');

    expect(a.selectedMethod()).toBe('card');
    expect(b.selectedMethod()).toBe('paypal');
    expect(a.availableMethods().map((m) => m.method)).toEqual(['card']);
    expect(b.availableMethods().map((m) => m.method)).toEqual(['paypal']);

    await a.destroy();
    expect(a.state()).toBe('destroyed');
    expect(b.state()).toBe('ready');
    expect(registry.has('session-a')).toBeFalse();
    expect(registry.has('session-b')).toBeTrue();
    await b.destroy();
  });

  it('destroy before initialize releases the id and blocks further ops', async () => {
    const session = create({ checkoutInstanceId: 'early-destroy' });
    await session.destroy();
    expect(session.state()).toBe('destroyed');
    expect(registry.has('early-destroy')).toBeFalse();
    await expectAsync(session.initialize()).toBeRejectedWith(
      jasmine.objectContaining({ code: 'PROVIDER_UNAVAILABLE' }),
    );
    expect(() => session.selectMethod('card')).toThrowError(/destroyed/);
  });

  it('destroy during initialize prevents ready resurrection', async () => {
    const session = create({ checkoutInstanceId: 'mid-init' });
    const orchestrator = TestBed.inject(PaymentOrchestratorService);

    let releaseInit!: () => void;
    spyOn(orchestrator, 'initialize').and.returnValue(
      new Promise<void>((resolve) => {
        releaseInit = () => resolve();
      }),
    );

    const pending = session.initialize();
    expect(session.state()).toBe('initializing');
    await session.destroy();
    releaseInit();
    await expectAsync(pending).toBeRejectedWith(
      jasmine.objectContaining({
        message: jasmine.stringMatching(/destroyed during initialize/),
      }),
    );
    expect(session.state()).toBe('destroyed');
  });

  it('repeated destroy is idempotent and completes event streams', async () => {
    const session = create();
    await session.initialize();
    const completed: string[] = [];
    session.events.methodChange.subscribe({
      complete: () => completed.push('methodChange'),
    });
    session.events.error.subscribe({
      complete: () => completed.push('error'),
    });

    await session.destroy();
    await session.destroy();
    expect(session.state()).toBe('destroyed');
    expect(completed).toEqual(['methodChange', 'error']);
  });

  it('ignores late availability results after destroy', async () => {
    const session = create({ checkoutInstanceId: 'stale-refresh' });
    await session.initialize();

    const orchestrator = TestBed.inject(PaymentOrchestratorService);

    let resolveRefresh!: (value: Awaited<ReturnType<typeof orchestrator.refreshAvailability>>) => void;
    spyOn(orchestrator, 'refreshAvailability').and.returnValue(
      new Promise((resolve) => {
        resolveRefresh = resolve;
      }),
    );

    const pending = session.refreshAvailability();
    await session.destroy();
    resolveRefresh([
      {
        method: 'card',
        isMock: true,
        available: true,
        readiness: 'ready',
      },
    ]);
    const result = await pending;
    expect(result).toEqual([]);
    expect(session.availableMethods()).toEqual([]);
    expect(session.state()).toBe('destroyed');
  });

  it('exposes readonly signals and observable events', async () => {
    const session = create();
    expect(typeof session.state).toBe('function');
    expect(isObservable(session.events.started)).toBeTrue();
    expect(isObservable(session.events.methodChange)).toBeTrue();
    expect(isObservable(session.events.pending)).toBeTrue();
    expect(isObservable(session.events.success)).toBeTrue();
    expect(isObservable(session.events.cancel)).toBeTrue();
    expect(isObservable(session.events.error)).toBeTrue();

    // Payment lifecycle streams stay silent in H2.
    let started = false;
    session.events.started.subscribe(() => {
      started = true;
    });
    await session.initialize();
    session.selectMethod('card');
    expect(started).toBeFalse();
    expect(session.lastResult()).toBeNull();
  });

  it('refreshAvailability requires initialize first', async () => {
    const session = create();
    await expectAsync(session.refreshAvailability()).toBeRejectedWith(
      jasmine.objectContaining({ message: jasmine.stringMatching(/initialize/) }),
    );
  });

  it('does not emit fake payment lifecycle events on selection', async () => {
    const session = create();
    await session.initialize();
    const change = firstValueFrom(session.events.methodChange);
    session.selectMethod('card');
    await expectAsync(change).toBeResolvedTo(
      jasmine.objectContaining({ method: 'card', previousMethod: null, provider: 'stripe' }),
    );
  });
});
