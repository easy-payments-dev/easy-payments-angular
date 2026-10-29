import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideEasyPayments } from '../../config/provide-easy-payments';
import { MockPaymentController } from '../../adapters/mock/mock-payment.controller';
import { BrowserGuard } from '../../utils/browser-guard';
import { FakeBrowserGuard, SAMPLE_PRODUCT } from '../../testing/test-doubles';
import { EasyPaymentsComponent } from '../payments/easy-payments.component';
import { EasyPaymentButtonsComponent } from './easy-payment-buttons.component';
import type { AvailablePaymentMethod } from '../../services/payment-orchestrator.service';
import { StripeCardAdapter } from '../../adapters/stripe/stripe-card.adapter';
import { PayPalAdapter } from '../../adapters/paypal/paypal.adapter';
import { GooglePayAdapter } from '../../adapters/google-pay/google-pay.adapter';
import { PaymentError } from '../../errors/payment-error';
import { PaymentResult } from '../../models';

async function render(fixture: ComponentFixture<EasyPaymentButtonsComponent>): Promise<void> {
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
}

function slotMethods(fixture: ComponentFixture<EasyPaymentButtonsComponent>): string[] {
  return Array.from(
    (fixture.nativeElement as HTMLElement).querySelectorAll('.ep-payment-buttons__item[data-method]'),
  ).map((el) => el.getAttribute('data-method') ?? '');
}

function slotItem(
  fixture: ComponentFixture<EasyPaymentButtonsComponent>,
  method: string,
): HTMLElement | null {
  return (fixture.nativeElement as HTMLElement).querySelector(
    `.ep-payment-buttons__item[data-method="${method}"]`,
  ) as HTMLElement | null;
}

function applyInstanceAvailability(
  fixture: ComponentFixture<EasyPaymentButtonsComponent>,
  results: AvailablePaymentMethod[],
): void {
  (
    fixture.componentInstance as unknown as {
      availabilitySession: { apply: (value: readonly AvailablePaymentMethod[]) => void };
    }
  ).availabilitySession.apply(results);
}

describe('EasyPaymentButtonsComponent', () => {
  let fixture: ComponentFixture<EasyPaymentButtonsComponent>;
  let browser: FakeBrowserGuard;

  beforeEach(async () => {
    browser = new FakeBrowserGuard();
    await TestBed.configureTestingModule({
      imports: [EasyPaymentButtonsComponent, EasyPaymentsComponent],
      providers: [
        provideEasyPayments({ enableMockMode: true, providers: {} }),
        { provide: BrowserGuard, useValue: browser },
      ],
    }).compileComponents();

    TestBed.inject(MockPaymentController).reset();
    fixture = TestBed.createComponent(EasyPaymentButtonsComponent);
    fixture.componentRef.setInput('product', { ...SAMPLE_PRODUCT });
  });

  it('creates the public payment-buttons host', async () => {
    await render(fixture);
    expect(fixture.componentInstance).toBeTruthy();
    const host = fixture.nativeElement as HTMLElement;
    expect(host.classList.contains('ep-payment-buttons-host')).toBeTrue();
    expect(host.querySelector('[data-testid="easy-payment-buttons-root"]')).toBeTruthy();
  });

  it('supports all six payment method IDs in developer order', async () => {
    const methods = [
      'affirm',
      'paypal',
      'card',
      'klarna',
      'google-pay',
      'apple-pay',
    ] as const;
    fixture.componentRef.setInput('methods', [...methods]);
    await render(fixture);

    expect(slotMethods(fixture)).toEqual([...methods]);
  });

  it('shows an interactive Card selector when Card is configured and ready', async () => {
    fixture.componentRef.setInput('methods', ['paypal', 'card', 'klarna']);
    await render(fixture);

    const card = slotItem(fixture, 'card');
    expect(card?.getAttribute('data-interactive')).toBe('true');
    expect(card?.getAttribute('data-kind')).toBe('card-selector');
    expect(card?.getAttribute('data-state')).toBe('available');
    expect(card?.querySelector('button.ep-payment-buttons__selector')).toBeTruthy();
    expect(fixture.nativeElement.getAttribute('data-card-ready')).toBe('true');
  });

  it('mounts mock PayPal in-slot when ready (no extra selector click)', async () => {
    fixture.componentRef.setInput('methods', ['affirm', 'paypal', 'card']);
    await render(fixture);

    const paypal = slotItem(fixture, 'paypal');
    expect(paypal?.getAttribute('data-kind')).toBe('paypal-mock');
    expect(paypal?.getAttribute('data-state')).toBe('available');
    expect(
      paypal?.querySelector('[data-testid="easy-payment-buttons-paypal-mock"]'),
    ).toBeTruthy();
    expect(paypal?.querySelector('easy-mock-method-panel')).toBeTruthy();
    expect(fixture.nativeElement.getAttribute('data-paypal-ready')).toBe('true');
    // No fake selector that reveals PayPal after a second click.
    expect(paypal?.querySelector('button.ep-payment-buttons__selector')).toBeNull();
  });

  it('omits Card when it is not in the methods allow-list', async () => {
    fixture.componentRef.setInput('methods', ['paypal', 'klarna']);
    await render(fixture);

    expect(slotMethods(fixture)).toEqual(['paypal', 'klarna']);
    expect(slotItem(fixture, 'card')).toBeNull();
    expect(fixture.nativeElement.getAttribute('data-card-ready')).toBe('false');
  });

  it('omits PayPal when it is not in the methods allow-list', async () => {
    fixture.componentRef.setInput('methods', ['card', 'klarna']);
    await render(fixture);

    expect(slotMethods(fixture)).toEqual(['card', 'klarna']);
    expect(slotItem(fixture, 'paypal')).toBeNull();
    expect(fixture.nativeElement.getAttribute('data-paypal-ready')).toBe('false');
  });

  it('marks Card unavailable without revealing a payment panel', async () => {
    fixture.componentRef.setInput('methods', ['card', 'paypal']);
    await render(fixture);

    applyInstanceAvailability(fixture, [
      { method: 'card', isMock: true, available: false, status: 'unavailable' },
      { method: 'paypal', isMock: true, available: true, status: 'available' },
    ]);
    fixture.detectChanges();

    const card = slotItem(fixture, 'card');
    expect(card?.getAttribute('data-state')).toBe('unavailable');
    expect(card?.getAttribute('data-kind')).toBe('placeholder');
    expect(
      fixture.nativeElement.querySelector('[data-testid="easy-payment-buttons-card-mock-panel"]'),
    ).toBeNull();
    // PayPal remains usable when Card is unavailable.
    expect(slotItem(fixture, 'paypal')?.getAttribute('data-kind')).toBe('paypal-mock');
  });

  it('marks PayPal unavailable without mounting PayPal controls', async () => {
    fixture.componentRef.setInput('methods', ['paypal', 'card']);
    await render(fixture);

    applyInstanceAvailability(fixture, [
      { method: 'paypal', isMock: true, available: false, status: 'unavailable' },
      { method: 'card', isMock: true, available: true, status: 'available' },
    ]);
    fixture.detectChanges();

    const paypal = slotItem(fixture, 'paypal');
    expect(paypal?.getAttribute('data-state')).toBe('unavailable');
    expect(paypal?.getAttribute('data-kind')).toBe('placeholder');
    expect(
      fixture.nativeElement.querySelector('[data-testid="easy-payment-buttons-paypal-mock"]'),
    ).toBeNull();
    expect(fixture.nativeElement.querySelector('easy-paypal-payment')).toBeNull();
    // Card remains usable when PayPal is unavailable.
    expect(slotItem(fixture, 'card')?.getAttribute('data-kind')).toBe('card-selector');
  });

  it('reveals the mock card panel only after Card is selected (no auto-pay)', async () => {
    const started: unknown[] = [];
    fixture.componentInstance.started.subscribe((value) => started.push(value));

    fixture.componentRef.setInput('methods', ['card', 'paypal']);
    await render(fixture);

    expect(
      fixture.nativeElement.querySelector('[data-testid="easy-payment-buttons-card-mock-panel"]'),
    ).toBeNull();

    const cardButton = slotItem(fixture, 'card')?.querySelector(
      'button.ep-payment-buttons__selector',
    ) as HTMLButtonElement;
    cardButton.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.componentInstance.selectedMethod()).toBe('card');
    expect(
      fixture.nativeElement.querySelector('[data-testid="easy-payment-buttons-card-mock-panel"]'),
    ).toBeTruthy();
    expect(started.length).toBe(0);
  });

  it('emits methodChange on Card selection and lifecycle events on mock pay', async () => {
    const methodChanges: unknown[] = [];
    const started: unknown[] = [];
    const successes: PaymentResult[] = [];
    fixture.componentInstance.methodChange.subscribe((value) => methodChanges.push(value));
    fixture.componentInstance.started.subscribe((value) => started.push(value));
    fixture.componentInstance.success.subscribe((value) => successes.push(value));

    TestBed.inject(MockPaymentController).setOutcome('success');
    fixture.componentRef.setInput('methods', ['card']);
    await render(fixture);

    slotItem(fixture, 'card')?.querySelector('button')?.dispatchEvent(new Event('click'));
    fixture.detectChanges();
    expect(methodChanges.length).toBe(1);
    expect(started.length).toBe(0);

    const pay = fixture.nativeElement.querySelector(
      'button.ep-mock-panel__cta',
    ) as HTMLButtonElement;
    pay.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(started.length).toBe(1);
    expect((started[0] as { method: string }).method).toBe('card');
    expect(successes.length).toBe(1);
    expect(successes[0].status).toBe('success');
  });

  it('emits PayPal mock lifecycle events without premature success', async () => {
    const methodChanges: unknown[] = [];
    const started: unknown[] = [];
    const successes: PaymentResult[] = [];
    const errors: PaymentError[] = [];
    fixture.componentInstance.methodChange.subscribe((value) => methodChanges.push(value));
    fixture.componentInstance.started.subscribe((value) => started.push(value));
    fixture.componentInstance.success.subscribe((value) => successes.push(value));
    fixture.componentInstance.error.subscribe((value) => errors.push(value));

    TestBed.inject(MockPaymentController).setOutcome('success');
    fixture.componentRef.setInput('methods', ['paypal']);
    await render(fixture);

    expect(started.length).toBe(0);
    expect(successes.length).toBe(0);

    const pay = slotItem(fixture, 'paypal')?.querySelector(
      'button.ep-mock-panel__cta',
    ) as HTMLButtonElement;
    pay.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(methodChanges.length).toBe(1);
    expect((methodChanges[0] as { method: string }).method).toBe('paypal');
    expect(started.length).toBe(1);
    expect((started[0] as { method: string }).method).toBe('paypal');
    expect(successes.length).toBe(1);
    expect(successes[0].status).toBe('success');
    expect(errors.length).toBe(0);
  });

  it('emits error on mock PayPal failure without inventing success', async () => {
    const successes: PaymentResult[] = [];
    const errors: PaymentError[] = [];
    fixture.componentInstance.success.subscribe((value) => successes.push(value));
    fixture.componentInstance.error.subscribe((value) => errors.push(value));

    TestBed.inject(MockPaymentController).setOutcome('failed');
    fixture.componentRef.setInput('methods', ['paypal']);
    await render(fixture);

    slotItem(fixture, 'paypal')
      ?.querySelector('button.ep-mock-panel__cta')
      ?.dispatchEvent(new Event('click'));
    await fixture.whenStable();
    fixture.detectChanges();

    expect(successes.length).toBe(0);
    expect(errors.length).toBe(1);
  });

  it('emits error on mock card payment failure without inventing success', async () => {
    const successes: PaymentResult[] = [];
    const errors: PaymentError[] = [];
    fixture.componentInstance.success.subscribe((value) => successes.push(value));
    fixture.componentInstance.error.subscribe((value) => errors.push(value));

    TestBed.inject(MockPaymentController).setOutcome('failed');
    fixture.componentRef.setInput('methods', ['card']);
    await render(fixture);

    slotItem(fixture, 'card')?.querySelector('button')?.dispatchEvent(new Event('click'));
    fixture.detectChanges();
    fixture.nativeElement
      .querySelector('button.ep-mock-panel__cta')
      ?.dispatchEvent(new Event('click'));
    await fixture.whenStable();
    fixture.detectChanges();

    expect(successes.length).toBe(0);
    expect(errors.length).toBe(1);
  });

  it('mounts mock Google Pay in-slot when ready (no extra selector click)', async () => {
    fixture.componentRef.setInput('methods', ['paypal', 'google-pay', 'card', 'affirm']);
    await render(fixture);

    const gpay = slotItem(fixture, 'google-pay');
    expect(gpay?.getAttribute('data-kind')).toBe('google-pay-mock');
    expect(gpay?.getAttribute('data-state')).toBe('available');
    expect(
      gpay?.querySelector('[data-testid="easy-payment-buttons-google-pay-mock"]'),
    ).toBeTruthy();
    expect(gpay?.querySelector('easy-mock-method-panel')).toBeTruthy();
    expect(fixture.nativeElement.getAttribute('data-google-pay-ready')).toBe('true');
    expect(gpay?.querySelector('button.ep-payment-buttons__selector')).toBeNull();
    expect(slotMethods(fixture)).toEqual(['paypal', 'google-pay', 'card', 'affirm']);
  });

  it('omits Google Pay when it is not in the methods allow-list', async () => {
    fixture.componentRef.setInput('methods', ['card', 'paypal']);
    await render(fixture);

    expect(slotItem(fixture, 'google-pay')).toBeNull();
    expect(fixture.nativeElement.getAttribute('data-google-pay-ready')).toBe('false');
  });

  it('marks Google Pay unavailable without mounting Google Pay controls', async () => {
    fixture.componentRef.setInput('methods', ['google-pay', 'card', 'paypal']);
    await render(fixture);

    applyInstanceAvailability(fixture, [
      { method: 'google-pay', isMock: true, available: false, status: 'unavailable' },
      { method: 'card', isMock: true, available: true, status: 'available' },
      { method: 'paypal', isMock: true, available: true, status: 'available' },
    ]);
    fixture.detectChanges();

    const gpay = slotItem(fixture, 'google-pay');
    expect(gpay?.getAttribute('data-state')).toBe('unavailable');
    expect(gpay?.getAttribute('data-kind')).toBe('placeholder');
    expect(
      fixture.nativeElement.querySelector('[data-testid="easy-payment-buttons-google-pay-mock"]'),
    ).toBeNull();
    expect(fixture.nativeElement.querySelector('easy-google-pay-payment')).toBeNull();
    expect(slotItem(fixture, 'card')?.getAttribute('data-kind')).toBe('card-selector');
    expect(slotItem(fixture, 'paypal')?.getAttribute('data-kind')).toBe('paypal-mock');
  });

  it('emits Google Pay mock lifecycle events without premature success', async () => {
    const methodChanges: unknown[] = [];
    const started: unknown[] = [];
    const successes: PaymentResult[] = [];
    fixture.componentInstance.methodChange.subscribe((value) => methodChanges.push(value));
    fixture.componentInstance.started.subscribe((value) => started.push(value));
    fixture.componentInstance.success.subscribe((value) => successes.push(value));

    TestBed.inject(MockPaymentController).setOutcome('success');
    fixture.componentRef.setInput('methods', ['google-pay']);
    await render(fixture);

    expect(started.length).toBe(0);
    expect(successes.length).toBe(0);

    const pay = slotItem(fixture, 'google-pay')?.querySelector(
      'button.ep-mock-panel__cta',
    ) as HTMLButtonElement;
    pay.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(methodChanges.length).toBe(1);
    expect((methodChanges[0] as { method: string }).method).toBe('google-pay');
    expect(started.length).toBe(1);
    expect((started[0] as { method: string }).method).toBe('google-pay');
    expect(successes.length).toBe(1);
    expect(successes[0].status).toBe('success');
  });

  it('keeps Apple Pay / Klarna / Affirm noninteractive placeholders', async () => {
    fixture.componentRef.setInput('methods', [
      'card',
      'paypal',
      'apple-pay',
      'google-pay',
      'klarna',
      'affirm',
    ]);
    await render(fixture);

    for (const method of ['apple-pay', 'klarna', 'affirm']) {
      const item = slotItem(fixture, method);
      expect(item?.getAttribute('data-kind')).toBe('placeholder');
      expect(item?.getAttribute('data-interactive')).toBe('false');
      expect(item?.querySelector('.ep-payment-buttons__placeholder')).toBeTruthy();
      expect(item?.querySelector('button.ep-payment-buttons__selector')).toBeNull();
    }
    expect(slotItem(fixture, 'google-pay')?.getAttribute('data-kind')).toBe('google-pay-mock');
  });

  it('preserves horizontal/vertical layout and developer order with wallets in place', async () => {
    fixture.componentRef.setInput('methods', ['klarna', 'paypal', 'google-pay', 'card']);
    fixture.componentRef.setInput('layout', 'horizontal');
    await render(fixture);

    const host = fixture.nativeElement as HTMLElement;
    expect(slotMethods(fixture)).toEqual(['klarna', 'paypal', 'google-pay', 'card']);
    expect(host.getAttribute('data-layout')).toBe('horizontal');
    expect(host.classList.contains('ep-payment-buttons-host--horizontal')).toBeTrue();
    expect(slotItem(fixture, 'paypal')?.getAttribute('data-kind')).toBe('paypal-mock');
    expect(slotItem(fixture, 'google-pay')?.getAttribute('data-kind')).toBe('google-pay-mock');

    fixture.componentRef.setInput('layout', 'vertical');
    await render(fixture);
    expect(host.getAttribute('data-layout')).toBe('vertical');
    expect(slotMethods(fixture)).toEqual(['klarna', 'paypal', 'google-pay', 'card']);
  });

  it('keeps a permanently transparent host without checkout shell chrome', async () => {
    fixture.componentRef.setInput('methods', ['card', 'paypal']);
    fixture.componentRef.setInput('visualStyle', {
      backgroundColor: '#ff0000',
      surfaceColor: '#ffffff',
    });
    await render(fixture);

    const host = fixture.nativeElement as HTMLElement;
    const bg = getComputedStyle(host).backgroundColor;
    expect(bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent').toBeTrue();
    expect(host.querySelector('.ep-checkout')).toBeNull();
    expect(host.querySelector('easy-checkout-product-summary')).toBeNull();
    expect(host.textContent).not.toContain('Complete your purchase');
  });

  it('keeps independent availability across concurrent button hosts', async () => {
    const fixtureB = TestBed.createComponent(EasyPaymentButtonsComponent);
    fixtureB.componentRef.setInput('product', { ...SAMPLE_PRODUCT, id: 'other-plan' });
    fixture.componentRef.setInput('methods', ['card', 'paypal']);
    fixtureB.componentRef.setInput('methods', ['klarna', 'card']);
    await render(fixture);
    await render(fixtureB);

    expect(slotMethods(fixture)).toEqual(['card', 'paypal']);
    expect(slotMethods(fixtureB)).toEqual(['klarna', 'card']);

    fixture.componentRef.setInput('methods', ['paypal']);
    await render(fixture);
    fixtureB.detectChanges();

    expect(slotMethods(fixture)).toEqual(['paypal']);
    expect(slotMethods(fixtureB)).toEqual(['klarna', 'card']);
  });

  it('does not regress the existing ready-to-use checkout component', async () => {
    const checkout = TestBed.createComponent(EasyPaymentsComponent);
    checkout.componentRef.setInput('product', { ...SAMPLE_PRODUCT });
    checkout.componentRef.setInput('methods', ['card', 'paypal']);
    checkout.detectChanges();
    await checkout.whenStable();
    checkout.detectChanges();

    expect(checkout.nativeElement.querySelector('.ep-checkout')).toBeTruthy();
    expect(checkout.nativeElement.textContent).toContain('Complete your purchase');
    expect(checkout.nativeElement.querySelector('easy-checkout-product-summary')).toBeTruthy();
  });
});

describe('EasyPaymentButtonsComponent real Stripe card panel', () => {
  let fixture: ComponentFixture<EasyPaymentButtonsComponent>;
  let adapter: jasmine.SpyObj<StripeCardAdapter>;

  beforeEach(async () => {
    adapter = jasmine.createSpyObj<StripeCardAdapter>(
      'StripeCardAdapter',
      [
        'initialize',
        'isAvailable',
        'createPayment',
        'ensureStripeLoaded',
        'createPaymentSession',
        'mountPaymentElement',
        'updateAppearance',
        'destroy',
        'confirmPayment',
        'isConfirming',
        'hasMountedElement',
      ],
      {
        provider: 'stripe',
        isMock: false,
      },
    );

    adapter.initialize.and.resolveTo();
    adapter.isAvailable.and.resolveTo(true);
    adapter.ensureStripeLoaded.and.resolveTo({} as never);
    adapter.createPaymentSession.and.resolveTo({ clientSecret: 'pi_secret_buttons' });
    adapter.mountPaymentElement.and.resolveTo();
    adapter.updateAppearance.and.resolveTo();
    adapter.destroy.and.resolveTo();
    adapter.isConfirming.and.returnValue(false);
    adapter.hasMountedElement.and.returnValue(true);

    await TestBed.configureTestingModule({
      imports: [EasyPaymentButtonsComponent],
      providers: [
        provideEasyPayments({
          enableMockMode: false,
          providers: { stripe: { publishableKey: 'pk_test_buttons_card' } },
          backend: { createPaymentUrl: '/api/payments/create' },
        }),
        { provide: BrowserGuard, useValue: new FakeBrowserGuard() },
        { provide: StripeCardAdapter, useValue: adapter },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(EasyPaymentButtonsComponent);
    fixture.componentRef.setInput('product', { ...SAMPLE_PRODUCT });
    fixture.componentRef.setInput('methods', ['card', 'paypal']);
  });

  it('mounts easy-stripe-card-payment after Card selection without auto-confirm', async () => {
    await render(fixture);

    expect(fixture.nativeElement.getAttribute('data-card-ready')).toBe('true');
    expect(fixture.nativeElement.querySelector('easy-stripe-card-payment')).toBeNull();
    expect(adapter.confirmPayment).not.toHaveBeenCalled();

    slotItem(fixture, 'card')?.querySelector('button')?.dispatchEvent(new Event('click'));
    fixture.detectChanges();
    await fixture.whenStable();
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('easy-stripe-card-payment')).toBeTruthy();
    expect(
      fixture.nativeElement.querySelector('[data-testid="easy-payment-buttons-card-panel"]'),
    ).toBeTruthy();
    expect(adapter.confirmPayment).not.toHaveBeenCalled();
    expect(adapter.createPaymentSession).toHaveBeenCalled();
  });
});

describe('EasyPaymentButtonsComponent real PayPal express', () => {
  let fixture: ComponentFixture<EasyPaymentButtonsComponent>;
  let paypal: jasmine.SpyObj<PayPalAdapter>;
  let stripe: jasmine.SpyObj<StripeCardAdapter>;

  beforeEach(async () => {
    paypal = jasmine.createSpyObj<PayPalAdapter>(
      'PayPalAdapter',
      [
        'initialize',
        'isAvailable',
        'createPayment',
        'ensureSdkLoaded',
        'renderButtons',
        'destroyButtons',
        'destroy',
        'createOrder',
        'captureOrder',
        'isBusy',
        'getActiveOrderId',
      ],
      {
        provider: 'paypal',
        isMock: false,
      },
    );
    paypal.initialize.and.resolveTo();
    paypal.isAvailable.and.resolveTo(true);
    paypal.ensureSdkLoaded.and.resolveTo({} as never);
    paypal.renderButtons.and.resolveTo('paypal-buttons-1');
    paypal.destroyButtons.and.resolveTo();
    paypal.destroy.and.resolveTo();
    paypal.isBusy.and.returnValue(false);
    paypal.getActiveOrderId.and.returnValue(null);

    stripe = jasmine.createSpyObj<StripeCardAdapter>(
      'StripeCardAdapter',
      ['initialize', 'isAvailable', 'createPayment', 'destroy'],
      { provider: 'stripe', isMock: false },
    );
    // Stripe unavailable — PayPal must still mount.
    stripe.initialize.and.resolveTo();
    stripe.isAvailable.and.resolveTo(false);

    await TestBed.configureTestingModule({
      imports: [EasyPaymentButtonsComponent],
      providers: [
        provideEasyPayments({
          enableMockMode: false,
          providers: {
            paypal: { clientId: 'sb_test_buttons' },
            stripe: { publishableKey: 'pk_test_unused' },
          },
          backend: {
            createPaymentUrl: '/api/payments/create',
            paypalCreateOrderUrl: '/api/paypal/create',
            paypalCaptureOrderUrl: '/api/paypal/capture',
          },
        }),
        { provide: BrowserGuard, useValue: new FakeBrowserGuard() },
        { provide: PayPalAdapter, useValue: paypal },
        { provide: StripeCardAdapter, useValue: stripe },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(EasyPaymentButtonsComponent);
    fixture.componentRef.setInput('product', { ...SAMPLE_PRODUCT });
    fixture.componentRef.setInput('methods', ['affirm', 'paypal', 'card', 'google-pay']);
  });

  it('mounts official PayPal in the configured slot without auto-capture', async () => {
    await render(fixture);
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();

    expect(slotMethods(fixture)).toEqual(['affirm', 'paypal', 'card', 'google-pay']);
    expect(fixture.nativeElement.getAttribute('data-paypal-ready')).toBe('true');

    const paypalSlot = slotItem(fixture, 'paypal');
    expect(paypalSlot?.getAttribute('data-kind')).toBe('paypal-express');
    expect(
      paypalSlot?.querySelector('[data-testid="easy-payment-buttons-paypal-express"]'),
    ).toBeTruthy();
    expect(paypalSlot?.querySelector('easy-paypal-payment')).toBeTruthy();
    expect(paypalSlot?.querySelector('.ep-paypal--compact')).toBeTruthy();
    expect(paypal.renderButtons).toHaveBeenCalled();
    expect(paypal.captureOrder).not.toHaveBeenCalled();
    expect(paypal.createOrder).not.toHaveBeenCalled();

    // Card stays a selector (unavailable here); wallets stay placeholders.
    expect(slotItem(fixture, 'card')?.getAttribute('data-kind')).toBe('placeholder');
    expect(slotItem(fixture, 'affirm')?.getAttribute('data-kind')).toBe('placeholder');
    expect(slotItem(fixture, 'google-pay')?.getAttribute('data-kind')).toBe('placeholder');
  });

  it('emits methodChange + started on createOrder and success only after capture', async () => {
    const methodChanges: unknown[] = [];
    const started: unknown[] = [];
    const successes: PaymentResult[] = [];
    fixture.componentInstance.methodChange.subscribe((value) => methodChanges.push(value));
    fixture.componentInstance.started.subscribe((value) => started.push(value));
    fixture.componentInstance.success.subscribe((value) => successes.push(value));

    await render(fixture);
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();

    const options = paypal.renderButtons.calls.mostRecent().args[1];
    paypal.createOrder.and.resolveTo('ORDER-BUTTONS-1');
    await options.createOrder!();
    fixture.detectChanges();

    expect(methodChanges.length).toBe(1);
    expect((methodChanges[0] as { method: string }).method).toBe('paypal');
    expect(started.length).toBe(1);
    expect(successes.length).toBe(0);

    paypal.captureOrder.and.resolveTo({
      status: 'success',
      method: 'paypal',
      provider: 'paypal',
      transactionId: 'CAPTURE-BUTTONS-1',
      sessionId: 'ORDER-BUTTONS-1',
    });
    await options.onApprove!({ orderID: 'ORDER-BUTTONS-1' });
    await options.onApprove!({ orderID: 'ORDER-BUTTONS-1' });
    fixture.detectChanges();

    expect(paypal.captureOrder).toHaveBeenCalledTimes(1);
    expect(successes.length).toBe(1);
    expect(started.length).toBe(1);
  });

  it('emits cancel without success and cleans up PayPal mount on destroy', async () => {
    const successes: PaymentResult[] = [];
    const cancels: PaymentResult[] = [];
    fixture.componentInstance.success.subscribe((value) => successes.push(value));
    fixture.componentInstance.cancel.subscribe((value) => cancels.push(value));

    await render(fixture);
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();

    const options = paypal.renderButtons.calls.mostRecent().args[1];
    paypal.createOrder.and.resolveTo('ORDER-CANCEL');
    await options.createOrder!();
    options.onCancel?.();
    fixture.detectChanges();

    expect(cancels.length).toBe(1);
    expect(successes.length).toBe(0);

    fixture.destroy();
    expect(paypal.destroyButtons).toHaveBeenCalledWith('paypal-buttons-1');
    expect(paypal.destroy).not.toHaveBeenCalled();
  });

  it('does not call real PayPal create/capture APIs merely by mounting', async () => {
    await render(fixture);
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();

    expect(paypal.createOrder).not.toHaveBeenCalled();
    expect(paypal.captureOrder).not.toHaveBeenCalled();
  });
});

describe('EasyPaymentButtonsComponent real Google Pay express', () => {
  let fixture: ComponentFixture<EasyPaymentButtonsComponent>;
  let googlePay: jasmine.SpyObj<GooglePayAdapter>;
  let paypal: jasmine.SpyObj<PayPalAdapter>;
  let stripe: jasmine.SpyObj<StripeCardAdapter>;

  beforeEach(async () => {
    googlePay = jasmine.createSpyObj<GooglePayAdapter>(
      'GooglePayAdapter',
      [
        'initialize',
        'isAvailable',
        'createPayment',
        'renderOfficialButton',
        'destroyButtonMount',
        'destroy',
        'payWithGooglePay',
        'clearButtonHost',
        'isProcessing',
      ],
      { provider: 'googlePay', isMock: false },
    );
    googlePay.initialize.and.resolveTo();
    googlePay.isAvailable.and.resolveTo(true);
    googlePay.renderOfficialButton.and.resolveTo('google-pay-button-1');
    googlePay.destroyButtonMount.and.stub();
    googlePay.destroy.and.resolveTo();
    googlePay.isProcessing.and.returnValue(false);

    paypal = jasmine.createSpyObj<PayPalAdapter>(
      'PayPalAdapter',
      [
        'initialize',
        'isAvailable',
        'createPayment',
        'ensureSdkLoaded',
        'renderButtons',
        'destroyButtons',
        'destroy',
        'isBusy',
        'getActiveOrderId',
      ],
      { provider: 'paypal', isMock: false },
    );
    paypal.initialize.and.resolveTo();
    // PayPal stays available when Stripe/Google Pay share Stripe — independence check uses
    // a separate case; here PayPal remains ready while Google Pay is live.
    paypal.isAvailable.and.resolveTo(true);
    paypal.ensureSdkLoaded.and.resolveTo({} as never);
    paypal.renderButtons.and.resolveTo('paypal-buttons-gpay');
    paypal.destroyButtons.and.resolveTo();
    paypal.isBusy.and.returnValue(false);
    paypal.getActiveOrderId.and.returnValue(null);

    stripe = jasmine.createSpyObj<StripeCardAdapter>(
      'StripeCardAdapter',
      ['initialize', 'isAvailable', 'createPayment', 'destroy'],
      { provider: 'stripe', isMock: false },
    );
    stripe.initialize.and.resolveTo();
    stripe.isAvailable.and.resolveTo(true);

    await TestBed.configureTestingModule({
      imports: [EasyPaymentButtonsComponent],
      providers: [
        provideEasyPayments({
          enableMockMode: false,
          providers: {
            stripe: { publishableKey: 'pk_test_gpay_buttons' },
            googlePay: { environment: 'TEST', merchantName: 'Demo' },
            paypal: { clientId: 'sb_gpay_buttons' },
          },
          backend: {
            createPaymentUrl: '/api/payments/create',
            paypalCreateOrderUrl: '/api/paypal/create',
            paypalCaptureOrderUrl: '/api/paypal/capture',
          },
        }),
        { provide: BrowserGuard, useValue: new FakeBrowserGuard() },
        { provide: GooglePayAdapter, useValue: googlePay },
        { provide: PayPalAdapter, useValue: paypal },
        { provide: StripeCardAdapter, useValue: stripe },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(EasyPaymentButtonsComponent);
    fixture.componentRef.setInput('product', { ...SAMPLE_PRODUCT });
    fixture.componentRef.setInput('methods', ['paypal', 'google-pay', 'card', 'affirm']);
  });

  it('mounts official Google Pay in the configured slot without auto-pay', async () => {
    await render(fixture);
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();

    expect(slotMethods(fixture)).toEqual(['paypal', 'google-pay', 'card', 'affirm']);
    expect(fixture.nativeElement.getAttribute('data-google-pay-ready')).toBe('true');

    const gpaySlot = slotItem(fixture, 'google-pay');
    expect(gpaySlot?.getAttribute('data-kind')).toBe('google-pay-express');
    expect(
      gpaySlot?.querySelector('[data-testid="easy-payment-buttons-google-pay-express"]'),
    ).toBeTruthy();
    expect(gpaySlot?.querySelector('easy-google-pay-payment')).toBeTruthy();
    expect(gpaySlot?.querySelector('.ep-gpay--compact')).toBeTruthy();
    expect(googlePay.renderOfficialButton).toHaveBeenCalled();
    expect(googlePay.payWithGooglePay).not.toHaveBeenCalled();

    expect(slotItem(fixture, 'paypal')?.getAttribute('data-kind')).toBe('paypal-express');
    expect(slotItem(fixture, 'card')?.getAttribute('data-kind')).toBe('card-selector');
    expect(slotItem(fixture, 'affirm')?.getAttribute('data-kind')).toBe('placeholder');
  });

  it('emits methodChange + started on click and success only after confirm', async () => {
    const methodChanges: unknown[] = [];
    const started: unknown[] = [];
    const successes: PaymentResult[] = [];
    fixture.componentInstance.methodChange.subscribe((value) => methodChanges.push(value));
    fixture.componentInstance.started.subscribe((value) => started.push(value));
    fixture.componentInstance.success.subscribe((value) => successes.push(value));

    await render(fixture);
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();

    const options = googlePay.renderOfficialButton.calls.mostRecent().args[1];
    expect(started.length).toBe(0);
    expect(successes.length).toBe(0);

    googlePay.payWithGooglePay.and.resolveTo({
      status: 'success',
      method: 'google-pay',
      provider: 'googlePay',
      transactionId: 'pi_gpay_buttons',
    });
    await options.onClick();
    fixture.detectChanges();

    expect(methodChanges.length).toBe(1);
    expect((methodChanges[0] as { method: string }).method).toBe('google-pay');
    expect(started.length).toBe(1);
    expect(successes.length).toBe(1);
    expect(googlePay.payWithGooglePay).toHaveBeenCalledTimes(1);

    await options.onClick();
    fixture.detectChanges();
    // Second click while success/busy should not duplicate terminals.
    expect(successes.length).toBe(1);
  });

  it('emits cancel without success and cleans up Google Pay mount on destroy', async () => {
    const successes: PaymentResult[] = [];
    const cancels: PaymentResult[] = [];
    fixture.componentInstance.success.subscribe((value) => successes.push(value));
    fixture.componentInstance.cancel.subscribe((value) => cancels.push(value));

    await render(fixture);
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();

    const options = googlePay.renderOfficialButton.calls.mostRecent().args[1];
    googlePay.payWithGooglePay.and.rejectWith(
      new PaymentError({
        code: 'PAYMENT_CANCELLED',
        message: 'Buyer cancelled Google Pay.',
        method: 'google-pay',
        provider: 'googlePay',
      }),
    );
    await options.onClick();
    fixture.detectChanges();

    expect(cancels.length).toBe(1);
    expect(successes.length).toBe(0);

    fixture.destroy();
    expect(googlePay.destroyButtonMount).toHaveBeenCalledWith('google-pay-button-1');
    expect(googlePay.destroy).not.toHaveBeenCalled();
  });

  it('keeps PayPal ready when Google Pay is unavailable (Stripe-dependent)', async () => {
    googlePay.isAvailable.and.resolveTo(false);
    await render(fixture);
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();

    expect(slotItem(fixture, 'google-pay')?.getAttribute('data-kind')).toBe('placeholder');
    expect(slotItem(fixture, 'paypal')?.getAttribute('data-kind')).toBe('paypal-express');
    expect(slotItem(fixture, 'card')?.getAttribute('data-kind')).toBe('card-selector');
  });
});

describe('EasyPaymentButtonsComponent Google Pay dual-host cleanup', () => {
  let googlePay: jasmine.SpyObj<GooglePayAdapter>;
  let nextMount = 0;
  const liveMounts = new Set<string>();

  beforeEach(async () => {
    nextMount = 0;
    liveMounts.clear();

    googlePay = jasmine.createSpyObj<GooglePayAdapter>(
      'GooglePayAdapter',
      [
        'initialize',
        'isAvailable',
        'createPayment',
        'renderOfficialButton',
        'destroyButtonMount',
        'destroy',
        'payWithGooglePay',
        'clearButtonHost',
        'isProcessing',
        'getActiveButtonMountCount',
      ],
      { provider: 'googlePay', isMock: false },
    );
    googlePay.initialize.and.resolveTo();
    googlePay.isAvailable.and.resolveTo(true);
    googlePay.isProcessing.and.returnValue(false);
    googlePay.destroy.and.resolveTo();
    googlePay.renderOfficialButton.and.callFake(async (_host, _opts, mountId) => {
      const id = mountId ?? `google-pay-button-${++nextMount}`;
      liveMounts.add(id);
      return id;
    });
    googlePay.destroyButtonMount.and.callFake((mountId?: string) => {
      if (mountId) {
        liveMounts.delete(mountId);
        return;
      }
      liveMounts.clear();
    });
    googlePay.getActiveButtonMountCount.and.callFake(() => liveMounts.size);

    await TestBed.configureTestingModule({
      imports: [EasyPaymentButtonsComponent],
      providers: [
        provideEasyPayments({
          enableMockMode: false,
          providers: {
            stripe: { publishableKey: 'pk_test_dual_gpay' },
            googlePay: { environment: 'TEST', merchantName: 'Demo' },
          },
          backend: { createPaymentUrl: '/api/payments/create' },
        }),
        { provide: BrowserGuard, useValue: new FakeBrowserGuard() },
        { provide: GooglePayAdapter, useValue: googlePay },
      ],
    }).compileComponents();
  });

  it('destroying one Google Pay buttons host leaves the sibling mount intact', async () => {
    const fixtureA = TestBed.createComponent(EasyPaymentButtonsComponent);
    const fixtureB = TestBed.createComponent(EasyPaymentButtonsComponent);
    fixtureA.componentRef.setInput('product', { ...SAMPLE_PRODUCT });
    fixtureB.componentRef.setInput('product', { ...SAMPLE_PRODUCT, id: 'other-plan' });
    fixtureA.componentRef.setInput('methods', ['google-pay']);
    fixtureB.componentRef.setInput('methods', ['google-pay']);

    await render(fixtureA);
    await render(fixtureB);
    await Promise.resolve();
    await Promise.resolve();
    fixtureA.detectChanges();
    fixtureB.detectChanges();

    expect(liveMounts.size).toBe(2);
    expect(
      fixtureA.nativeElement.querySelector('[data-testid="easy-payment-buttons-google-pay-express"]'),
    ).toBeTruthy();
    expect(
      fixtureB.nativeElement.querySelector('[data-testid="easy-payment-buttons-google-pay-express"]'),
    ).toBeTruthy();

    const mountA = googlePay.renderOfficialButton.calls.first().returnValue as Promise<string>;
    const idA = await mountA;

    fixtureA.destroy();
    expect(googlePay.destroyButtonMount).toHaveBeenCalledWith(idA);
    expect(liveMounts.size).toBe(1);
    expect(
      fixtureB.nativeElement.querySelector('[data-testid="easy-payment-buttons-google-pay-express"]'),
    ).toBeTruthy();
    expect(googlePay.destroy).not.toHaveBeenCalled();

    fixtureB.destroy();
    expect(liveMounts.size).toBe(0);
  });
});
