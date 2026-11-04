import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import {
  EasyPaymentsHeadless,
  PaymentError,
  type HeadlessCheckoutSession,
  type HeadlessMethodStatus,
  type HeadlessMountHandle,
  type HeadlessSessionState,
  type PaymentMethod,
  type PaymentProduct,
  type PaymentResult,
} from '@easy-payments/angular';
import { DEMO_HEADLESS_CHECKOUT_INSTANCE_ID } from './demo-headless-checkout-id';
import {
  isHeadlessDemoMountDeferred,
  isHeadlessDemoStripeElementMethod,
} from './headless-demo-mount-policy';
import { HeadlessDemoPanel } from './headless-demo.panel';

const PRODUCT: PaymentProduct = {
  id: 'premium-plan',
  name: 'Premium Plan',
  description: 'One year subscription',
  amount: 99,
  currency: 'USD',
  quantity: 1,
};

const METHODS: PaymentMethod[] = [
  'card',
  'klarna',
  'affirm',
  'paypal',
  'google-pay',
  'apple-pay',
];

function methodStatus(
  method: PaymentMethod,
  readiness: HeadlessMethodStatus['readiness'] = 'ready',
  available = true,
  extras: Partial<HeadlessMethodStatus> = {},
): HeadlessMethodStatus {
  const interaction: HeadlessMethodStatus['interaction'] =
    method === 'paypal'
      ? 'paypal-buttons'
      : method === 'google-pay' || method === 'apple-pay'
        ? 'wallet-button'
        : 'confirm';
  const provider =
    method === 'paypal'
      ? 'paypal'
      : method === 'klarna'
        ? 'klarna'
        : method === 'affirm'
          ? 'affirm'
          : method === 'google-pay'
            ? 'googlePay'
            : method === 'apple-pay'
              ? 'applePay'
              : 'stripe';
  return {
    method,
    provider,
    readiness,
    available,
    requiresMount: true,
    interaction,
    mock: true,
    ...extras,
  };
}

describe('headless-demo-mount-policy', () => {
  it('defers PayPal, Google Pay, and Apple Pay', () => {
    expect(isHeadlessDemoMountDeferred('paypal')).toBeTrue();
    expect(isHeadlessDemoMountDeferred('google-pay')).toBeTrue();
    expect(isHeadlessDemoMountDeferred('apple-pay')).toBeTrue();
    expect(isHeadlessDemoMountDeferred('card')).toBeFalse();
    expect(isHeadlessDemoStripeElementMethod('klarna')).toBeTrue();
    expect(isHeadlessDemoStripeElementMethod('affirm')).toBeTrue();
  });
});

describe('HeadlessDemoPanel', () => {
  let createSession: jasmine.Spy;
  let initialize: jasmine.Spy;
  let destroy: jasmine.Spy;
  let selectMethod: jasmine.Spy;
  let mount: jasmine.Spy;
  let unmount: jasmine.Spy;
  let state: ReturnType<typeof signal<HeadlessSessionState>>;
  let selectedMethod: ReturnType<typeof signal<PaymentMethod | null>>;
  let availableMethods: ReturnType<typeof signal<readonly HeadlessMethodStatus[]>>;
  let lastError: ReturnType<typeof signal<PaymentError | null>>;
  let lastResult: ReturnType<typeof signal<PaymentResult | null>>;
  let started$: Subject<{ method: PaymentMethod; provider: string }>;
  let methodChange$: Subject<{ method: PaymentMethod | null; previousMethod: PaymentMethod | null }>;
  let pending$: Subject<PaymentResult>;
  let success$: Subject<PaymentResult>;
  let cancel$: Subject<PaymentResult>;
  let error$: Subject<PaymentError>;
  let session: HeadlessCheckoutSession;
  let mountHandle: HeadlessMountHandle;

  beforeEach(async () => {
    state = signal<HeadlessSessionState>('idle');
    selectedMethod = signal<PaymentMethod | null>(null);
    availableMethods = signal<readonly HeadlessMethodStatus[]>([]);
    lastError = signal<PaymentError | null>(null);
    lastResult = signal<PaymentResult | null>(null);
    started$ = new Subject();
    methodChange$ = new Subject();
    pending$ = new Subject();
    success$ = new Subject();
    cancel$ = new Subject();
    error$ = new Subject();

    initialize = jasmine.createSpy('initialize').and.callFake(async () => {
      availableMethods.set([
        methodStatus('card'),
        methodStatus('klarna'),
        methodStatus('affirm'),
        methodStatus('paypal'),
        methodStatus('google-pay'),
        methodStatus('apple-pay', 'unavailable', false, {
          readinessNote: 'Apple Pay requires a supported browser and domain.',
        }),
      ]);
      state.set('ready');
    });
    destroy = jasmine.createSpy('destroy').and.resolveTo();
    selectMethod = jasmine.createSpy('selectMethod').and.callFake((method: PaymentMethod | null) => {
      selectedMethod.set(method);
    });
    unmount = jasmine.createSpy('unmount').and.resolveTo();
    mountHandle = { method: 'card', unmount };
    mount = jasmine.createSpy('mount').and.callFake(async (method: PaymentMethod, container: HTMLElement) => {
      container.setAttribute('data-mounted', method);
      mountHandle = { method, unmount };
      return mountHandle;
    });

    session = {
      id: 'runtime-session-1',
      state,
      selectedMethod,
      availableMethods,
      lastError,
      lastResult,
      events: {
        started: started$.asObservable(),
        methodChange: methodChange$.asObservable(),
        pending: pending$.asObservable(),
        success: success$.asObservable(),
        cancel: cancel$.asObservable(),
        error: error$.asObservable(),
      },
      initialize,
      refreshAvailability: jasmine.createSpy('refreshAvailability'),
      selectMethod,
      mount,
      confirm: jasmine.createSpy('confirm'),
      recoverReturn: jasmine.createSpy('recoverReturn'),
      destroy,
    } as unknown as HeadlessCheckoutSession;

    createSession = jasmine.createSpy('createSession').and.returnValue(session);

    await TestBed.configureTestingModule({
      imports: [HeadlessDemoPanel],
      providers: [
        {
          provide: EasyPaymentsHeadless,
          useValue: { createSession },
        },
      ],
    }).compileComponents();
  });

  async function createPanel(
    overrides: { product?: PaymentProduct; methods?: PaymentMethod[]; theme?: string; locale?: string } = {},
  ): Promise<ComponentFixture<HeadlessDemoPanel>> {
    const fixture = TestBed.createComponent(HeadlessDemoPanel);
    fixture.componentRef.setInput('product', overrides.product ?? PRODUCT);
    fixture.componentRef.setInput('methods', overrides.methods ?? METHODS);
    fixture.componentRef.setInput('theme', overrides.theme ?? 'system');
    fixture.componentRef.setInput('locale', overrides.locale ?? 'auto');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  it('creates the Headless demo panel with product summary', async () => {
    const fixture = await createPanel();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('[data-testid="headless-demo-panel"]')).toBeTruthy();
    expect(root.querySelector('[data-testid="headless-demo-product"]')?.textContent).toContain(
      'Premium Plan',
    );
    expect(root.querySelector('[data-testid="headless-demo-price"]')?.textContent).toContain(
      '99.00 USD',
    );
    expect(root.querySelector('[data-testid="headless-demo-mount-host"]')).toBeTruthy();
  });

  it('injects EasyPaymentsHeadless and creates a session with stable checkout identity', async () => {
    await createPanel();

    expect(createSession).toHaveBeenCalledTimes(1);
    const options = createSession.calls.mostRecent().args[0];
    expect(options.checkoutInstanceId).toBe(DEMO_HEADLESS_CHECKOUT_INSTANCE_ID);
    expect(options.product).toEqual(PRODUCT);
    expect(options.methods).toEqual(METHODS);
    expect(options.theme).toBe('system');
  });

  it('renders the method selector with loading and unavailable states', async () => {
    const fixture = await createPanel();
    const root = fixture.nativeElement as HTMLElement;

    expect(root.querySelector('[data-testid="headless-demo-availability"]')).toBeTruthy();
    expect(root.querySelector('[data-method="card"]')).toBeTruthy();
    expect(root.querySelector('[data-method="apple-pay"]')?.getAttribute('data-available')).toBe(
      'false',
    );
    expect(root.textContent).toContain('Apple Pay requires a supported browser and domain.');
  });

  it('shows a loading state while initializing', async () => {
    let resolveInit!: () => void;
    initialize.and.returnValue(
      new Promise<void>((resolve) => {
        resolveInit = resolve;
      }),
    );

    const fixture = TestBed.createComponent(HeadlessDemoPanel);
    fixture.componentRef.setInput('product', PRODUCT);
    fixture.componentRef.setInput('methods', METHODS);
    fixture.detectChanges();

    expect(
      (fixture.nativeElement as HTMLElement).querySelector('[data-testid="headless-demo-loading"]'),
    ).toBeTruthy();

    state.set('ready');
    availableMethods.set([methodStatus('card')]);
    resolveInit();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(
      (fixture.nativeElement as HTMLElement).querySelector('[data-testid="headless-demo-loading"]'),
    ).toBeNull();
  });

  it('mounts Stripe Card through the public session API', async () => {
    const fixture = await createPanel();
    await fixture.componentInstance.onSelectMethod('card');
    fixture.detectChanges();

    expect(selectMethod).toHaveBeenCalledWith('card');
    expect(mount).toHaveBeenCalled();
    expect(mount.calls.mostRecent().args[0]).toBe('card');
    expect(mount.calls.mostRecent().args[1]).toBeInstanceOf(HTMLElement);
    expect(fixture.componentInstance.mountPhase()).toBe('mounted');
    expect(
      (fixture.nativeElement as HTMLElement).querySelector(
        '[data-testid="headless-demo-confirm-placeholder"]',
      ),
    ).toBeTruthy();
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('.headless-demo__pay-disabled')?.hasAttribute(
        'disabled',
      ),
    ).toBeTrue();
    expect(session.confirm).not.toHaveBeenCalled();
  });

  it('mounts Klarna and Affirm Payment Elements', async () => {
    const fixture = await createPanel();

    await fixture.componentInstance.onSelectMethod('klarna');
    expect(mount.calls.mostRecent().args[0]).toBe('klarna');
    expect(fixture.componentInstance.mountPhase()).toBe('mounted');

    await fixture.componentInstance.onSelectMethod('affirm');
    expect(unmount).toHaveBeenCalled();
    expect(mount.calls.mostRecent().args[0]).toBe('affirm');
    expect(session.confirm).not.toHaveBeenCalled();
  });

  it('defers PayPal, Google Pay, and Apple Pay without mounting', async () => {
    const fixture = await createPanel();
    const root = fixture.nativeElement as HTMLElement;

    await fixture.componentInstance.onSelectMethod('paypal');
    fixture.detectChanges();
    expect(selectMethod).toHaveBeenCalledWith('paypal');
    expect(mount).not.toHaveBeenCalled();
    expect(fixture.componentInstance.mountPhase()).toBe('deferred');
    expect(root.querySelector('[data-testid="headless-demo-mount-deferred"]')?.textContent).toContain(
      'H5.3',
    );

    await fixture.componentInstance.onSelectMethod('google-pay');
    fixture.detectChanges();
    expect(mount).not.toHaveBeenCalled();
    expect(fixture.componentInstance.mountPhase()).toBe('deferred');

    // Apple Pay remains unavailable in the default fixture — selection blocked.
    await fixture.componentInstance.onSelectMethod('apple-pay');
    expect(selectMethod).not.toHaveBeenCalledWith('apple-pay');

    availableMethods.set([
      ...availableMethods().filter((entry) => entry.method !== 'apple-pay'),
      methodStatus('apple-pay'),
    ]);
    fixture.detectChanges();
    await fixture.componentInstance.onSelectMethod('apple-pay');
    fixture.detectChanges();
    expect(selectMethod).toHaveBeenCalledWith('apple-pay');
    expect(mount).not.toHaveBeenCalled();
    expect(root.querySelector('[data-testid="headless-demo-mount-deferred"]')).toBeTruthy();
  });

  it('does not select unavailable methods', async () => {
    const fixture = await createPanel();
    await fixture.componentInstance.onSelectMethod('apple-pay');
    expect(selectMethod).not.toHaveBeenCalled();
    expect(mount).not.toHaveBeenCalled();
  });

  it('unmounts the previous handle when switching methods', async () => {
    const fixture = await createPanel();
    await fixture.componentInstance.onSelectMethod('card');
    expect(mount).toHaveBeenCalledTimes(1);

    await fixture.componentInstance.onSelectMethod('klarna');
    expect(unmount).toHaveBeenCalled();
    expect(mount).toHaveBeenCalledTimes(2);
    expect(mount.calls.mostRecent().args[0]).toBe('klarna');
  });

  it('ignores stale mount completions during rapid switching', async () => {
    const fixture = await createPanel();
    let resolveCard!: (handle: HeadlessMountHandle) => void;
    let cardMountStarted!: () => void;
    const cardStarted = new Promise<void>((resolve) => {
      cardMountStarted = resolve;
    });
    mount.and.callFake(async (method: PaymentMethod) => {
      if (method === 'card') {
        cardMountStarted();
        return new Promise<HeadlessMountHandle>((resolve) => {
          resolveCard = resolve;
        });
      }
      return { method, unmount };
    });

    const cardPromise = fixture.componentInstance.onSelectMethod('card');
    await cardStarted;
    await fixture.componentInstance.onSelectMethod('klarna');
    resolveCard({ method: 'card', unmount });
    await cardPromise;

    expect(fixture.componentInstance.mountPhase()).toBe('mounted');
    expect(mount.calls.mostRecent().args[0]).toBe('klarna');
  });

  it('surfaces mount failures without calling confirm', async () => {
    const fixture = await createPanel();
    mount.and.rejectWith(
      new PaymentError({ code: 'PROVIDER_UNAVAILABLE', message: 'Element failed.' }),
    );

    await fixture.componentInstance.onSelectMethod('card');
    fixture.detectChanges();

    expect(fixture.componentInstance.mountPhase()).toBe('failed');
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('[data-testid="headless-demo-mount-error"]')
        ?.textContent,
    ).toContain('PROVIDER_UNAVAILABLE');
    expect(session.confirm).not.toHaveBeenCalled();
  });

  it('continues after unmount failure when switching methods', async () => {
    const fixture = await createPanel();
    await fixture.componentInstance.onSelectMethod('card');
    unmount.and.rejectWith(new Error('unmount failed'));

    await fixture.componentInstance.onSelectMethod('klarna');
    expect(mount.calls.mostRecent().args[0]).toBe('klarna');
    expect(fixture.componentInstance.mountPhase()).toBe('mounted');
  });

  it('destroys the session and unmounts on component teardown', async () => {
    const fixture = await createPanel();
    await fixture.componentInstance.onSelectMethod('card');
    fixture.destroy();
    await Promise.resolve();
    await Promise.resolve();
    expect(unmount).toHaveBeenCalled();
    expect(destroy).toHaveBeenCalled();
  });

  it('ignores mount completion after destroy during mount', async () => {
    const fixture = await createPanel();
    let resolveMount!: (handle: HeadlessMountHandle) => void;
    let mountStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      mountStarted = resolve;
    });
    mount.and.callFake(
      () =>
        new Promise<HeadlessMountHandle>((resolve) => {
          mountStarted();
          resolveMount = resolve;
        }),
    );

    const mountPromise = fixture.componentInstance.onSelectMethod('card');
    await started;
    fixture.destroy();
    await Promise.resolve();
    await Promise.resolve();

    const staleUnmount = jasmine.createSpy('stale-unmount').and.resolveTo();
    resolveMount({ method: 'card', unmount: staleUnmount });
    await mountPromise;

    expect(staleUnmount).toHaveBeenCalled();
    expect(destroy).toHaveBeenCalled();
  });

  it('recreates the session when product configuration changes', async () => {
    const fixture = await createPanel();
    expect(createSession).toHaveBeenCalledTimes(1);

    const nextSession = {
      ...session,
      id: 'runtime-session-2',
      destroy: jasmine.createSpy('destroy-2').and.resolveTo(),
      initialize: jasmine.createSpy('initialize-2').and.callFake(async () => {
        availableMethods.set([methodStatus('card')]);
        state.set('ready');
      }),
      selectMethod,
      mount,
    } as unknown as HeadlessCheckoutSession;
    createSession.and.returnValue(nextSession);

    fixture.componentRef.setInput('product', {
      ...PRODUCT,
      amount: 149,
      name: 'Premium Plan Plus',
    });
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(createSession.calls.count()).toBeGreaterThanOrEqual(2);
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('[data-testid="headless-demo-product"]')
        ?.textContent,
    ).toContain('Premium Plan Plus');
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('[data-testid="headless-demo-price"]')
        ?.textContent,
    ).toContain('149.00 USD');
  });

  it('skips product recreation while payment is processing', async () => {
    const fixture = await createPanel();
    const initialCalls = createSession.calls.count();
    state.set('processing');
    fixture.detectChanges();

    fixture.componentRef.setInput('product', { ...PRODUCT, amount: 200 });
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(createSession.calls.count()).toBe(initialCalls);
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('[data-testid="headless-demo-config-skip"]'),
    ).toBeTruthy();
  });

  it('applies theme and locale to createSession options', async () => {
    await createPanel({ theme: 'dark', locale: 'es' });
    const options = createSession.calls.mostRecent().args[0];
    expect(options.theme).toBe('dark');
    expect(options.locale).toBe('es');
  });

  it('keeps a mobile-friendly method list structure', async () => {
    const fixture = await createPanel();
    const list = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="headless-demo-availability"]',
    );
    expect(list?.getAttribute('role')).toBe('listbox');
    expect(list?.querySelectorAll('[role="option"]').length).toBeGreaterThan(0);
  });

  it('surfaces initialization errors and allows retry', async () => {
    initialize.and.rejectWith(
      new PaymentError({ code: 'CONFIG_INVALID', message: 'Missing providers.' }),
    );

    const fixture = await createPanel();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('[data-testid="headless-demo-boot-error"]')?.textContent).toContain(
      'CONFIG_INVALID',
    );

    initialize.and.callFake(async () => {
      availableMethods.set([methodStatus('card')]);
      state.set('ready');
    });
    await fixture.componentInstance.retryInitialize();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(createSession.calls.count()).toBeGreaterThanOrEqual(2);
    expect(root.querySelector('[data-testid="headless-demo-boot-error"]')).toBeNull();
  });

  it('subscribes to lifecycle events without exposing secrets', async () => {
    const fixture = await createPanel();
    methodChange$.next({ previousMethod: null, method: 'card' });
    error$.next(
      new PaymentError({
        code: 'PAYMENT_FAILED',
        message: 'Buyer declined.',
      }),
    );
    fixture.detectChanges();

    const events = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="headless-demo-events"]',
    );
    expect(events?.textContent).toContain('methodChange');
    expect(events?.textContent).toContain('PAYMENT_FAILED');
    expect((fixture.nativeElement as HTMLElement).textContent).not.toContain('client_secret');
    expect((fixture.nativeElement as HTMLElement).textContent).not.toContain('sk_');
  });

  it('keeps checkout identity stable across remounts while creating a fresh session', async () => {
    const first = await createPanel();
    expect(first.componentInstance.checkoutInstanceId).toBe(DEMO_HEADLESS_CHECKOUT_INSTANCE_ID);
    first.destroy();

    const secondSession = {
      ...session,
      id: 'runtime-session-2',
      destroy: jasmine.createSpy('destroy-2').and.resolveTo(),
      initialize: jasmine.createSpy('initialize-2').and.callFake(async () => {
        availableMethods.set([methodStatus('card')]);
        state.set('ready');
      }),
      selectMethod,
      mount,
    } as unknown as HeadlessCheckoutSession;
    createSession.and.returnValue(secondSession);

    const second = await createPanel();
    expect(second.componentInstance.checkoutInstanceId).toBe(DEMO_HEADLESS_CHECKOUT_INSTANCE_ID);
    expect(createSession.calls.count()).toBe(2);
    expect((second.nativeElement as HTMLElement).textContent).toContain('runtime-session-2');
    second.destroy();
  });
});
