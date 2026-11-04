import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import {
  EasyPaymentsHeadless,
  PaymentError,
  type HeadlessCheckoutSession,
  type HeadlessMethodStatus,
  type HeadlessSessionState,
  type PaymentMethod,
  type PaymentProduct,
  type PaymentResult,
} from '@easy-payments/angular';
import { DEMO_HEADLESS_CHECKOUT_INSTANCE_ID } from './demo-headless-checkout-id';
import { HeadlessDemoPanel } from './headless-demo.panel';

const PRODUCT: PaymentProduct = {
  id: 'premium-plan',
  name: 'Premium Plan',
  description: 'One year subscription',
  amount: 99,
  currency: 'USD',
  quantity: 1,
};

const METHODS: PaymentMethod[] = ['card', 'paypal', 'klarna'];

function methodStatus(
  method: PaymentMethod,
  readiness: HeadlessMethodStatus['readiness'] = 'ready',
  available = true,
): HeadlessMethodStatus {
  return {
    method,
    provider: method === 'paypal' ? 'paypal' : method === 'klarna' ? 'klarna' : 'stripe',
    readiness,
    available,
    requiresMount: true,
    interaction: method === 'paypal' ? 'paypal-buttons' : 'confirm',
    mock: true,
  };
}

describe('HeadlessDemoPanel', () => {
  let createSession: jasmine.Spy;
  let initialize: jasmine.Spy;
  let destroy: jasmine.Spy;
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
        methodStatus('paypal'),
        methodStatus('klarna', 'unavailable', false),
      ]);
      state.set('ready');
    });
    destroy = jasmine.createSpy('destroy').and.resolveTo();

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
      selectMethod: jasmine.createSpy('selectMethod'),
      mount: jasmine.createSpy('mount'),
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

  async function createPanel(): Promise<ComponentFixture<HeadlessDemoPanel>> {
    const fixture = TestBed.createComponent(HeadlessDemoPanel);
    fixture.componentRef.setInput('product', PRODUCT);
    fixture.componentRef.setInput('methods', METHODS);
    fixture.componentRef.setInput('theme', 'system');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  it('creates the Headless demo panel', async () => {
    const fixture = await createPanel();
    expect(fixture.componentInstance).toBeTruthy();
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('[data-testid="headless-demo-panel"]'),
    ).toBeTruthy();
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

  it('initializes the session and renders availability', async () => {
    const fixture = await createPanel();
    const root = fixture.nativeElement as HTMLElement;

    expect(initialize).toHaveBeenCalled();
    expect(root.querySelector('[data-testid="headless-demo-state"]')?.textContent).toContain(
      'ready',
    );
    expect(root.querySelector('[data-testid="headless-demo-availability"]')).toBeTruthy();
    expect(root.querySelector('[data-method="card"]')?.getAttribute('data-available')).toBe('true');
    expect(root.querySelector('[data-method="klarna"]')?.getAttribute('data-readiness')).toBe(
      'unavailable',
    );
    expect(root.textContent).toContain('runtime-session-1');
    expect(root.textContent).toContain(DEMO_HEADLESS_CHECKOUT_INSTANCE_ID);
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
    expect(root.querySelector('[data-testid="headless-demo-state"]')?.textContent).toContain(
      'ready',
    );
  });

  it('displays selected method from the session signal', async () => {
    const fixture = await createPanel();
    selectedMethod.set('card');
    fixture.detectChanges();

    expect(
      (fixture.nativeElement as HTMLElement).querySelector('[data-testid="headless-demo-selected"]')
        ?.textContent,
    ).toContain('card');
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

  it('destroys the session on component teardown', async () => {
    const fixture = await createPanel();
    fixture.destroy();
    expect(destroy).toHaveBeenCalled();
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
    } as unknown as HeadlessCheckoutSession;
    createSession.and.returnValue(secondSession);

    const second = await createPanel();
    expect(second.componentInstance.checkoutInstanceId).toBe(DEMO_HEADLESS_CHECKOUT_INSTANCE_ID);
    expect(createSession.calls.count()).toBe(2);
    expect(
      (second.nativeElement as HTMLElement).textContent,
    ).toContain('runtime-session-2');
    second.destroy();
  });
});
