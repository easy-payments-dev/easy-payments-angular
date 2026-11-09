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
  isHeadlessDemoOfficialButtonMethod,
  isHeadlessDemoRecoveryRetryable,
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
  it('classifies Stripe element vs official-button methods', () => {
    expect(isHeadlessDemoStripeElementMethod('card')).toBeTrue();
    expect(isHeadlessDemoStripeElementMethod('klarna')).toBeTrue();
    expect(isHeadlessDemoOfficialButtonMethod('paypal')).toBeTrue();
    expect(isHeadlessDemoOfficialButtonMethod('google-pay')).toBeTrue();
    expect(isHeadlessDemoOfficialButtonMethod('apple-pay')).toBeTrue();
    expect(isHeadlessDemoMountDeferred('paypal')).toBeFalse();
  });

  it('detects retryable recovery verification failures', () => {
    expect(
      isHeadlessDemoRecoveryRetryable(
        new PaymentError({ code: 'NETWORK_ERROR', message: 'offline' }),
      ),
    ).toBeTrue();
    expect(
      isHeadlessDemoRecoveryRetryable(
        new PaymentError({ code: 'PAYMENT_FAILED', message: 'nope' }),
      ),
    ).toBeFalse();
  });
});

describe('HeadlessDemoPanel', () => {
  let createSession: jasmine.Spy;
  let initialize: jasmine.Spy;
  let destroy: jasmine.Spy;
  let selectMethod: jasmine.Spy;
  let mount: jasmine.Spy;
  let confirm: jasmine.Spy;
  let recoverReturn: jasmine.Spy;
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

  beforeEach(async () => {
    history.replaceState({}, '', '/');
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
        methodStatus('apple-pay', 'loading', false, {
          readinessNote:
            'Apple Pay eligibility is confirmed after mount("apple-pay") renders the Stripe Express Checkout Element.',
        }),
      ]);
      state.set('ready');
    });
    destroy = jasmine.createSpy('destroy').and.resolveTo();
    selectMethod = jasmine.createSpy('selectMethod').and.callFake((method: PaymentMethod | null) => {
      selectedMethod.set(method);
    });
    unmount = jasmine.createSpy('unmount').and.resolveTo();
    mount = jasmine.createSpy('mount').and.callFake(async (method: PaymentMethod, container: HTMLElement) => {
      container.setAttribute('data-mounted', method);
      return { method, unmount } as HeadlessMountHandle;
    });
    confirm = jasmine.createSpy('confirm').and.callFake(async () => {
      state.set('processing');
      const result: PaymentResult = {
        status: 'success',
        method: selectedMethod() ?? 'card',
        provider: 'stripe',
        transactionId: 'pi_demo',
      };
      lastResult.set(result);
      state.set('success');
      success$.next(result);
    });
    recoverReturn = jasmine.createSpy('recoverReturn').and.resolveTo(null);

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
      confirm,
      recoverReturn,
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

  afterEach(() => {
    history.replaceState({}, '', '/');
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

  it('creates the panel with product summary and stable checkout identity', async () => {
    const fixture = await createPanel();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('[data-testid="headless-demo-product"]')?.textContent).toContain(
      'Premium Plan',
    );
    expect(root.textContent).toContain(DEMO_HEADLESS_CHECKOUT_INSTANCE_ID);
    expect(createSession.calls.mostRecent().args[0].checkoutInstanceId).toBe(
      DEMO_HEADLESS_CHECKOUT_INSTANCE_ID,
    );
  });

  it('calls recoverReturn after initialize before enabling mounts', async () => {
    const order: string[] = [];
    initialize.and.callFake(async () => {
      order.push('initialize');
      availableMethods.set([methodStatus('card')]);
      state.set('ready');
    });
    recoverReturn.and.callFake(async () => {
      order.push('recoverReturn');
      return null;
    });

    await createPanel();
    expect(order).toEqual(['initialize', 'recoverReturn']);
  });

  it('mounts Stripe Card and confirms through the public API', async () => {
    const fixture = await createPanel();
    await fixture.componentInstance.onSelectMethod('card');
    fixture.detectChanges();

    expect(mount).toHaveBeenCalled();
    expect(fixture.componentInstance.canConfirmPayment()).toBeTrue();
    await fixture.componentInstance.onConfirmPayment();
    fixture.detectChanges();

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('[data-testid="headless-demo-last-result"]')
        ?.textContent,
    ).toContain('success');
  });

  it('confirms Klarna and Affirm without calling confirm for wallets', async () => {
    const fixture = await createPanel();

    await fixture.componentInstance.onSelectMethod('klarna');
    await fixture.componentInstance.onConfirmPayment();
    expect(confirm).toHaveBeenCalledTimes(1);

    await fixture.componentInstance.onSelectMethod('affirm');
    state.set('ready');
    await fixture.componentInstance.onConfirmPayment();
    expect(confirm).toHaveBeenCalledTimes(2);

    await fixture.componentInstance.onSelectMethod('paypal');
    await fixture.componentInstance.onConfirmPayment();
    expect(confirm).toHaveBeenCalledTimes(2);
  });

  it('prevents double confirm while processing', async () => {
    const fixture = await createPanel();
    await fixture.componentInstance.onSelectMethod('card');

    let release!: () => void;
    confirm.and.returnValue(
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    );

    const first = fixture.componentInstance.onConfirmPayment();
    await Promise.resolve();
    await fixture.componentInstance.onConfirmPayment();
    expect(confirm).toHaveBeenCalledTimes(1);
    release();
    await first;
  });

  it('shows processing UI during confirmation', async () => {
    const fixture = await createPanel();
    await fixture.componentInstance.onSelectMethod('card');

    let release!: () => void;
    confirm.and.callFake(
      () =>
        new Promise<void>((resolve) => {
          state.set('processing');
          release = resolve;
        }),
    );

    const pending = fixture.componentInstance.onConfirmPayment();
    fixture.detectChanges();
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('[data-testid="headless-demo-processing"]'),
    ).toBeTruthy();
    release();
    await pending;
  });

  it('displays pending, cancelled, authorization-only, and authentication-required outcomes', async () => {
    const fixture = await createPanel();
    await fixture.componentInstance.onSelectMethod('card');

    lastResult.set({
      status: 'processing',
      method: 'card',
      provider: 'stripe',
      message: 'Still processing',
    });
    state.set('pending');
    fixture.detectChanges();
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('[data-testid="headless-demo-pending-note"]'),
    ).toBeTruthy();

    lastResult.set({
      status: 'success',
      method: 'card',
      provider: 'stripe',
      transactionId: 'pi_auth',
      metadata: { authorizationOnly: true },
    });
    state.set('success');
    fixture.detectChanges();
    expect(
      (fixture.nativeElement as HTMLElement).querySelector(
        '[data-testid="headless-demo-authorization-only"]',
      )?.textContent,
    ).toContain('Authorization only');

    lastResult.set({
      status: 'cancelled',
      method: 'card',
      provider: 'stripe',
    });
    state.set('cancelled');
    fixture.detectChanges();
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('[data-testid="headless-demo-last-result"]')
        ?.textContent,
    ).toContain('cancelled');

    lastError.set(
      new PaymentError({
        code: 'AUTHENTICATION_REQUIRED',
        message: 'Additional authentication is required.',
        method: 'klarna',
      }),
    );
    state.set('error');
    fixture.detectChanges();
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('[data-testid="headless-demo-last-error"]')
        ?.textContent,
    ).toContain('AUTHENTICATION_REQUIRED');
  });

  it('mounts PayPal, Google Pay, and Apple Pay without calling confirm', async () => {
    const fixture = await createPanel();

    await fixture.componentInstance.onSelectMethod('paypal');
    expect(mount.calls.mostRecent().args[0]).toBe('paypal');
    expect(fixture.componentInstance.showOfficialButtonHint()).toBeTrue();
    expect(fixture.componentInstance.canConfirmPayment()).toBeFalse();

    await fixture.componentInstance.onSelectMethod('google-pay');
    expect(mount.calls.mostRecent().args[0]).toBe('google-pay');

    await fixture.componentInstance.onSelectMethod('apple-pay');
    expect(mount.calls.mostRecent().args[0]).toBe('apple-pay');
    expect(confirm).not.toHaveBeenCalled();
  });

  it('treats PayPal capture success from library events, not approval alone', async () => {
    const fixture = await createPanel();
    await fixture.componentInstance.onSelectMethod('paypal');
    started$.next({ method: 'paypal', provider: 'paypal' });
    fixture.detectChanges();
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('[data-testid="headless-demo-events"]')
        ?.textContent,
    ).toContain('started');

    const captured: PaymentResult = {
      status: 'success',
      method: 'paypal',
      provider: 'paypal',
      transactionId: 'ORDER-1',
    };
    lastResult.set(captured);
    state.set('success');
    success$.next(captured);
    fixture.detectChanges();
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('[data-testid="headless-demo-last-result"]')
        ?.textContent,
    ).toContain('ORDER-1');
  });

  it('surfaces wallet unavailable without false success', async () => {
    const fixture = await createPanel();
    availableMethods.set([
      methodStatus('google-pay', 'unavailable', false, {
        diagnosticCode: 'GOOGLE_PAY_UNAVAILABLE',
      }),
    ]);
    fixture.detectChanges();
    await fixture.componentInstance.onSelectMethod('google-pay');
    expect(mount).not.toHaveBeenCalled();
    expect(fixture.componentInstance.lastResult()).toBeNull();
  });

  function setBnplReturnUrl(): void {
    history.replaceState(
      {},
      '',
      '/?ep_method=klarna&payment_intent=pi_x&payment_intent_client_secret=cs_test_x',
    );
  }

  it('recovers a successful owned return on initialization', async () => {
    setBnplReturnUrl();
    recoverReturn.and.resolveTo({
      status: 'success',
      method: 'klarna',
      provider: 'klarna',
      transactionId: 'pi_recovered',
    } satisfies PaymentResult);

    const fixture = await createPanel();
    fixture.detectChanges();
    expect(recoverReturn).toHaveBeenCalled();
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('[data-testid="headless-demo-recovery"]')
        ?.textContent,
    ).toContain('success');
  });

  it('handles pending, cancelled, transient failure, and recovery retry', async () => {
    setBnplReturnUrl();
    recoverReturn.and.resolveTo({
      status: 'processing',
      method: 'affirm',
      provider: 'affirm',
    } satisfies PaymentResult);
    let fixture = await createPanel();
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('[data-testid="headless-demo-recovery"]')
        ?.textContent,
    ).toContain('pending');
    fixture.destroy();

    setBnplReturnUrl();
    recoverReturn.and.resolveTo({
      status: 'cancelled',
      method: 'klarna',
      provider: 'klarna',
    } satisfies PaymentResult);
    fixture = await createPanel();
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('[data-testid="headless-demo-recovery"]')
        ?.textContent,
    ).toContain('cancelled');
    fixture.destroy();

    setBnplReturnUrl();
    recoverReturn.and.rejectWith(
      new PaymentError({ code: 'NETWORK_ERROR', message: 'offline' }),
    );
    fixture = await createPanel();
    fixture.detectChanges();
    expect(fixture.componentInstance.canRetryRecovery()).toBeTrue();
    expect(
      (fixture.nativeElement as HTMLElement).querySelector(
        '[data-testid="headless-demo-recovery-retry"]',
      ),
    ).toBeTruthy();

    recoverReturn.and.resolveTo({
      status: 'success',
      method: 'klarna',
      provider: 'klarna',
      transactionId: 'pi_retry',
    } satisfies PaymentResult);
    await fixture.componentInstance.retryRecoverReturn();
    fixture.detectChanges();
    expect(recoverReturn.calls.count()).toBeGreaterThan(1);
    expect(confirm).not.toHaveBeenCalled();
  });

  it('does not fabricate results for non-owner recoverReturn null', async () => {
    setBnplReturnUrl();
    recoverReturn.and.resolveTo(null);
    const fixture = await createPanel();
    expect(fixture.componentInstance.lastResult()).toBeNull();
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('[data-testid="headless-demo-recovery"]')
        ?.textContent,
    ).toContain('No Headless-owned return');
  });

  it('does not create a new session PaymentIntent path during recovery before mount', async () => {
    setBnplReturnUrl();
    let recoverDone = false;
    recoverReturn.and.callFake(async () => {
      expect(mount).not.toHaveBeenCalled();
      recoverDone = true;
      return {
        status: 'success',
        method: 'klarna',
        provider: 'klarna',
        transactionId: 'pi_ok',
      } satisfies PaymentResult;
    });
    await createPanel();
    expect(recoverDone).toBeTrue();
    expect(mount).not.toHaveBeenCalled();
  });

  it('defers configuration changes during in-flight recovery', async () => {
    setBnplReturnUrl();
    let releaseRecover!: (value: PaymentResult | null) => void;
    let recoverStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      recoverStarted = resolve;
    });
    recoverReturn.and.callFake(
      () =>
        new Promise<PaymentResult | null>((resolve) => {
          recoverStarted();
          releaseRecover = resolve;
        }),
    );

    const fixture = TestBed.createComponent(HeadlessDemoPanel);
    fixture.componentRef.setInput('product', PRODUCT);
    fixture.componentRef.setInput('methods', METHODS);
    fixture.detectChanges();
    await started;

    const initialCalls = createSession.calls.count();
    fixture.componentRef.setInput('product', { ...PRODUCT, amount: 130 });
    fixture.detectChanges();
    await Promise.resolve();

    expect(createSession.calls.count()).toBe(initialCalls);
    expect(fixture.componentInstance.recoveryPhase()).toBe('recovering');
    expect(fixture.componentInstance.pendingConfigFingerprint()).not.toBeNull();

    releaseRecover(null);
    for (let i = 0; i < 20 && fixture.componentInstance.bootStatus() !== 'ready'; i++) {
      await Promise.resolve();
    }
    fixture.detectChanges();
    expect(fixture.componentInstance.bootStatus()).toBe('ready');
    expect(fixture.componentInstance.paymentLocked()).toBeFalse();
    expect(fixture.componentInstance.pendingConfigFingerprint()).not.toBeNull();
    expect(fixture.componentInstance.canApplyPendingConfig()).toBeTrue();
    fixture.destroy();
  });

  it('defers configuration changes during processing, pending, and recovery', async () => {
    const fixture = await createPanel();
    const initialCalls = createSession.calls.count();

    state.set('processing');
    fixture.componentRef.setInput('product', { ...PRODUCT, amount: 120 });
    fixture.detectChanges();
    await fixture.whenStable();
    expect(createSession.calls.count()).toBe(initialCalls);
    expect(fixture.componentInstance.pendingConfigFingerprint()).not.toBeNull();

    state.set('ready');
    fixture.detectChanges();
    expect(fixture.componentInstance.canApplyPendingConfig()).toBeTrue();

    const nextSession = {
      ...session,
      id: 'runtime-session-2',
      destroy: jasmine.createSpy('destroy-2').and.resolveTo(),
      initialize: jasmine.createSpy('initialize-2').and.callFake(async () => {
        availableMethods.set([methodStatus('card')]);
        state.set('ready');
      }),
      recoverReturn: jasmine.createSpy('recover-2').and.resolveTo(null),
      selectMethod,
      mount,
      confirm,
    } as unknown as HeadlessCheckoutSession;
    createSession.and.returnValue(nextSession);

    await fixture.componentInstance.applyPendingConfiguration();
    await fixture.whenStable();
    expect(createSession.calls.count()).toBeGreaterThan(initialCalls);
  });

  it('locks method switching while processing', async () => {
    const fixture = await createPanel();
    await fixture.componentInstance.onSelectMethod('card');
    state.set('processing');
    fixture.detectChanges();
    await fixture.componentInstance.onSelectMethod('klarna');
    expect(selectMethod).not.toHaveBeenCalledWith('klarna');
  });

  it('unmounts previous handle and ignores stale mount after destroy', async () => {
    const fixture = await createPanel();
    await fixture.componentInstance.onSelectMethod('card');
    await fixture.componentInstance.onSelectMethod('klarna');
    expect(unmount).toHaveBeenCalled();

    let resolveMount!: (handle: HeadlessMountHandle) => void;
    let started!: () => void;
    const gate = new Promise<void>((resolve) => {
      started = resolve;
    });
    mount.and.callFake(
      () =>
        new Promise<HeadlessMountHandle>((resolve) => {
          started();
          resolveMount = resolve;
        }),
    );
    const pending = fixture.componentInstance.onSelectMethod('card');
    await gate;
    fixture.destroy();
    await Promise.resolve();
    const staleUnmount = jasmine.createSpy('stale-unmount').and.resolveTo();
    resolveMount({ method: 'card', unmount: staleUnmount });
    await pending;
    expect(staleUnmount).toHaveBeenCalled();
  });

  it('keeps theme/locale on createSession and a listbox method structure', async () => {
    const fixture = await createPanel({ theme: 'dark', locale: 'es' });
    expect(createSession.calls.mostRecent().args[0].theme).toBe('dark');
    expect(createSession.calls.mostRecent().args[0].locale).toBe('es');
    expect(fixture.nativeElement.getAttribute('data-theme')).toBe('dark');
    expect(
      (fixture.nativeElement as HTMLElement)
        .querySelector('[data-testid="headless-demo-availability"]')
        ?.getAttribute('role'),
    ).toBe('listbox');
  });

  it('does not expose secrets in the UI', async () => {
    const fixture = await createPanel();
    error$.next(
      new PaymentError({
        code: 'PAYMENT_FAILED',
        message: 'declined client_secret=cs_test_secret_abc sk_test_1234567890',
      }),
    );
    fixture.detectChanges();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).not.toContain('sk_test_1234567890');
    expect(text).not.toContain('cs_test_secret_abc');
    expect(text).toContain('[redacted');
  });

  it('locks mount and confirm while recovery is retryable', async () => {
    setBnplReturnUrl();
    recoverReturn.and.rejectWith(
      new PaymentError({ code: 'SDK_LOAD_FAILED', message: 'stripe.js offline' }),
    );
    const fixture = await createPanel();
    expect(fixture.componentInstance.canRetryRecovery()).toBeTrue();
    expect(fixture.componentInstance.paymentLocked()).toBeTrue();

    await fixture.componentInstance.onSelectMethod('card');
    expect(mount).not.toHaveBeenCalled();
    expect(fixture.componentInstance.canConfirmPayment()).toBeFalse();

    recoverReturn.and.resolveTo({
      status: 'success',
      method: 'klarna',
      provider: 'klarna',
      transactionId: 'pi_after_retry',
    } satisfies PaymentResult);
    await fixture.componentInstance.retryRecoverReturn();
    expect(confirm).not.toHaveBeenCalled();
    expect(fixture.componentInstance.canRetryRecovery()).toBeFalse();
  });

  it('does not confirm until a Stripe element method is mounted', async () => {
    const fixture = await createPanel();
    await fixture.componentInstance.onConfirmPayment();
    expect(confirm).not.toHaveBeenCalled();

    await fixture.componentInstance.onSelectMethod('paypal');
    await fixture.componentInstance.onConfirmPayment();
    expect(confirm).not.toHaveBeenCalled();
  });

  it('blocks confirm and method switching while session is pending', async () => {
    const fixture = await createPanel();
    await fixture.componentInstance.onSelectMethod('card');
    state.set('pending');
    fixture.detectChanges();
    expect(fixture.componentInstance.canConfirmPayment()).toBeFalse();
    await fixture.componentInstance.onSelectMethod('klarna');
    expect(selectMethod).not.toHaveBeenCalledWith('klarna');
  });

  it('never describes authorization-only results as captured funds', async () => {
    const fixture = await createPanel();
    lastResult.set({
      status: 'success',
      method: 'card',
      provider: 'stripe',
      transactionId: 'pi_auth',
      metadata: { authorizationOnly: true },
      message: 'Authorized — capture required on your backend.',
    });
    state.set('success');
    fixture.detectChanges();
    const text =
      (fixture.nativeElement as HTMLElement).querySelector(
        '[data-testid="headless-demo-authorization-only"]',
      )?.textContent ?? '';
    expect(text.toLowerCase()).toContain('not captured');
    expect(text.toLowerCase()).not.toContain('funds captured');
  });

  it('bounds lifecycle event history and sanitizes secret-like error text', async () => {
    const fixture = await createPanel();
    for (let i = 0; i < 20; i++) {
      error$.next(
        new PaymentError({
          code: 'PAYMENT_FAILED',
          message: `fail-${i} sk_live_ABCDEFG123`,
        }),
      );
    }
    fixture.detectChanges();
    expect(fixture.componentInstance.lifecycleEvents().length).toBe(12);
    expect(fixture.componentInstance.lifecycleEvents().join(' ')).not.toContain('sk_live_ABCDEFG123');
  });

  it('surfaces AUTHENTICATION_REQUIRED recovery without success UI', async () => {
    setBnplReturnUrl();
    recoverReturn.and.rejectWith(
      new PaymentError({
        code: 'AUTHENTICATION_REQUIRED',
        message: 'Additional authentication is required.',
        method: 'klarna',
      }),
    );
    const fixture = await createPanel();
    fixture.detectChanges();
    expect(fixture.componentInstance.canRetryRecovery()).toBeFalse();
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('[data-testid="headless-demo-recovery"]')
        ?.textContent,
    ).toContain('AUTHENTICATION_REQUIRED');
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('[data-testid="headless-demo-last-result"]'),
    ).toBeNull();
  });

  it('ignores stale confirm completion after destroy', async () => {
    const fixture = await createPanel();
    await fixture.componentInstance.onSelectMethod('card');
    let release!: () => void;
    confirm.and.returnValue(
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    );
    const pending = fixture.componentInstance.onConfirmPayment();
    fixture.destroy();
    await Promise.resolve();
    release();
    await pending;
    expect(destroy).toHaveBeenCalled();
  });

  it('queues quantity and currency changes while pending without losing them', async () => {
    const fixture = await createPanel();
    const initialCalls = createSession.calls.count();
    state.set('pending');
    fixture.detectChanges();
    fixture.componentRef.setInput('product', {
      ...PRODUCT,
      quantity: 3,
      currency: 'EUR',
      amount: 40,
    });
    fixture.detectChanges();
    await Promise.resolve();
    expect(createSession.calls.count()).toBe(initialCalls);
    expect(fixture.componentInstance.pendingConfigFingerprint()).toContain('"quantity":3');
    expect(fixture.componentInstance.pendingConfigFingerprint()).toContain('"currency":"EUR"');
  });

  it('exposes accessible names for pay and unavailable method reasons', async () => {
    const fixture = await createPanel();
    availableMethods.set([
      methodStatus('card'),
      methodStatus('google-pay', 'unavailable', false, {
        readinessNote: 'Google Pay is not available in this browser.',
      }),
    ]);
    fixture.detectChanges();

    const unavailable = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-method="google-pay"]',
    );
    expect(unavailable?.getAttribute('aria-describedby')).toContain('headless-reason-google-pay');
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('#headless-reason-google-pay')?.textContent,
    ).toContain('Google Pay is not available');

    await fixture.componentInstance.onSelectMethod('card');
    fixture.detectChanges();
    const pay = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="headless-demo-pay"]',
    );
    expect(pay?.textContent).toContain('Pay with card');
    expect(pay?.hasAttribute('disabled')).toBeFalse();
  });
});
