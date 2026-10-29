import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideEasyPayments } from '../../config/provide-easy-payments';
import { MockPaymentController } from '../../adapters/mock/mock-payment.controller';
import { BrowserGuard } from '../../utils/browser-guard';
import { FakeBrowserGuard, SAMPLE_PRODUCT } from '../../testing/test-doubles';
import { EasyPaymentsComponent } from '../payments/easy-payments.component';
import { EasyPaymentButtonsComponent } from './easy-payment-buttons.component';
import type { AvailablePaymentMethod } from '../../services/payment-orchestrator.service';
import { StripeCardAdapter } from '../../adapters/stripe/stripe-card.adapter';
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
    expect(card?.getAttribute('data-state')).toBe('available');
    expect(card?.querySelector('button.ep-payment-buttons__selector')).toBeTruthy();
    expect(fixture.nativeElement.getAttribute('data-card-ready')).toBe('true');
  });

  it('omits Card when it is not in the methods allow-list', async () => {
    fixture.componentRef.setInput('methods', ['paypal', 'klarna']);
    await render(fixture);

    expect(slotMethods(fixture)).toEqual(['paypal', 'klarna']);
    expect(slotItem(fixture, 'card')).toBeNull();
    expect(fixture.nativeElement.getAttribute('data-card-ready')).toBe('false');
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
    expect(card?.getAttribute('data-interactive')).toBe('false');
    expect(
      fixture.nativeElement.querySelector('[data-testid="easy-payment-buttons-card-mock-panel"]'),
    ).toBeNull();
    expect(fixture.nativeElement.querySelector('easy-stripe-card-payment')).toBeNull();
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
    expect(fixture.nativeElement.querySelector('button.ep-mock-panel__cta')).toBeTruthy();
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

  it('keeps non-card methods noninteractive placeholders', async () => {
    fixture.componentRef.setInput('methods', [
      'card',
      'paypal',
      'apple-pay',
      'google-pay',
      'klarna',
      'affirm',
    ]);
    await render(fixture);

    for (const method of ['paypal', 'apple-pay', 'google-pay', 'klarna', 'affirm']) {
      const item = slotItem(fixture, method);
      expect(item?.getAttribute('data-interactive')).toBe('false');
      expect(item?.querySelector('.ep-payment-buttons__placeholder')).toBeTruthy();
      expect(item?.querySelector('button.ep-payment-buttons__selector')).toBeNull();
    }
  });

  it('preserves horizontal/vertical layout and developer order', async () => {
    fixture.componentRef.setInput('methods', ['klarna', 'card', 'paypal']);
    fixture.componentRef.setInput('layout', 'horizontal');
    await render(fixture);

    const host = fixture.nativeElement as HTMLElement;
    expect(slotMethods(fixture)).toEqual(['klarna', 'card', 'paypal']);
    expect(host.getAttribute('data-layout')).toBe('horizontal');
    expect(host.classList.contains('ep-payment-buttons-host--horizontal')).toBeTrue();

    fixture.componentRef.setInput('layout', 'vertical');
    await render(fixture);
    expect(host.getAttribute('data-layout')).toBe('vertical');
  });

  it('keeps a permanently transparent host without checkout shell chrome', async () => {
    fixture.componentRef.setInput('methods', ['card']);
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

    // Wait for orchestrator availability; Card should be ready via spy isAvailable.
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
