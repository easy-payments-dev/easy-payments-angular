import { TestBed } from '@angular/core/testing';
import { provideHttpClient, withXhr } from '@angular/common/http';
import { PLATFORM_ID } from '@angular/core';
import { provideEasyPayments } from '../config/provide-easy-payments';
import { PaymentError } from '../errors/payment-error';
import type { PaymentMethod, PaymentProduct, PaymentResult } from '../models';
import { MockPaymentController } from '../adapters/mock/mock-payment.controller';
import { StripeCardAdapter } from '../adapters/stripe/stripe-card.adapter';
import { KlarnaAdapter } from '../adapters/klarna/klarna.adapter';
import { AffirmAdapter } from '../adapters/affirm/affirm.adapter';
import { PayPalAdapter } from '../adapters/paypal/paypal.adapter';
import { GooglePayAdapter } from '../adapters/google-pay/google-pay.adapter';
import { ApplePayAdapter } from '../adapters/apple-pay/apple-pay.adapter';
import { StripeRedirectRecoveryService } from '../adapters/stripe/stripe-redirect-recovery.service';
import { PaymentOrchestratorService } from '../services/payment-orchestrator.service';
import { EasyPaymentsHeadless } from './easy-payments-headless.service';
import { HeadlessSessionRegistry } from './headless-session-registry';
import type { HeadlessCheckoutSession } from './headless.types';

const PRODUCT: PaymentProduct = {
  id: 'premium-plan',
  name: 'Premium',
  amount: 99,
  currency: 'USD',
};

/** Headless mock-mode (`enableMockMode: true`) mount / confirm / click flows. */
describe('Headless mock mode', () => {
  let headless: EasyPaymentsHeadless;
  let registry: HeadlessSessionRegistry;
  let controller: MockPaymentController;
  let container: HTMLElement;
  let sessions: HeadlessCheckoutSession[];
  let realAdapterSpies: jasmine.Spy[];

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withXhr()),
        { provide: PLATFORM_ID, useValue: 'browser' },
        provideEasyPayments({ enableMockMode: true, providers: {} }),
      ],
    });
    headless = TestBed.inject(EasyPaymentsHeadless);
    registry = TestBed.inject(HeadlessSessionRegistry);
    registry.clearForTests();
    TestBed.inject(StripeRedirectRecoveryService).resetForTests();
    controller = TestBed.inject(MockPaymentController);
    controller.reset();

    // Real adapters must never be touched in mock mode.
    realAdapterSpies = [
      spyOn(TestBed.inject(StripeCardAdapter), 'createPaymentSession').and.callThrough(),
      spyOn(TestBed.inject(StripeCardAdapter), 'mountPaymentElement').and.callThrough(),
      spyOn(TestBed.inject(KlarnaAdapter), 'createPaymentSession').and.callThrough(),
      spyOn(TestBed.inject(AffirmAdapter), 'createPaymentSession').and.callThrough(),
      spyOn(TestBed.inject(AffirmAdapter), 'mountPaymentElement').and.callThrough(),
      spyOn(TestBed.inject(PayPalAdapter), 'ensureSdkLoaded').and.callThrough(),
      spyOn(TestBed.inject(PayPalAdapter), 'renderButtons').and.callThrough(),
      spyOn(TestBed.inject(PayPalAdapter), 'createOrder').and.callThrough(),
      spyOn(TestBed.inject(GooglePayAdapter), 'renderOfficialButton').and.callThrough(),
      spyOn(TestBed.inject(GooglePayAdapter), 'payWithGooglePay').and.callThrough(),
      spyOn(TestBed.inject(ApplePayAdapter), 'mountExpressCheckout').and.callThrough(),
    ];

    container = document.createElement('div');
    document.body.appendChild(container);
    sessions = [];
  });

  afterEach(async () => {
    for (const session of sessions) {
      await session.destroy();
    }
    container.remove();
    registry.clearForTests();
    TestBed.inject(StripeRedirectRecoveryService).resetForTests();
  });

  async function ready(method: PaymentMethod): Promise<HeadlessCheckoutSession> {
    const session = headless.createSession({ product: PRODUCT, methods: [method] });
    sessions.push(session);
    await session.initialize();
    return session;
  }

  function expectNoRealAdapterCalls(): void {
    for (const spy of realAdapterSpies) {
      expect(spy).not.toHaveBeenCalled();
    }
  }

  function collect(session: HeadlessCheckoutSession) {
    const log = {
      started: 0,
      success: [] as PaymentResult[],
      cancel: [] as PaymentResult[],
      error: [] as PaymentError[],
      pending: [] as PaymentResult[],
    };
    session.events.started.subscribe(() => log.started++);
    session.events.success.subscribe((r) => log.success.push(r));
    session.events.cancel.subscribe((r) => log.cancel.push(r));
    session.events.error.subscribe((e) => log.error.push(e));
    session.events.pending.subscribe((r) => log.pending.push(r));
    return log;
  }

  async function until(predicate: () => boolean, label: string): Promise<void> {
    for (let i = 0; i < 100; i++) {
      if (predicate()) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error(`Timed out waiting for ${label}`);
  }

  function demoButton(): HTMLButtonElement {
    const button = container.querySelector<HTMLButtonElement>(
      '[data-testid="easy-headless-mock-pay"]',
    );
    expect(button).withContext('DEMO wallet button').not.toBeNull();
    return button as HTMLButtonElement;
  }

  describe('confirm-style methods (card / affirm / klarna)', () => {
    it('card: mounts a DEMO panel without calling real adapters', async () => {
      const session = await ready('card');
      const handle = await session.mount('card', container);

      expect(handle.method).toBe('card');
      expect(session.selectedMethod()).toBe('card');
      expect(container.querySelector('[data-easy-headless-mock="card"]')).not.toBeNull();
      expect(container.textContent).toContain('DEMO');
      expect(container.querySelector('[data-testid="easy-headless-mock-pay"]')).toBeNull();
      expectNoRealAdapterCalls();

      await handle.unmount();
      expect(container.querySelector('[data-easy-headless-mock]')).toBeNull();
    });

    it('card: confirm() success emits started + success exactly once', async () => {
      const session = await ready('card');
      const log = collect(session);
      await session.mount('card', container);

      await session.confirm();

      expect(session.state()).toBe('success');
      expect(session.lastResult()?.status).toBe('success');
      expect(session.lastResult()?.metadata?.['mock']).toBeTrue();
      expect(log.started).toBe(1);
      expect(log.success.length).toBe(1);
      expect(log.cancel.length).toBe(0);
      expect(log.error.length).toBe(0);
      expectNoRealAdapterCalls();
    });

    it('card: confirm() cancelled emits cancel exactly once', async () => {
      controller.setOutcome('cancelled');
      const session = await ready('card');
      const log = collect(session);
      await session.mount('card', container);

      await session.confirm();

      expect(session.state()).toBe('cancelled');
      expect(log.cancel.length).toBe(1);
      expect(log.success.length).toBe(0);
      expect(log.error.length).toBe(0);
      expectNoRealAdapterCalls();
    });

    it('card: confirm() failed rejects and emits error exactly once', async () => {
      controller.setOutcome('failed');
      const session = await ready('card');
      const log = collect(session);
      await session.mount('card', container);

      await expectAsync(session.confirm()).toBeRejectedWith(
        jasmine.objectContaining({ code: 'PAYMENT_FAILED' }),
      );

      expect(session.state()).toBe('error');
      expect(session.lastError()?.code).toBe('PAYMENT_FAILED');
      expect(log.error.length).toBe(1);
      expect(log.success.length).toBe(0);
      expect(log.cancel.length).toBe(0);
      expectNoRealAdapterCalls();
    });

    it('card: confirm() before mount is rejected without touching real adapters', async () => {
      const session = await ready('card');
      session.selectMethod('card');
      await expectAsync(session.confirm()).toBeRejectedWith(
        jasmine.objectContaining({ code: 'PROVIDER_UNAVAILABLE' }),
      );
      expectNoRealAdapterCalls();
    });

    it('affirm: mount + confirm success without a stable checkoutInstanceId or backend', async () => {
      const session = await ready('affirm');
      const log = collect(session);
      await session.mount('affirm', container);
      expect(container.querySelector('[data-easy-headless-mock="affirm"]')).not.toBeNull();

      await session.confirm();

      expect(session.state()).toBe('success');
      expect(log.started).toBe(1);
      expect(log.success.length).toBe(1);
      expect(log.error.length).toBe(0);
      expectNoRealAdapterCalls();
    });

    it('affirm: confirm() cancelled emits cancel exactly once', async () => {
      controller.setOutcome('cancelled');
      const session = await ready('affirm');
      const log = collect(session);
      await session.mount('affirm', container);

      await session.confirm();

      expect(session.state()).toBe('cancelled');
      expect(log.cancel.length).toBe(1);
      expect(log.success.length).toBe(0);
      expect(log.error.length).toBe(0);
    });

    it('affirm: confirm() failed rejects and emits error exactly once', async () => {
      controller.setOutcome('failed');
      const session = await ready('affirm');
      const log = collect(session);
      await session.mount('affirm', container);

      await expectAsync(session.confirm()).toBeRejectedWith(
        jasmine.objectContaining({ code: 'PAYMENT_FAILED' }),
      );

      expect(session.state()).toBe('error');
      expect(log.error.length).toBe(1);
      expect(log.success.length).toBe(0);
      expect(log.cancel.length).toBe(0);
    });

    it('klarna: mount + confirm success without real Klarna session creation', async () => {
      const session = await ready('klarna');
      const log = collect(session);
      await session.mount('klarna', container);

      await session.confirm();

      expect(session.state()).toBe('success');
      expect(log.success.length).toBe(1);
      expectNoRealAdapterCalls();
    });

    it('rejects concurrent confirm() while a mock payment is in flight', async () => {
      controller.setDelay(20);
      const session = await ready('card');
      const log = collect(session);
      await session.mount('card', container);

      const first = session.confirm();
      await expectAsync(session.confirm()).toBeRejectedWith(
        jasmine.objectContaining({ code: 'PAYMENT_FAILED' }),
      );
      await first;

      expect(log.started).toBe(1);
      expect(log.success.length).toBe(1);
    });

    it('does not emit terminal events when unmounted mid-flight', async () => {
      controller.setDelay(20);
      const session = await ready('card');
      const log = collect(session);
      const handle = await session.mount('card', container);

      const pending = session.confirm();
      await handle.unmount();
      await pending;

      expect(log.success.length).toBe(0);
      expect(log.error.length).toBe(0);
      expect(log.cancel.length).toBe(0);
      expect(session.state()).toBe('ready');
    });
  });

  describe('wallet-style methods (paypal / google-pay / apple-pay)', () => {
    it('paypal: mounts a DEMO button without PayPal SDK or backend', async () => {
      const session = await ready('paypal');
      const handle = await session.mount('paypal', container);

      expect(demoButton().getAttribute('aria-label')).toContain('PayPal');
      expect(container.textContent).toContain('DEMO');
      expectNoRealAdapterCalls();

      await handle.unmount();
      expect(container.querySelector('[data-easy-headless-mock]')).toBeNull();
    });

    it('paypal: session.confirm() is rejected — payment starts from the DEMO click', async () => {
      const session = await ready('paypal');
      await session.mount('paypal', container);

      await expectAsync(session.confirm()).toBeRejectedWith(
        jasmine.objectContaining({ code: 'CONFIG_INVALID' }),
      );
      expect(session.state()).toBe('ready');
    });

    it('paypal: DEMO click success emits started + success once', async () => {
      const session = await ready('paypal');
      const log = collect(session);
      const orchestrator = TestBed.inject(PaymentOrchestratorService);
      const processSpy = spyOn(orchestrator, 'processPayment').and.callThrough();
      await session.mount('paypal', container);

      demoButton().click();
      await until(() => session.state() === 'success', 'paypal success');

      expect(processSpy).toHaveBeenCalledOnceWith('paypal', PRODUCT, undefined);
      expect(log.started).toBe(1);
      expect(log.success.length).toBe(1);
      expect(log.cancel.length).toBe(0);
      expect(log.error.length).toBe(0);
      expectNoRealAdapterCalls();
    });

    it('paypal: rapid double click starts a single payment', async () => {
      controller.setDelay(20);
      const session = await ready('paypal');
      const log = collect(session);
      const orchestrator = TestBed.inject(PaymentOrchestratorService);
      const processSpy = spyOn(orchestrator, 'processPayment').and.callThrough();
      await session.mount('paypal', container);

      const button = demoButton();
      button.click();
      button.click();
      await until(() => session.state() === 'success', 'paypal success');

      expect(processSpy).toHaveBeenCalledTimes(1);
      expect(log.started).toBe(1);
      expect(log.success.length).toBe(1);
    });

    it('paypal: DEMO click cancelled emits cancel and keeps the button for retry', async () => {
      controller.setOutcome('cancelled');
      const session = await ready('paypal');
      const log = collect(session);
      await session.mount('paypal', container);

      demoButton().click();
      await until(() => log.cancel.length === 1, 'paypal cancel');
      await until(() => session.state() === 'ready', 'ready after cancel');

      expect(log.success.length).toBe(0);
      expect(log.error.length).toBe(0);
      expect(demoButton().disabled).toBeFalse();

      controller.setOutcome('success');
      demoButton().click();
      await until(() => session.state() === 'success', 'retry success');
      expect(log.success.length).toBe(1);
      expect(log.cancel.length).toBe(1);
    });

    it('paypal: DEMO click failed emits error once and keeps the button for retry', async () => {
      controller.setOutcome('failed');
      const session = await ready('paypal');
      const log = collect(session);
      await session.mount('paypal', container);

      demoButton().click();
      await until(() => log.error.length === 1, 'paypal error');
      await until(() => session.state() === 'ready', 'ready after error');

      expect(log.error[0].code).toBe('PAYMENT_FAILED');
      expect(log.success.length).toBe(0);
      expect(log.cancel.length).toBe(0);
      expect(session.lastError()?.code).toBe('PAYMENT_FAILED');
    });

    it('google-pay: DEMO click settles through the orchestrator', async () => {
      const session = await ready('google-pay');
      const log = collect(session);
      await session.mount('google-pay', container);

      demoButton().click();
      await until(() => session.state() === 'success', 'google-pay success');

      expect(log.success.length).toBe(1);
      expectNoRealAdapterCalls();
    });

    it('apple-pay: mounts and settles via DEMO click despite no real Apple Pay config', async () => {
      const session = await ready('apple-pay');
      const log = collect(session);
      await session.mount('apple-pay', container);

      demoButton().click();
      await until(() => session.state() === 'success', 'apple-pay success');

      expect(log.success.length).toBe(1);
      expectNoRealAdapterCalls();
    });
  });

  describe('lifecycle', () => {
    it('remount replaces the previous DEMO surface', async () => {
      const session = headless.createSession({
        product: PRODUCT,
        methods: ['card', 'paypal'],
      });
      sessions.push(session);
      await session.initialize();

      await session.mount('card', container);
      await session.mount('paypal', container);

      expect(container.querySelectorAll('[data-easy-headless-mock]').length).toBe(1);
      expect(container.querySelector('[data-easy-headless-mock="paypal"]')).not.toBeNull();
    });

    it('destroy removes the DEMO surface', async () => {
      const session = await ready('paypal');
      await session.mount('paypal', container);
      await session.destroy();
      expect(container.querySelector('[data-easy-headless-mock]')).toBeNull();
    });

    it('rejects mount when the mock method is made unavailable', async () => {
      controller.setUnavailableMethods(['paypal']);
      const session = await ready('paypal');
      await expectAsync(session.mount('paypal', container)).toBeRejectedWith(
        jasmine.objectContaining({ code: 'PROVIDER_UNAVAILABLE' }),
      );
      expect(container.querySelector('[data-easy-headless-mock]')).toBeNull();
    });
  });
});
