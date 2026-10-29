import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideEasyPayments } from '../../config/provide-easy-payments';
import { MockPaymentController } from '../../adapters/mock/mock-payment.controller';
import { BrowserGuard } from '../../utils/browser-guard';
import { FakeBrowserGuard, SAMPLE_PRODUCT } from '../../testing/test-doubles';
import { EasyPaymentsComponent } from '../payments/easy-payments.component';
import { EasyPaymentButtonsComponent } from './easy-payment-buttons.component';
import type { AvailablePaymentMethod } from '../../services/payment-orchestrator.service';

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

function slotStates(fixture: ComponentFixture<EasyPaymentButtonsComponent>): string[] {
  return Array.from(
    (fixture.nativeElement as HTMLElement).querySelectorAll('.ep-payment-buttons__item[data-method]'),
  ).map((el) => el.getAttribute('data-state') ?? '');
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
    expect(host.getAttribute('data-foundation')).toBe('true');
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
    expect(fixture.componentInstance.methodSlots().map((slot) => slot.method)).toEqual([
      ...methods,
    ]);
  });

  it('renders only the developer-selected subset without reordering', async () => {
    fixture.componentRef.setInput('methods', ['klarna', 'card']);
    await render(fixture);

    expect(slotMethods(fixture)).toEqual(['klarna', 'card']);
    expect(slotMethods(fixture)).not.toContain('paypal');
  });

  it('preserves exact developer-provided order when methods change', async () => {
    fixture.componentRef.setInput('methods', ['card', 'paypal', 'google-pay']);
    await render(fixture);
    expect(slotMethods(fixture)).toEqual(['card', 'paypal', 'google-pay']);

    fixture.componentRef.setInput('methods', ['google-pay', 'card', 'paypal']);
    await render(fixture);
    expect(slotMethods(fixture)).toEqual(['google-pay', 'card', 'paypal']);
  });

  it('applies horizontal and vertical layout classes', async () => {
    fixture.componentRef.setInput('methods', ['card', 'paypal']);
    fixture.componentRef.setInput('layout', 'vertical');
    await render(fixture);

    const host = fixture.nativeElement as HTMLElement;
    const root = host.querySelector('[data-testid="easy-payment-buttons-root"]') as HTMLElement;
    expect(host.getAttribute('data-layout')).toBe('vertical');
    expect(host.classList.contains('ep-payment-buttons-host--vertical')).toBeTrue();
    expect(root.classList.contains('ep-payment-buttons--vertical')).toBeTrue();

    fixture.componentRef.setInput('layout', 'horizontal');
    await render(fixture);
    expect(host.getAttribute('data-layout')).toBe('horizontal');
    expect(host.classList.contains('ep-payment-buttons-host--horizontal')).toBeTrue();
    expect(root.classList.contains('ep-payment-buttons--horizontal')).toBeTrue();
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
    expect(host.textContent).not.toContain('Premium Plan');
  });

  it('marks unavailable methods without inventing payment actions', async () => {
    fixture.componentRef.setInput('methods', ['card', 'paypal']);
    await render(fixture);

    applyInstanceAvailability(fixture, [
      { method: 'card', isMock: true, available: true, status: 'available' },
      { method: 'paypal', isMock: true, available: false, status: 'unavailable' },
    ]);
    fixture.detectChanges();

    expect(slotStates(fixture)).toEqual(['available', 'unavailable']);
    const paypal = hostMethod(fixture, 'paypal');
    expect(paypal?.querySelector('[aria-disabled="true"]')).toBeTruthy();
    expect(paypal?.textContent).toContain('Unavailable');
  });

  it('keeps independent availability sessions across concurrent button hosts', async () => {
    const fixtureB = TestBed.createComponent(EasyPaymentButtonsComponent);
    fixtureB.componentRef.setInput('product', { ...SAMPLE_PRODUCT, id: 'other-plan' });
    fixture.componentRef.setInput('methods', ['card', 'paypal']);
    fixtureB.componentRef.setInput('methods', ['klarna', 'affirm']);
    await render(fixture);
    await render(fixtureB);

    expect(slotMethods(fixture)).toEqual(['card', 'paypal']);
    expect(slotMethods(fixtureB)).toEqual(['klarna', 'affirm']);

    fixture.componentRef.setInput('methods', ['paypal']);
    await render(fixture);
    fixtureB.detectChanges();

    expect(slotMethods(fixture)).toEqual(['paypal']);
    expect(slotMethods(fixtureB)).toEqual(['klarna', 'affirm']);
  });

  it('does not emit payment lifecycle events from foundation placeholders', async () => {
    const started: unknown[] = [];
    const methodChange: unknown[] = [];
    const success: unknown[] = [];
    const cancel: unknown[] = [];
    const error: unknown[] = [];

    fixture.componentInstance.started.subscribe((value) => started.push(value));
    fixture.componentInstance.methodChange.subscribe((value) => methodChange.push(value));
    fixture.componentInstance.success.subscribe((value) => success.push(value));
    fixture.componentInstance.cancel.subscribe((value) => cancel.push(value));
    fixture.componentInstance.error.subscribe((value) => error.push(value));

    fixture.componentRef.setInput('methods', ['card', 'paypal']);
    await render(fixture);

    const placeholder = fixture.nativeElement.querySelector(
      '.ep-payment-buttons__placeholder',
    ) as HTMLElement | null;
    expect(placeholder).toBeTruthy();
    placeholder?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    placeholder?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    fixture.detectChanges();

    expect(started.length).toBe(0);
    expect(methodChange.length).toBe(0);
    expect(success.length).toBe(0);
    expect(cancel.length).toBe(0);
    expect(error.length).toBe(0);
    expect(fixture.componentInstance.foundationOnly()).toBeTrue();
    expect(getComputedStyle(placeholder!).pointerEvents).toBe('none');
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

function hostMethod(
  fixture: ComponentFixture<EasyPaymentButtonsComponent>,
  method: string,
): HTMLElement | null {
  return (fixture.nativeElement as HTMLElement).querySelector(
    `.ep-payment-buttons__item[data-method="${method}"]`,
  ) as HTMLElement | null;
}
