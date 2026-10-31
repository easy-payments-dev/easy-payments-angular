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
import { ApplePayAdapter } from '../../adapters/apple-pay/apple-pay.adapter';
import { KlarnaAdapter } from '../../adapters/klarna/klarna.adapter';
import { AffirmAdapter } from '../../adapters/affirm/affirm.adapter';
import { StripeRedirectRecoveryService } from '../../adapters/stripe/stripe-redirect-recovery.service';
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

  it('exposes selector pressed state and focusable native buttons for keyboard use', async () => {
    fixture.componentRef.setInput('methods', ['card', 'klarna', 'paypal']);
    await render(fixture);

    const card = slotItem(fixture, 'card')?.querySelector(
      'button.ep-payment-buttons__selector',
    ) as HTMLButtonElement;
    const klarna = slotItem(fixture, 'klarna')?.querySelector(
      'button.ep-payment-buttons__selector',
    ) as HTMLButtonElement;
    expect(card.type).toBe('button');
    expect(card.getAttribute('aria-pressed')).toBe('false');
    expect(klarna.getAttribute('aria-pressed')).toBe('false');

    card.focus();
    expect(document.activeElement).toBe(card);
    card.click();
    fixture.detectChanges();
    expect(card.getAttribute('aria-pressed')).toBe('true');
    expect(klarna.getAttribute('aria-pressed')).toBe('false');
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
      'button.ep-mock-panel__strip',
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
      ?.querySelector('button.ep-mock-panel__strip')
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
      'button.ep-mock-panel__strip',
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

  it('mounts mock Apple Pay in-slot when ready (no extra selector click)', async () => {
    fixture.componentRef.setInput('methods', ['paypal', 'apple-pay', 'card', 'google-pay']);
    await render(fixture);

    const apple = slotItem(fixture, 'apple-pay');
    expect(apple?.getAttribute('data-kind')).toBe('apple-pay-mock');
    expect(apple?.getAttribute('data-state')).toBe('available');
    expect(
      apple?.querySelector('[data-testid="easy-payment-buttons-apple-pay-mock"]'),
    ).toBeTruthy();
    expect(apple?.querySelector('button.ep-payment-buttons__selector')).toBeNull();
    expect(slotMethods(fixture)).toEqual(['paypal', 'apple-pay', 'card', 'google-pay']);
  });

  it('omits Apple Pay when it is not in the methods allow-list', async () => {
    fixture.componentRef.setInput('methods', ['card', 'paypal']);
    await render(fixture);
    expect(slotItem(fixture, 'apple-pay')).toBeNull();
    expect(fixture.nativeElement.getAttribute('data-apple-pay-ready')).toBe('false');
  });

  it('emits Apple Pay mock lifecycle events without premature success', async () => {
    const methodChanges: unknown[] = [];
    const started: unknown[] = [];
    const successes: PaymentResult[] = [];
    fixture.componentInstance.methodChange.subscribe((value) => methodChanges.push(value));
    fixture.componentInstance.started.subscribe((value) => started.push(value));
    fixture.componentInstance.success.subscribe((value) => successes.push(value));

    TestBed.inject(MockPaymentController).setOutcome('success');
    fixture.componentRef.setInput('methods', ['apple-pay']);
    await render(fixture);

    expect(started.length).toBe(0);
    expect(successes.length).toBe(0);

    slotItem(fixture, 'apple-pay')
      ?.querySelector('button.ep-mock-panel__strip')
      ?.dispatchEvent(new Event('click'));
    await fixture.whenStable();
    fixture.detectChanges();

    expect(methodChanges.length).toBe(1);
    expect((methodChanges[0] as { method: string }).method).toBe('apple-pay');
    expect(started.length).toBe(1);
    expect(successes.length).toBe(1);
  });

  it('shows interactive Klarna and Affirm selectors when ready (mock mode)', async () => {
    fixture.componentRef.setInput('methods', [
      'klarna',
      'paypal',
      'affirm',
      'card',
    ]);
    await render(fixture);

    const klarna = slotItem(fixture, 'klarna');
    expect(klarna?.getAttribute('data-kind')).toBe('klarna-selector');
    expect(klarna?.getAttribute('data-interactive')).toBe('true');
    expect(klarna?.querySelector('button.ep-payment-buttons__selector')).toBeTruthy();
    expect(fixture.nativeElement.getAttribute('data-klarna-ready')).toBe('true');

    const affirm = slotItem(fixture, 'affirm');
    expect(affirm?.getAttribute('data-kind')).toBe('affirm-selector');
    expect(affirm?.getAttribute('data-interactive')).toBe('true');
    expect(affirm?.querySelector('button.ep-payment-buttons__selector')).toBeTruthy();
    expect(fixture.nativeElement.getAttribute('data-affirm-ready')).toBe('true');

    expect(slotItem(fixture, 'paypal')?.getAttribute('data-kind')).toBe('paypal-mock');
    expect(slotMethods(fixture)).toEqual(['klarna', 'paypal', 'affirm', 'card']);
  });

  it('reveals Klarna mock panel only after selection (no auto-pay)', async () => {
    const started: unknown[] = [];
    const methodChanges: unknown[] = [];
    fixture.componentInstance.started.subscribe((value) => started.push(value));
    fixture.componentInstance.methodChange.subscribe((value) => methodChanges.push(value));

    fixture.componentRef.setInput('methods', ['klarna', 'affirm', 'card']);
    await render(fixture);

    expect(
      fixture.nativeElement.querySelector('[data-testid="easy-payment-buttons-klarna-mock-panel"]'),
    ).toBeNull();

    slotItem(fixture, 'klarna')?.querySelector('button')?.dispatchEvent(new Event('click'));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.componentInstance.selectedMethod()).toBe('klarna');
    expect(methodChanges.length).toBe(1);
    expect((methodChanges[0] as { method: string }).method).toBe('klarna');
    expect(
      fixture.nativeElement.querySelector('[data-testid="easy-payment-buttons-klarna-mock-panel"]'),
    ).toBeTruthy();
    expect(fixture.nativeElement.querySelector('easy-klarna-payment')).toBeNull();
    expect(started.length).toBe(0);
    // Affirm panel stays closed until selected.
    expect(
      fixture.nativeElement.querySelector('[data-testid="easy-payment-buttons-affirm-mock-panel"]'),
    ).toBeNull();
  });

  it('emits methodChange on Affirm selection and lifecycle events on mock pay', async () => {
    const methodChanges: unknown[] = [];
    const started: unknown[] = [];
    const successes: PaymentResult[] = [];
    fixture.componentInstance.methodChange.subscribe((value) => methodChanges.push(value));
    fixture.componentInstance.started.subscribe((value) => started.push(value));
    fixture.componentInstance.success.subscribe((value) => successes.push(value));

    TestBed.inject(MockPaymentController).setOutcome('success');
    fixture.componentRef.setInput('methods', ['affirm', 'klarna']);
    await render(fixture);

    slotItem(fixture, 'affirm')?.querySelector('button')?.dispatchEvent(new Event('click'));
    fixture.detectChanges();
    expect(methodChanges.length).toBe(1);
    expect(started.length).toBe(0);

    fixture.nativeElement
      .querySelector('[data-testid="easy-payment-buttons-affirm-mock-panel"] button.ep-mock-panel__cta')
      ?.dispatchEvent(new Event('click'));
    await fixture.whenStable();
    fixture.detectChanges();

    expect(started.length).toBe(1);
    expect((started[0] as { method: string }).method).toBe('affirm');
    expect(successes.length).toBe(1);
    expect(successes[0].method).toBe('affirm');
  });

  it('keeps Klarna unavailable noninteractive without a panel', async () => {
    fixture.componentRef.setInput('methods', ['klarna', 'paypal']);
    await render(fixture);

    applyInstanceAvailability(fixture, [
      { method: 'klarna', isMock: true, available: false, status: 'unavailable' },
      { method: 'paypal', isMock: true, available: true, status: 'available' },
    ]);
    fixture.detectChanges();

    const klarna = slotItem(fixture, 'klarna');
    expect(klarna?.getAttribute('data-state')).toBe('unavailable');
    expect(klarna?.getAttribute('data-kind')).toBe('placeholder');
    expect(klarna?.getAttribute('data-interactive')).toBe('false');
    expect(
      fixture.nativeElement.querySelector('[data-testid="easy-payment-buttons-klarna-mock-panel"]'),
    ).toBeNull();
    expect(slotItem(fixture, 'paypal')?.getAttribute('data-kind')).toBe('paypal-mock');
  });

  it('omits Klarna and Affirm when not in the methods allow-list', async () => {
    fixture.componentRef.setInput('methods', ['card', 'paypal']);
    await render(fixture);

    expect(slotItem(fixture, 'klarna')).toBeNull();
    expect(slotItem(fixture, 'affirm')).toBeNull();
    expect(fixture.nativeElement.getAttribute('data-klarna-ready')).toBe('false');
    expect(fixture.nativeElement.getAttribute('data-affirm-ready')).toBe('false');
  });

  it('isolates Klarna/Affirm selection across concurrent button hosts', async () => {
    const fixtureB = TestBed.createComponent(EasyPaymentButtonsComponent);
    fixtureB.componentRef.setInput('product', { ...SAMPLE_PRODUCT, id: 'other-plan' });
    fixture.componentRef.setInput('methods', ['klarna', 'card']);
    fixtureB.componentRef.setInput('methods', ['affirm', 'klarna']);
    await render(fixture);
    await render(fixtureB);

    slotItem(fixture, 'klarna')?.querySelector('button')?.dispatchEvent(new Event('click'));
    fixture.detectChanges();
    expect(fixture.componentInstance.selectedMethod()).toBe('klarna');
    expect(fixtureB.componentInstance.selectedMethod()).toBeNull();
    expect(slotMethods(fixtureB)).toEqual(['affirm', 'klarna']);

    slotItem(fixtureB, 'affirm')?.querySelector('button')?.dispatchEvent(new Event('click'));
    fixtureB.detectChanges();
    expect(fixtureB.componentInstance.selectedMethod()).toBe('affirm');
    expect(fixture.componentInstance.selectedMethod()).toBe('klarna');
    fixtureB.destroy();
  });

  it('preserves horizontal/vertical layout and developer order with wallets in place', async () => {
    fixture.componentRef.setInput('methods', [
      'klarna',
      'paypal',
      'apple-pay',
      'google-pay',
      'card',
    ]);
    fixture.componentRef.setInput('layout', 'horizontal');
    await render(fixture);

    const host = fixture.nativeElement as HTMLElement;
    expect(slotMethods(fixture)).toEqual([
      'klarna',
      'paypal',
      'apple-pay',
      'google-pay',
      'card',
    ]);
    expect(host.getAttribute('data-layout')).toBe('horizontal');
    expect(host.classList.contains('ep-payment-buttons-host--horizontal')).toBeTrue();
    expect(slotItem(fixture, 'klarna')?.getAttribute('data-kind')).toBe('klarna-selector');
    expect(slotItem(fixture, 'paypal')?.getAttribute('data-kind')).toBe('paypal-mock');
    expect(slotItem(fixture, 'apple-pay')?.getAttribute('data-kind')).toBe('apple-pay-mock');
    expect(slotItem(fixture, 'google-pay')?.getAttribute('data-kind')).toBe('google-pay-mock');

    fixture.componentRef.setInput('layout', 'vertical');
    await render(fixture);
    expect(host.getAttribute('data-layout')).toBe('vertical');
    expect(slotMethods(fixture)).toEqual([
      'klarna',
      'paypal',
      'apple-pay',
      'google-pay',
      'card',
    ]);
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

  describe('Buttons Only strip redesign', () => {
    it('renders mark-only wallet buttons without duplicated names, DEMO badges, or amounts', async () => {
      fixture.componentRef.setInput('methods', [
        'apple-pay',
        'google-pay',
        'paypal',
        'card',
        'klarna',
        'affirm',
      ]);
      await render(fixture);

      const root = fixture.nativeElement as HTMLElement;
      expect(root.textContent).not.toMatch(/\$\d/);
      expect(root.querySelector('.ep-mock-panel__title')).toBeNull();
      expect(root.querySelector('.ep-checkout__title')).toBeNull();
      expect(root.querySelector('.ep-payment-buttons__demo')).toBeNull();
      expect(root.querySelector('.ep-mock-panel__strip-demo')).toBeNull();
      expect(root.querySelector('.ep-mock-panel__strip-label')).toBeNull();
      expect(root.querySelector('[data-testid="easy-payment-buttons-demo-notice"]')?.textContent).toContain(
        'Demo mode',
      );
      expect(slotItem(fixture, 'paypal')?.querySelector('button.ep-mock-panel__strip')).toBeTruthy();
      expect(slotItem(fixture, 'paypal')?.querySelector('button.ep-mock-panel__cta')).toBeNull();
      // Wallet brand marks — no duplicated visible provider text beside the mark.
      for (const method of ['paypal', 'klarna', 'affirm', 'apple-pay', 'google-pay'] as const) {
        const label = slotItem(fixture, method)?.querySelector('.ep-payment-buttons__label');
        expect(label).toBeNull();
      }
      // Card uses a compact visible label because the generic icon does not name the method.
      const cardBtn = slotItem(fixture, 'card')?.querySelector(
        'button.ep-payment-buttons__selector',
      ) as HTMLButtonElement;
      expect(cardBtn).toBeTruthy();
      expect(cardBtn.getAttribute('aria-label')).toContain('Card');
      expect(cardBtn.querySelector('.ep-payment-buttons__label')?.textContent?.trim()).toBe('Card');
      cardBtn.click();
      fixture.detectChanges();
      expect(cardBtn.classList.contains('ep-payment-buttons__selector--selected')).toBeTrue();
      expect(cardBtn.getAttribute('aria-pressed')).toBe('true');
    });

    it('places Card / Klarna / Affirm panels below the strip and only one at a time', async () => {
      fixture.componentRef.setInput('methods', ['card', 'klarna', 'affirm', 'paypal']);
      await render(fixture);

      const root = fixture.nativeElement as HTMLElement;
      const list = root.querySelector('.ep-payment-buttons__list');
      expect(list).toBeTruthy();

      slotItem(fixture, 'card')?.querySelector('button')?.dispatchEvent(new Event('click'));
      fixture.detectChanges();
      const cardPanel = root.querySelector(
        '[data-testid="easy-payment-buttons-card-mock-panel"]',
      ) as HTMLElement;
      expect(cardPanel).toBeTruthy();
      expect(
        list!.compareDocumentPosition(cardPanel) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(cardPanel.textContent).toContain('Complete demo payment');
      expect(cardPanel.textContent).not.toMatch(/Pay \$/);
      expect(root.querySelector('[data-testid="easy-payment-buttons-klarna-mock-panel"]')).toBeNull();

      slotItem(fixture, 'klarna')?.querySelector('button')?.dispatchEvent(new Event('click'));
      fixture.detectChanges();
      expect(root.querySelector('[data-testid="easy-payment-buttons-card-mock-panel"]')).toBeNull();
      expect(root.querySelector('[data-testid="easy-payment-buttons-klarna-mock-panel"]')).toBeTruthy();
      expect(root.querySelectorAll('.ep-payment-buttons__panel').length).toBe(1);
    });

    it('applies horizontal layout, separators, borderless selectors, and custom radius', async () => {
      fixture.componentRef.setInput('layout', 'horizontal');
      fixture.componentRef.setInput('buttonsAppearance', {
        separators: 'line',
        border: 'none',
        borderRadius: '999px',
        gap: '16px',
        padding: '8px',
        background: 'transparent',
      });
      fixture.componentRef.setInput('methods', ['card', 'paypal', 'klarna']);
      await render(fixture);

      const host = fixture.nativeElement as HTMLElement;
      expect(host.getAttribute('data-layout')).toBe('horizontal');
      expect(host.getAttribute('data-separators')).toBe('line');
      expect(host.style.getPropertyValue('--ep-buttons-gap')).toBe('16px');
      expect(host.style.getPropertyValue('--ep-buttons-padding')).toBe('8px');
      expect(host.style.getPropertyValue('--ep-buttons-radius')).toBe('999px');
      expect(host.style.getPropertyValue('--ep-buttons-strip-bg')).toBe('transparent');
      expect(host.querySelector('.ep-payment-buttons--borderless')).toBeTruthy();
      expect(host.querySelectorAll('.ep-payment-buttons__separator').length).toBe(2);
    });

    it('localizes English and Spanish confirm labels and demo notice', async () => {
      fixture.componentRef.setInput('methods', ['card', 'paypal']);
      fixture.componentRef.setInput('locale', 'en');
      await render(fixture);

      expect(
        (fixture.nativeElement as HTMLElement).querySelector(
          '[data-testid="easy-payment-buttons-demo-notice"]',
        )?.textContent,
      ).toContain('Demo mode');

      slotItem(fixture, 'card')?.querySelector('button')?.dispatchEvent(new Event('click'));
      fixture.detectChanges();
      expect(
        (fixture.nativeElement as HTMLElement).querySelector(
          '[data-testid="easy-payment-buttons-card-mock-panel"]',
        )?.textContent,
      ).toContain('Complete demo payment');

      fixture.componentRef.setInput('locale', 'es');
      await render(fixture);
      expect(
        (fixture.nativeElement as HTMLElement).querySelector(
          '[data-testid="easy-payment-buttons-demo-notice"]',
        )?.textContent,
      ).toContain('Modo demo');
      slotItem(fixture, 'card')?.querySelector('button')?.dispatchEvent(new Event('click'));
      fixture.detectChanges();
      const esPanel = (fixture.nativeElement as HTMLElement).querySelector(
        '[data-testid="easy-payment-buttons-card-mock-panel"]',
      );
      expect(esPanel?.textContent).toContain('Completar pago de demostración');
      expect(fixture.nativeElement.getAttribute('data-locale')).toBe('es');
      expect(fixture.nativeElement.getAttribute('lang')).toBe('es');
      expect(
        slotItem(fixture, 'card')?.querySelector('button')?.getAttribute('aria-label'),
      ).toContain('Tarjeta');
    });

    it('labels the demo confirm CTA as a demo payment with no real charge', async () => {
      fixture.componentRef.setInput('methods', ['card']);
      await render(fixture);
      slotItem(fixture, 'card')?.querySelector('button')?.dispatchEvent(new Event('click'));
      fixture.detectChanges();

      const cta = (fixture.nativeElement as HTMLElement).querySelector(
        '[data-testid="easy-payment-buttons-card-mock-panel"] button.ep-mock-panel__cta',
      );
      expect(cta?.textContent?.trim()).toBe('Complete demo payment');
      expect(cta?.getAttribute('aria-label')).toContain('no real charge');
    });

    it('collapses unavailable methods out of the strip and hides them from assistive tech', async () => {
      fixture.componentRef.setInput('methods', ['card', 'apple-pay', 'paypal']);
      await render(fixture);
      applyInstanceAvailability(fixture, [
        { method: 'card', isMock: true, available: true, status: 'available' },
        { method: 'apple-pay', isMock: false, available: false, status: 'unavailable' },
        { method: 'paypal', isMock: true, available: true, status: 'available' },
      ]);
      fixture.detectChanges();

      const apple = slotItem(fixture, 'apple-pay')!;
      expect(apple.classList.contains('ep-payment-buttons__item--collapsed')).toBeTrue();
      expect(apple.getAttribute('aria-hidden')).toBe('true');
      expect(apple.getBoundingClientRect().height).toBe(0);
      expect(getComputedStyle(apple).position).toBe('absolute');

      const card = slotItem(fixture, 'card')!;
      expect(card.classList.contains('ep-payment-buttons__item--collapsed')).toBeFalse();
      expect(card.getAttribute('aria-hidden')).toBeNull();
    });

    it('draws separators only between visible slots', async () => {
      fixture.componentRef.setInput('buttonsAppearance', { separators: 'line' });
      fixture.componentRef.setInput('methods', ['card', 'paypal', 'klarna']);
      await render(fixture);
      applyInstanceAvailability(fixture, [
        { method: 'card', isMock: true, available: true, status: 'available' },
        { method: 'paypal', isMock: true, available: true, status: 'available' },
        { method: 'klarna', isMock: true, available: false, status: 'unavailable' },
      ]);
      fixture.detectChanges();

      // card | paypal — no trailing separator before the collapsed Klarna slot.
      expect(
        (fixture.nativeElement as HTMLElement).querySelectorAll('.ep-payment-buttons__separator')
          .length,
      ).toBe(1);
    });

    it('shows one status message when no requested method is available', async () => {
      fixture.componentRef.setInput('methods', ['card', 'paypal']);
      await render(fixture);
      applyInstanceAvailability(fixture, [
        { method: 'card', isMock: true, available: false, status: 'unavailable' },
        { method: 'paypal', isMock: true, available: false, status: 'unavailable' },
      ]);
      fixture.detectChanges();

      const empty = (fixture.nativeElement as HTMLElement).querySelector(
        '[data-testid="easy-payment-buttons-empty"]',
      );
      expect(empty?.getAttribute('role')).toBe('status');
      expect(empty?.textContent).toContain('No payment methods are available');
    });

    it('gives every horizontal slot the same fixed width without flex-grow', async () => {
      const host = fixture.nativeElement as HTMLElement;
      host.style.display = 'block';
      host.style.width = '600px';
      document.body.appendChild(host);
      fixture.componentRef.setInput('layout', 'horizontal');
      fixture.componentRef.setInput('methods', ['card', 'paypal', 'google-pay', 'klarna', 'affirm']);
      await render(fixture);

      const widths = ['card', 'paypal', 'google-pay', 'klarna', 'affirm'].map((m) =>
        Math.round(slotItem(fixture, m)!.getBoundingClientRect().width),
      );
      // 600px fits three 160px slots per row; the two on the last row must not stretch.
      expect(new Set(widths).size).toBe(1);
      expect(widths[0]).toBe(160);
      expect(getComputedStyle(slotItem(fixture, 'affirm')!).flexGrow).toBe('0');
      host.remove();
    });

    it('maps a fixed buttonWidth onto every horizontal slot', async () => {
      fixture.componentRef.setInput('layout', 'horizontal');
      fixture.componentRef.setInput('buttonsAppearance', { buttonWidth: '180px' });
      await render(fixture);
      expect(
        (fixture.nativeElement as HTMLElement).style.getPropertyValue('--ep-buttons-slot-width'),
      ).toBe('180px');

      fixture.componentRef.setInput('buttonsAppearance', { buttonWidth: '100%' });
      await render(fixture);
      expect(
        (fixture.nativeElement as HTMLElement).style.getPropertyValue('--ep-buttons-slot-width'),
      ).toBe('');
    });

    it('keeps library-owned selectors keyboard-focusable with a focus-visible outline rule', async () => {
      fixture.componentRef.setInput('methods', ['card', 'klarna']);
      await render(fixture);

      const btn = slotItem(fixture, 'card')!.querySelector(
        'button.ep-payment-buttons__selector',
      ) as HTMLButtonElement;
      expect(btn.disabled).toBeFalse();
      expect(btn.tabIndex).toBeGreaterThanOrEqual(0);

      // Angular injects component styles into <style> tags (selectors are attribute-encoded).
      const styleText = Array.from(document.querySelectorAll('style'))
        .map((el) => el.textContent ?? '')
        .join('\n');
      expect(styleText).toMatch(
        /ep-payment-buttons__selector[^{]*:focus-visible[^{]*\{[^}]*outline:\s*2px\s+solid/,
      );
    });

    it('keeps the selected Card selector opaque so dark text never sits on the page backdrop', async () => {
      const host = fixture.nativeElement as HTMLElement;
      document.body.appendChild(host);
      fixture.componentRef.setInput('theme', 'dark');
      fixture.componentRef.setInput('methods', ['card']);
      await render(fixture);

      const btn = slotItem(fixture, 'card')!.querySelector(
        'button.ep-payment-buttons__selector',
      ) as HTMLButtonElement;
      btn.click();
      fixture.detectChanges();

      const probe = document.createElement('div');
      probe.style.background = getComputedStyle(btn).backgroundColor;
      document.body.appendChild(probe);
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, 1, 1);
      ctx.fillStyle = getComputedStyle(probe).backgroundColor;
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b] = Array.from(ctx.getImageData(0, 0, 1, 1).data);
      probe.remove();
      host.remove();

      // Composited over white, a dark-theme selected fill must stay dark
      // (the old translucent rgba fill came out near-white behind #f8fafc text).
      const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      expect(luminance).toBeLessThan(0.3);
    });

    it('uses accent-based CTA tokens in dark theme instead of pale near-white', async () => {
      const host = fixture.nativeElement as HTMLElement;
      fixture.componentRef.setInput('theme', 'dark');
      await render(fixture);

      expect(host.classList.contains('ep-theme-dark')).toBeTrue();
      const ctaBg = getComputedStyle(host).getPropertyValue('--ep-cta-bg').trim();
      const ctaText = getComputedStyle(host).getPropertyValue('--ep-cta-text').trim();
      const accent = getComputedStyle(host).getPropertyValue('--ep-accent').trim();

      expect(ctaBg.toLowerCase()).not.toBe('#f8fafc');
      expect(ctaBg).toContain('color-mix');
      expect(ctaBg).toContain(accent);
      expect(ctaText.toLowerCase()).toBe('#f8fafc');

      fixture.componentRef.setInput('theme', 'light');
      await render(fixture);
      expect(getComputedStyle(host).getPropertyValue('--ep-cta-bg').trim().toLowerCase()).toBe(
        '#0f172a',
      );
    });
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

  it('labels the real card confirm CTA "Pay with card" without the amount', async () => {
    await render(fixture);
    slotItem(fixture, 'card')?.querySelector('button')?.dispatchEvent(new Event('click'));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const cta = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="easy-payment-buttons-card-panel"] button.ep-stripe-card__pay',
    );
    expect(cta?.textContent?.trim()).toBe('Pay with card');
    expect(cta?.textContent).not.toMatch(/\$\d/);
    expect(adapter.confirmPayment).not.toHaveBeenCalled();
  });

  it('keeps a high-contrast dark-theme Card CTA when enabled and still readable when disabled', async () => {
    const host = fixture.nativeElement as HTMLElement;
    document.body.appendChild(host);
    fixture.componentRef.setInput('theme', 'dark');
    await render(fixture);
    slotItem(fixture, 'card')?.querySelector('button')?.dispatchEvent(new Event('click'));
    fixture.detectChanges();
    await fixture.whenStable();
    await Promise.resolve();
    fixture.detectChanges();

    const cta = host.querySelector(
      '[data-testid="easy-payment-buttons-card-panel"] button.ep-stripe-card__pay',
    ) as HTMLButtonElement;
    expect(cta).toBeTruthy();

    // Enabled (session ready): solid accent fill, not washed-out near-white.
    expect(cta.disabled).toBeFalse();
    const enabledBg = getComputedStyle(cta).backgroundColor;
    expect(enabledBg).not.toBe('rgba(0, 0, 0, 0)');
    expect(enabledBg).not.toMatch(/rgba?\(\s*248\s*,\s*250\s*,\s*252/i);

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;
    const sample = (css: string) => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = css;
      ctx.fillRect(0, 0, 1, 1);
      return Array.from(ctx.getImageData(0, 0, 1, 1).data);
    };
    const [er, eg, eb] = sample(enabledBg);
    const enabledLum = (0.2126 * er + 0.7152 * eg + 0.0722 * eb) / 255;
    // Deepened accent CTA; pale #f8fafc was ~0.98 luminance.
    expect(enabledLum).toBeLessThan(0.55);
    expect(enabledLum).toBeGreaterThan(0.12);

    // Disabled must stay opaque and distinct from the enabled fill.
    adapter.hasMountedElement.and.returnValue(false);
    cta.disabled = true;
    fixture.detectChanges();
    expect(getComputedStyle(cta).opacity).toBe('1');
    const disabledBg = getComputedStyle(cta).backgroundColor;
    expect(disabledBg).not.toBe(enabledBg);
    host.remove();
  });

  it('emits success without rendering application-level outcome banners in the panel', async () => {
    adapter.confirmPayment.and.resolveTo({
      status: 'success',
      method: 'card',
      provider: 'stripe',
      transactionId: 'pi_buttons_ok',
    });

    const successes: PaymentResult[] = [];
    fixture.componentInstance.success.subscribe((result) => successes.push(result));

    await render(fixture);
    slotItem(fixture, 'card')?.querySelector('button')?.dispatchEvent(new Event('click'));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const cta = fixture.nativeElement.querySelector(
      'button.ep-stripe-card__pay',
    ) as HTMLButtonElement;
    cta.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(successes).toEqual([
      jasmine.objectContaining({
        status: 'success',
        method: 'card',
        transactionId: 'pi_buttons_ok',
      }),
    ]);
    const panel = fixture.nativeElement.querySelector(
      '[data-testid="easy-payment-buttons-card-panel"]',
    ) as HTMLElement;
    expect(panel.querySelector('.ep-stripe-card__success')).toBeNull();
    expect(panel.querySelector('easy-checkout-outcome')).toBeNull();
    expect(panel.textContent).not.toContain('Payment completed');
    expect(panel.textContent).not.toContain('Payment failed');
    expect(panel.textContent).not.toContain('Payment cancelled');
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
    expect(paypal.renderButtons.calls.mostRecent().args[1]).toEqual(
      jasmine.objectContaining({ fundingSource: 'paypal' }),
    );
    expect(paypal.captureOrder).not.toHaveBeenCalled();
    expect(paypal.createOrder).not.toHaveBeenCalled();

    // Unconfigured Stripe-backed methods stay unavailable placeholders.
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

  it('emits PayPal errors without inserting a strip outcome banner', async () => {
    const errors: unknown[] = [];
    fixture.componentInstance.error.subscribe((value) => errors.push(value));

    await render(fixture);
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();

    const options = paypal.renderButtons.calls.mostRecent().args[1];
    options.onError?.(new Error('INSTRUMENT_DECLINED'));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(errors.length).toBe(1);
    expect(fixture.nativeElement.querySelector('.ep-paypal__error')).toBeNull();
    expect(fixture.nativeElement.querySelector('.ep-paypal--compact')).toBeTruthy();
    expect((fixture.nativeElement as HTMLElement).textContent).not.toMatch(
      /unable|failed|declined/i,
    );
  });

  it('keeps express PayPal focus-within host outlines suppressed', async () => {
    await render(fixture);
    const styleText = Array.from(document.querySelectorAll('style'))
      .map((el) => el.textContent ?? '')
      .join('\n');
    // Angular encodes host attrs between class and pseudo (:focus-within).
    expect(styleText).toMatch(
      /ep-payment-buttons__express[^{]*:focus-within[^{]*\{[^}]*outline:\s*none/,
    );
    expect(styleText).toMatch(
      /paypal-express[^{]*:focus-within[^{]*\{[^}]*outline:\s*none/,
    );
    expect(styleText).toMatch(
      /paypal-express[^{]*iframe[^{]*:focus-visible[^{]*\{[^}]*outline:\s*none/,
    );
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
    expect(googlePay.renderOfficialButton.calls.mostRecent().args[1]).toEqual(
      jasmine.objectContaining({ compact: true }),
    );
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

describe('EasyPaymentButtonsComponent real Apple Pay express', () => {
  let fixture: ComponentFixture<EasyPaymentButtonsComponent>;
  let applePay: jasmine.SpyObj<ApplePayAdapter>;
  let paypal: jasmine.SpyObj<PayPalAdapter>;

  beforeEach(async () => {
    applePay = jasmine.createSpyObj<ApplePayAdapter>(
      'ApplePayAdapter',
      [
        'initialize',
        'isAvailable',
        'isConfigured',
        'createMountId',
        'mountExpressCheckout',
        'unmountExpressCheckout',
        'destroy',
        'isProcessing',
        'getAvailabilityStatus',
        'setAvailabilityListener',
        'addAvailabilityListener',
        'createPayment',
      ],
      { provider: 'applePay', isMock: false },
    );
    applePay.initialize.and.resolveTo();
    applePay.isConfigured.and.returnValue(true);
    applePay.addAvailabilityListener.and.returnValue(() => undefined);
    applePay.createMountId.and.returnValue('apple-pay-ece-buttons-1');
    applePay.getAvailabilityStatus.and.returnValue('available');
    applePay.isAvailable.and.resolveTo(true);
    applePay.isProcessing.and.returnValue(false);
    applePay.mountExpressCheckout.and.callFake(async (_host, options, mountId) => {
      options.onReady?.();
      return mountId ?? 'apple-pay-ece-buttons-1';
    });

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
    paypal.isAvailable.and.resolveTo(true);
    paypal.ensureSdkLoaded.and.resolveTo({} as never);
    paypal.renderButtons.and.resolveTo('paypal-buttons-apay');
    paypal.destroyButtons.and.resolveTo();
    paypal.isBusy.and.returnValue(false);
    paypal.getActiveOrderId.and.returnValue(null);

    await TestBed.configureTestingModule({
      imports: [EasyPaymentButtonsComponent],
      providers: [
        provideEasyPayments({
          enableMockMode: false,
          providers: {
            stripe: { publishableKey: 'pk_test_apay_buttons' },
            applePay: { merchantName: 'Demo' },
            paypal: { clientId: 'sb_apay_buttons' },
          },
          backend: {
            createPaymentUrl: '/api/payments/create',
            paypalCreateOrderUrl: '/api/paypal/create',
            paypalCaptureOrderUrl: '/api/paypal/capture',
          },
        }),
        { provide: BrowserGuard, useValue: new FakeBrowserGuard() },
        { provide: ApplePayAdapter, useValue: applePay },
        { provide: PayPalAdapter, useValue: paypal },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(EasyPaymentButtonsComponent);
    fixture.componentRef.setInput('product', { ...SAMPLE_PRODUCT });
    fixture.componentRef.setInput('methods', ['paypal', 'apple-pay', 'card', 'affirm']);
  });

  it('mounts compact Apple Pay ECE in the configured slot without auto-confirm', async () => {
    await render(fixture);
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();

    expect(slotMethods(fixture)).toEqual(['paypal', 'apple-pay', 'card', 'affirm']);
    const appleSlot = slotItem(fixture, 'apple-pay');
    expect(appleSlot?.getAttribute('data-kind')).toBe('apple-pay-express');
    expect(
      appleSlot?.querySelector('[data-testid="easy-payment-buttons-apple-pay-express"]'),
    ).toBeTruthy();
    expect(appleSlot?.querySelector('easy-apple-pay-payment')).toBeTruthy();
    expect(appleSlot?.querySelector('.ep-apay--compact')).toBeTruthy();
    expect(applePay.mountExpressCheckout).toHaveBeenCalled();
    expect(applePay.mountExpressCheckout.calls.mostRecent().args[2]).toBe(
      'apple-pay-ece-buttons-1',
    );
    expect(slotItem(fixture, 'paypal')?.getAttribute('data-kind')).toBe('paypal-express');
    expect(slotItem(fixture, 'affirm')?.getAttribute('data-kind')).toBe('placeholder');
  });

  it('emits methodChange + started on confirm attempt and success only after Stripe confirm', async () => {
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

    const options = applePay.mountExpressCheckout.calls.mostRecent().args[1];
    expect(started.length).toBe(0);
    expect(successes.length).toBe(0);

    options.onAttempt?.();
    fixture.detectChanges();
    expect(methodChanges.length).toBe(1);
    expect((methodChanges[0] as { method: string }).method).toBe('apple-pay');
    expect(started.length).toBe(1);
    expect(successes.length).toBe(0);

    options.onSuccess({
      status: 'success',
      method: 'apple-pay',
      provider: 'applePay',
      transactionId: 'pi_apay_buttons',
    });
    options.onSuccess({
      status: 'success',
      method: 'apple-pay',
      provider: 'applePay',
      transactionId: 'pi_apay_buttons',
    });
    fixture.detectChanges();
    expect(successes.length).toBe(1);
  });

  it('emits cancel without success and cleans up owned ECE mount on destroy', async () => {
    const successes: PaymentResult[] = [];
    const cancels: PaymentResult[] = [];
    fixture.componentInstance.success.subscribe((value) => successes.push(value));
    fixture.componentInstance.cancel.subscribe((value) => cancels.push(value));

    await render(fixture);
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();

    const options = applePay.mountExpressCheckout.calls.mostRecent().args[1];
    options.onAttempt?.();
    options.onCancel();
    fixture.detectChanges();
    expect(cancels.length).toBe(1);
    expect(successes.length).toBe(0);

    fixture.destroy();
    expect(applePay.unmountExpressCheckout).toHaveBeenCalledWith({
      preserveAvailability: true,
      mountId: 'apple-pay-ece-buttons-1',
    });
    expect(applePay.destroy).not.toHaveBeenCalled();
  });

  it('keeps PayPal ready when Apple Pay ECE reports unavailable', async () => {
    applePay.isAvailable.and.resolveTo(false);
    applePay.getAvailabilityStatus.and.returnValue('unavailable');
    applePay.mountExpressCheckout.and.callFake(async (_host, options, mountId) => {
      options.onUnavailable?.();
      return mountId ?? 'apple-pay-ece-buttons-1';
    });

    await render(fixture);
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();

    expect(slotItem(fixture, 'apple-pay')?.getAttribute('data-kind')).toBe('apple-pay-express');
    expect(slotItem(fixture, 'paypal')?.getAttribute('data-kind')).toBe('paypal-express');
  });

  it('renders no in-strip Apple Pay unavailable text; the slot collapses instead', async () => {
    applePay.isAvailable.and.resolveTo(false);
    applePay.getAvailabilityStatus.and.returnValue('unavailable');
    applePay.mountExpressCheckout.and.callFake(async (_host, options, mountId) => {
      options.onUnavailable?.();
      return mountId ?? 'apple-pay-ece-buttons-1';
    });

    await render(fixture);
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();

    const apple = slotItem(fixture, 'apple-pay')!;
    expect(apple.querySelector('.ep-apay__status')).toBeNull();
    expect(apple.textContent?.trim()).toBe('');
    expect(apple.classList.contains('ep-payment-buttons__item--collapsed')).toBeTrue();
    // ECE host stays mounted so a later eligibility change can still be reported.
    expect(apple.querySelector('easy-apple-pay-payment')).toBeTruthy();
  });
});

describe('EasyPaymentButtonsComponent Apple Pay dual-host cleanup', () => {
  let applePay: jasmine.SpyObj<ApplePayAdapter>;
  let nextMount = 0;
  const liveMounts = new Set<string>();

  beforeEach(async () => {
    nextMount = 0;
    liveMounts.clear();

    applePay = jasmine.createSpyObj<ApplePayAdapter>(
      'ApplePayAdapter',
      [
        'initialize',
        'isAvailable',
        'isConfigured',
        'createMountId',
        'mountExpressCheckout',
        'unmountExpressCheckout',
        'destroy',
        'isProcessing',
        'getAvailabilityStatus',
        'setAvailabilityListener',
        'addAvailabilityListener',
        'createPayment',
        'getActiveEceMountCount',
      ],
      { provider: 'applePay', isMock: false },
    );
    applePay.initialize.and.resolveTo();
    applePay.isConfigured.and.returnValue(true);
    applePay.addAvailabilityListener.and.returnValue(() => undefined);
    applePay.isAvailable.and.resolveTo(true);
    applePay.getAvailabilityStatus.and.returnValue('available');
    applePay.isProcessing.and.returnValue(false);
    applePay.createMountId.and.callFake(() => `apple-pay-ece-${++nextMount}`);
    applePay.mountExpressCheckout.and.callFake(async (_host, options, mountId) => {
      const id = mountId ?? `apple-pay-ece-${++nextMount}`;
      liveMounts.add(id);
      options.onReady?.();
      return id;
    });
    applePay.unmountExpressCheckout.and.callFake((options) => {
      if (options?.mountId) {
        liveMounts.delete(options.mountId);
      }
    });
    applePay.getActiveEceMountCount.and.callFake(() => liveMounts.size);

    await TestBed.configureTestingModule({
      imports: [EasyPaymentButtonsComponent],
      providers: [
        provideEasyPayments({
          enableMockMode: false,
          providers: {
            stripe: { publishableKey: 'pk_test_dual_apay' },
            applePay: { merchantName: 'Demo' },
          },
          backend: { createPaymentUrl: '/api/payments/create' },
        }),
        { provide: BrowserGuard, useValue: new FakeBrowserGuard() },
        { provide: ApplePayAdapter, useValue: applePay },
      ],
    }).compileComponents();
  });

  it('destroying one Apple Pay buttons host leaves the sibling ECE mount intact', async () => {
    const fixtureA = TestBed.createComponent(EasyPaymentButtonsComponent);
    const fixtureB = TestBed.createComponent(EasyPaymentButtonsComponent);
    fixtureA.componentRef.setInput('product', { ...SAMPLE_PRODUCT });
    fixtureB.componentRef.setInput('product', { ...SAMPLE_PRODUCT, id: 'other-plan' });
    fixtureA.componentRef.setInput('methods', ['apple-pay']);
    fixtureB.componentRef.setInput('methods', ['apple-pay']);

    await render(fixtureA);
    await render(fixtureB);
    await Promise.resolve();
    await Promise.resolve();
    fixtureA.detectChanges();
    fixtureB.detectChanges();

    expect(liveMounts.size).toBe(2);
    const idA = applePay.mountExpressCheckout.calls.first().args[2] as string;

    fixtureA.destroy();
    expect(applePay.unmountExpressCheckout).toHaveBeenCalledWith({
      preserveAvailability: true,
      mountId: idA,
    });
    expect(liveMounts.size).toBe(1);
    expect(
      fixtureB.nativeElement.querySelector('[data-testid="easy-payment-buttons-apple-pay-express"]'),
    ).toBeTruthy();
    expect(applePay.destroy).not.toHaveBeenCalled();

    fixtureB.destroy();
    expect(liveMounts.size).toBe(0);
  });
});

describe('EasyPaymentButtonsComponent real Klarna / Affirm selectors', () => {
  let fixture: ComponentFixture<EasyPaymentButtonsComponent>;
  let klarna: jasmine.SpyObj<KlarnaAdapter>;
  let affirm: jasmine.SpyObj<AffirmAdapter>;
  let paypal: jasmine.SpyObj<PayPalAdapter>;

  beforeEach(async () => {
    klarna = jasmine.createSpyObj<KlarnaAdapter>(
      'KlarnaAdapter',
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
        'wasReturnConsumed',
        'consumeStripeReturn',
      ],
      { provider: 'klarna', isMock: false },
    );
    affirm = jasmine.createSpyObj<AffirmAdapter>(
      'AffirmAdapter',
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
        'wasReturnConsumed',
        'consumeStripeReturn',
      ],
      { provider: 'affirm', isMock: false },
    );
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
      { provider: 'paypal', isMock: false },
    );

    klarna.initialize.and.resolveTo();
    klarna.isAvailable.and.resolveTo(true);
    klarna.ensureStripeLoaded.and.resolveTo({} as never);
    klarna.createPaymentSession.and.resolveTo({ clientSecret: 'pi_klarna_buttons' });
    klarna.mountPaymentElement.and.resolveTo();
    klarna.updateAppearance.and.resolveTo();
    klarna.destroy.and.resolveTo();
    klarna.isConfirming.and.returnValue(false);
    klarna.hasMountedElement.and.returnValue(true);
    klarna.wasReturnConsumed.and.returnValue(false);

    affirm.initialize.and.resolveTo();
    affirm.isAvailable.and.resolveTo(true);
    affirm.ensureStripeLoaded.and.resolveTo({} as never);
    affirm.createPaymentSession.and.resolveTo({ clientSecret: 'pi_affirm_buttons' });
    affirm.mountPaymentElement.and.resolveTo();
    affirm.updateAppearance.and.resolveTo();
    affirm.destroy.and.resolveTo();
    affirm.isConfirming.and.returnValue(false);
    affirm.hasMountedElement.and.returnValue(true);
    affirm.wasReturnConsumed.and.returnValue(false);

    paypal.initialize.and.resolveTo();
    paypal.isAvailable.and.resolveTo(true);
    paypal.renderButtons.and.resolveTo('paypal-mount-bnpl');
    paypal.destroyButtons.and.resolveTo();
    paypal.destroy.and.resolveTo();
    paypal.isBusy.and.returnValue(false);
    paypal.getActiveOrderId.and.returnValue(null);

    await TestBed.configureTestingModule({
      imports: [EasyPaymentButtonsComponent],
      providers: [
        provideEasyPayments({
          enableMockMode: false,
          providers: {
            stripe: { publishableKey: 'pk_test_bnpl_buttons' },
            klarna: {},
            affirm: {},
            paypal: { clientId: 'sb_bnpl' },
          },
          backend: {
            createPaymentUrl: '/api/payments/create',
            klarnaCreatePaymentUrl: '/api/klarna/create',
            affirmCreatePaymentUrl: '/api/affirm/create',
            paypalCreateOrderUrl: '/api/paypal/create',
            paypalCaptureOrderUrl: '/api/paypal/capture',
          },
        }),
        { provide: BrowserGuard, useValue: new FakeBrowserGuard() },
        { provide: KlarnaAdapter, useValue: klarna },
        { provide: AffirmAdapter, useValue: affirm },
        { provide: PayPalAdapter, useValue: paypal },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(EasyPaymentButtonsComponent);
    fixture.componentRef.setInput('product', { ...SAMPLE_PRODUCT });
    fixture.componentRef.setInput('methods', ['klarna', 'paypal', 'affirm', 'card']);
  });

  it('mounts easy-klarna-payment after Klarna selection without auto-confirm', async () => {
    await render(fixture);
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();

    expect(slotMethods(fixture)).toEqual(['klarna', 'paypal', 'affirm', 'card']);
    expect(fixture.nativeElement.getAttribute('data-klarna-ready')).toBe('true');
    expect(slotItem(fixture, 'klarna')?.getAttribute('data-kind')).toBe('klarna-selector');
    expect(fixture.nativeElement.querySelector('easy-klarna-payment')).toBeNull();
    expect(klarna.confirmPayment).not.toHaveBeenCalled();

    slotItem(fixture, 'klarna')?.querySelector('button')?.dispatchEvent(new Event('click'));
    fixture.detectChanges();
    await fixture.whenStable();
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('easy-klarna-payment')).toBeTruthy();
    expect(
      fixture.nativeElement.querySelector('[data-testid="easy-payment-buttons-klarna-panel"]'),
    ).toBeTruthy();
    expect(klarna.createPaymentSession).toHaveBeenCalled();
    expect(klarna.confirmPayment).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('easy-affirm-payment')).toBeNull();
    expect(slotItem(fixture, 'paypal')?.getAttribute('data-kind')).toBe('paypal-express');
    expect(
      fixture.nativeElement.querySelector('.ep-klarna__pay')?.textContent?.trim(),
    ).toBe('Continue to Klarna');
  });

  it('mounts easy-affirm-payment after Affirm selection without auto-confirm', async () => {
    await render(fixture);
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();

    expect(fixture.nativeElement.getAttribute('data-affirm-ready')).toBe('true');
    expect(slotItem(fixture, 'affirm')?.getAttribute('data-kind')).toBe('affirm-selector');

    slotItem(fixture, 'affirm')?.querySelector('button')?.dispatchEvent(new Event('click'));
    fixture.detectChanges();
    await fixture.whenStable();
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('easy-affirm-payment')).toBeTruthy();
    expect(
      fixture.nativeElement.querySelector('[data-testid="easy-payment-buttons-affirm-panel"]'),
    ).toBeTruthy();
    expect(affirm.createPaymentSession).toHaveBeenCalled();
    expect(affirm.confirmPayment).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('easy-klarna-payment')).toBeNull();
    expect(
      fixture.nativeElement.querySelector('.ep-affirm__pay')?.textContent?.trim(),
    ).toBe('Continue to Affirm');
  });

  it('marks Affirm unavailable without mounting Affirm UI when ineligible', async () => {
    affirm.isAvailable.and.resolveTo(false);
    await render(fixture);
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();

    const affirmSlot = slotItem(fixture, 'affirm');
    expect(affirmSlot?.getAttribute('data-state')).toBe('unavailable');
    expect(affirmSlot?.getAttribute('data-kind')).toBe('placeholder');
    expect(fixture.nativeElement.querySelector('easy-affirm-payment')).toBeNull();
    expect(slotItem(fixture, 'klarna')?.getAttribute('data-kind')).toBe('klarna-selector');
    expect(slotItem(fixture, 'paypal')?.getAttribute('data-kind')).toBe('paypal-express');
  });

  it('emits started only after Klarna confirm and success only after confirmed payment', async () => {
    const methodChanges: unknown[] = [];
    const started: unknown[] = [];
    const successes: PaymentResult[] = [];
    fixture.componentInstance.methodChange.subscribe((value) => methodChanges.push(value));
    fixture.componentInstance.started.subscribe((value) => started.push(value));
    fixture.componentInstance.success.subscribe((value) => successes.push(value));

    klarna.confirmPayment.and.resolveTo({
      status: 'success',
      method: 'klarna',
      provider: 'klarna',
      transactionId: 'pi_klarna_ok',
    });

    await render(fixture);
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();

    slotItem(fixture, 'klarna')?.querySelector('button')?.dispatchEvent(new Event('click'));
    fixture.detectChanges();
    await fixture.whenStable();
    await Promise.resolve();
    fixture.detectChanges();

    expect(methodChanges.length).toBe(1);
    expect(started.length).toBe(0);

    const payBtn = fixture.nativeElement.querySelector(
      'easy-klarna-payment button',
    ) as HTMLButtonElement | null;
    expect(payBtn).toBeTruthy();
    payBtn!.click();
    await fixture.whenStable();
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();

    expect(klarna.confirmPayment).toHaveBeenCalled();
    expect(started.length).toBe(1);
    expect((started[0] as { method: string }).method).toBe('klarna');
    expect(successes.length).toBe(1);
    expect(successes[0].transactionId).toBe('pi_klarna_ok');
  });
});

describe('EasyPaymentButtonsComponent Stripe BNPL redirect recovery', () => {
  afterEach(() => {
    history.replaceState({}, '', '/');
  });

  it('recovers Klarna return as success without emitting started', async () => {
    history.replaceState(
      {},
      '',
      '/?payment_intent=pi_buttons_klarna&payment_intent_client_secret=sec_bk&ep_method=klarna',
    );

    await TestBed.configureTestingModule({
      imports: [EasyPaymentButtonsComponent],
      providers: [
        provideEasyPayments({
          enableMockMode: false,
          providers: {
            stripe: { publishableKey: 'pk_test_return_klarna' },
            klarna: {},
          },
          backend: {
            createPaymentUrl: '/api/payments/create',
            klarnaCreatePaymentUrl: '/api/klarna/create',
          },
        }),
        { provide: BrowserGuard, useValue: new FakeBrowserGuard() },
      ],
    }).compileComponents();

    const recovery = TestBed.inject(StripeRedirectRecoveryService);
    spyOn(recovery, 'consumeReturn').and.resolveTo({
      status: 'success',
      method: 'klarna',
      provider: 'klarna',
      transactionId: 'pi_buttons_klarna_txn',
    });

    const successes: PaymentResult[] = [];
    const started: unknown[] = [];
    const errors: PaymentError[] = [];
    const fixture = TestBed.createComponent(EasyPaymentButtonsComponent);
    fixture.componentRef.setInput('product', { ...SAMPLE_PRODUCT });
    fixture.componentRef.setInput('methods', ['klarna', 'card']);
    fixture.componentInstance.success.subscribe((result) => successes.push(result));
    fixture.componentInstance.started.subscribe((value) => started.push(value));
    fixture.componentInstance.error.subscribe((error) => errors.push(error));

    expect(fixture.componentInstance.selectedMethod()).toBe('klarna');
    expect(fixture.componentInstance.providerBusy()).toBeTrue();

    fixture.detectChanges();
    await fixture.whenStable();
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();

    expect(recovery.consumeReturn).toHaveBeenCalled();
    expect(started.length).toBe(0);
    expect(successes.length).toBe(1);
    expect(successes[0].method).toBe('klarna');
    expect(successes[0].transactionId).toBe('pi_buttons_klarna_txn');
    expect(errors.length).toBe(0);

    fixture.destroy();
  });

  it('recovers Affirm return and maps retrieve failure to error once', async () => {
    history.replaceState(
      {},
      '',
      '/?payment_intent=pi_buttons_aff&payment_intent_client_secret=bad&ep_method=affirm',
    );

    await TestBed.configureTestingModule({
      imports: [EasyPaymentButtonsComponent],
      providers: [
        provideEasyPayments({
          enableMockMode: false,
          providers: {
            stripe: { publishableKey: 'pk_test_return_affirm' },
            affirm: {},
          },
          backend: {
            createPaymentUrl: '/api/payments/create',
            affirmCreatePaymentUrl: '/api/affirm/create',
          },
        }),
        { provide: BrowserGuard, useValue: new FakeBrowserGuard() },
      ],
    }).compileComponents();

    const recovery = TestBed.inject(StripeRedirectRecoveryService);
    spyOn(recovery, 'consumeReturn').and.rejectWith(
      new PaymentError({
        code: 'PAYMENT_FAILED',
        message: 'Stripe retrieve failed',
        method: 'affirm',
        provider: 'affirm',
      }),
    );

    const errors: PaymentError[] = [];
    const successes: PaymentResult[] = [];
    const fixture = TestBed.createComponent(EasyPaymentButtonsComponent);
    fixture.componentRef.setInput('product', { ...SAMPLE_PRODUCT });
    fixture.componentRef.setInput('methods', ['affirm']);
    fixture.componentInstance.error.subscribe((error) => errors.push(error));
    fixture.componentInstance.success.subscribe((result) => successes.push(result));

    expect(fixture.componentInstance.selectedMethod()).toBe('affirm');

    fixture.detectChanges();
    await fixture.whenStable();
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();

    expect(errors.length).toBe(1);
    expect(errors[0].method).toBe('affirm');
    expect(successes.length).toBe(0);

    await (
      fixture.componentInstance as unknown as {
        recoverStripeReturn: (method: 'affirm') => Promise<void>;
      }
    ).recoverStripeReturn('affirm');
    expect(errors.length).toBe(1);

    fixture.destroy();
  });

  it('emits pending for a processing return (never success or error)', async () => {
    history.replaceState(
      {},
      '',
      '/?payment_intent=pi_proc&payment_intent_client_secret=sec_proc&ep_method=klarna',
    );

    await TestBed.configureTestingModule({
      imports: [EasyPaymentButtonsComponent],
      providers: [
        provideEasyPayments({
          enableMockMode: false,
          providers: {
            stripe: { publishableKey: 'pk_test_return_proc' },
            klarna: {},
          },
          backend: {
            createPaymentUrl: '/api/payments/create',
            klarnaCreatePaymentUrl: '/api/klarna/create',
          },
        }),
        { provide: BrowserGuard, useValue: new FakeBrowserGuard() },
      ],
    }).compileComponents();

    const recovery = TestBed.inject(StripeRedirectRecoveryService);
    spyOn(recovery, 'consumeReturn').and.resolveTo({
      status: 'processing',
      method: 'klarna',
      provider: 'klarna',
      message: 'Payment is still processing.',
    });

    const successes: PaymentResult[] = [];
    const pending: PaymentResult[] = [];
    const errors: PaymentError[] = [];
    const fixture = TestBed.createComponent(EasyPaymentButtonsComponent);
    fixture.componentRef.setInput('product', { ...SAMPLE_PRODUCT });
    fixture.componentRef.setInput('methods', ['klarna']);
    fixture.componentInstance.success.subscribe((result) => successes.push(result));
    fixture.componentInstance.pending.subscribe((result) => pending.push(result));
    fixture.componentInstance.error.subscribe((error) => errors.push(error));

    fixture.detectChanges();
    await fixture.whenStable();
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();

    expect(successes.length).toBe(0);
    expect(errors.length).toBe(0);
    expect(pending.length).toBe(1);
    expect(pending[0].status).toBe('processing');
    expect(fixture.componentInstance.methodsLocked()).toBeTrue();

    fixture.destroy();
  });
});
