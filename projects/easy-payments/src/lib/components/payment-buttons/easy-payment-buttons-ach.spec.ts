import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideEasyPayments } from '../../config/provide-easy-payments';
import { MockPaymentController } from '../../adapters/mock/mock-payment.controller';
import { UsBankAccountAdapter } from '../../adapters/us-bank-account/us-bank-account.adapter';
import { BrowserGuard } from '../../utils/browser-guard';
import { FakeBrowserGuard, SAMPLE_PRODUCT } from '../../testing/test-doubles';
import { resetTestLocation, setTestLocation } from '../../testing/test-history';
import type { AvailablePaymentMethod } from '../../services/payment-orchestrator.service';
import type { PaymentResult } from '../../models';
import { PaymentError } from '../../errors/payment-error';
import { EasyPaymentButtonsComponent } from './easy-payment-buttons.component';

async function render(fixture: ComponentFixture<EasyPaymentButtonsComponent>): Promise<void> {
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
}

function applyAvailability(
  fixture: ComponentFixture<EasyPaymentButtonsComponent>,
  results: AvailablePaymentMethod[],
): void {
  (
    fixture.componentInstance as unknown as {
      availabilitySession: { apply: (value: readonly AvailablePaymentMethod[]) => void };
    }
  ).availabilitySession.apply(results);
}

function slotItem(
  fixture: ComponentFixture<EasyPaymentButtonsComponent>,
  method: string,
): HTMLElement | null {
  return (fixture.nativeElement as HTMLElement).querySelector(
    `.ep-payment-buttons__item[data-method="${method}"]`,
  ) as HTMLElement | null;
}

describe('EasyPaymentButtonsComponent ACH', () => {
  let fixture: ComponentFixture<EasyPaymentButtonsComponent>;
  let mockController: MockPaymentController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [EasyPaymentButtonsComponent],
      providers: [provideEasyPayments({ enableMockMode: true, providers: {} })],
    }).compileComponents();

    mockController = TestBed.inject(MockPaymentController);
    mockController.reset();
    fixture = TestBed.createComponent(EasyPaymentButtonsComponent);
    fixture.componentRef.setInput('product', { ...SAMPLE_PRODUCT });
    fixture.componentRef.setInput('methods', ['card', 'us-bank-account']);
  });

  it('advertises an ACH selector when opted in', async () => {
    applyAvailability(fixture, [
      { method: 'card', isMock: true, available: true, status: 'available' },
      { method: 'us-bank-account', isMock: true, available: true, status: 'available' },
    ]);
    await render(fixture);

    const ach = slotItem(fixture, 'us-bank-account');
    expect(ach?.getAttribute('data-kind')).toBe('us-bank-account-selector');
    expect(ach?.getAttribute('data-interactive')).toBe('true');
    expect(fixture.nativeElement.getAttribute('data-us-bank-account-ready')).toBe('true');
    expect(ach?.querySelector('button.ep-payment-buttons__selector')).toBeTruthy();
  });

  it('emits pending (not success) for mock ACH processing and locks retry', async () => {
    mockController.setOutcome('processing');
    applyAvailability(fixture, [
      { method: 'card', isMock: true, available: true, status: 'available' },
      { method: 'us-bank-account', isMock: true, available: true, status: 'available' },
    ]);
    await render(fixture);

    const pending: PaymentResult[] = [];
    const successes: PaymentResult[] = [];
    fixture.componentInstance.pending.subscribe((result) => pending.push(result));
    fixture.componentInstance.success.subscribe((result) => successes.push(result));

    slotItem(fixture, 'us-bank-account')
      ?.querySelector('button')
      ?.dispatchEvent(new Event('click'));
    fixture.detectChanges();
    await fixture.whenStable();

    expect(
      fixture.nativeElement.querySelector(
        '[data-testid="easy-payment-buttons-us-bank-account-mock-panel"]',
      ),
    ).toBeTruthy();

    (
      fixture.nativeElement.querySelector(
        '[data-testid="easy-payment-buttons-us-bank-account-mock-panel"] button.ep-mock-panel__cta',
      ) as HTMLButtonElement | null
    )?.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(pending.length).toBe(1);
    expect(pending[0].status).toBe('processing');
    expect(pending[0].method).toBe('us-bank-account');
    expect(successes.length).toBe(0);
    expect(fixture.componentInstance.processingMethod()).toBe('us-bank-account');
    expect(fixture.componentInstance.methodsLocked()).toBeTrue();
    expect(fixture.componentInstance.selectedMethod()).toBeNull();
    expect(
      fixture.nativeElement.querySelector(
        '[data-testid="easy-payment-buttons-us-bank-account-mock-panel"]',
      ),
    ).toBeNull();
    expect(fixture.componentInstance.canRequestPayment('us-bank-account')).toBeFalse();
    fixture.componentInstance.requestPayment('us-bank-account');
    fixture.componentInstance.selectMethod('us-bank-account');
    fixture.componentInstance.selectMethod('card');
    expect(fixture.componentInstance.selectedMethod()).toBeNull();
    expect(pending.length).toBe(1);
    expect(fixture.componentInstance.processingMethod()).toBe('us-bank-account');
  });

  it('supports merchant-owned requestPayment for ACH', async () => {
    applyAvailability(fixture, [
      { method: 'us-bank-account', isMock: true, available: true, status: 'available' },
    ]);
    fixture.componentRef.setInput('methods', ['us-bank-account']);
    fixture.componentRef.setInput('selectorVisibility', 'merchant');
    await render(fixture);

    expect(fixture.componentInstance.canRequestPayment('us-bank-account')).toBeTrue();
    fixture.componentInstance.requestPayment('us-bank-account');
    fixture.detectChanges();

    expect(fixture.componentInstance.selectedMethod()).toBe('us-bank-account');
    expect(
      fixture.nativeElement.querySelector(
        '[data-testid="easy-payment-buttons-us-bank-account-mock-panel"]',
      ),
    ).toBeTruthy();
  });

  it('does not advertise ACH when the host omits it from methods', async () => {
    fixture.componentRef.setInput('methods', ['card', 'paypal']);
    applyAvailability(fixture, [
      { method: 'card', isMock: true, available: true, status: 'available' },
      { method: 'paypal', isMock: true, available: true, status: 'available' },
    ]);
    await render(fixture);

    expect(slotItem(fixture, 'us-bank-account')).toBeNull();
    expect(fixture.nativeElement.getAttribute('data-us-bank-account-ready')).toBe('false');
    expect(fixture.componentInstance.canRequestPayment('us-bank-account')).toBeFalse();
  });

});

describe('EasyPaymentButtonsComponent ACH return recovery', () => {
  afterEach(() => {
    resetTestLocation();
  });

  it('recovers ACH return via retrieve only and emits pending once', async () => {
    setTestLocation(
      '/?payment_intent=pi_ach_ret&payment_intent_client_secret=sec_ach_ret&ep_method=us-bank-account',
    );

    await TestBed.configureTestingModule({
      imports: [EasyPaymentButtonsComponent],
      providers: [
        provideEasyPayments({
          enableMockMode: false,
          providers: {
            stripe: { publishableKey: 'pk_test_ach_return' },
            usBankAccount: {},
          },
          backend: {
            createPaymentUrl: '/api/payments/create',
            createUsBankAccountPaymentUrl: '/api/payments/us-bank-account/create',
          },
        }),
        { provide: BrowserGuard, useValue: new FakeBrowserGuard() },
      ],
    }).compileComponents();

    const adapter = TestBed.inject(UsBankAccountAdapter);
    const recoverSpy = spyOn(adapter, 'recoverReturningPayment').and.resolveTo({
      status: 'processing',
      method: 'us-bank-account',
      provider: 'usBankAccount',
      transactionId: 'pi_ach_ret',
      message: 'Payment is processing.',
    });
    const confirmSpy = spyOn(adapter, 'confirmPayment');

    const pending: PaymentResult[] = [];
    const successes: PaymentResult[] = [];
    const started: unknown[] = [];
    const errors: PaymentError[] = [];
    const fixture = TestBed.createComponent(EasyPaymentButtonsComponent);
    fixture.componentRef.setInput('product', { ...SAMPLE_PRODUCT });
    fixture.componentRef.setInput('methods', ['us-bank-account']);
    fixture.componentInstance.pending.subscribe((result) => pending.push(result));
    fixture.componentInstance.success.subscribe((result) => successes.push(result));
    fixture.componentInstance.started.subscribe((event) => started.push(event));
    fixture.componentInstance.error.subscribe((error) => errors.push(error));

    fixture.detectChanges();
    await fixture.whenStable();
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();

    expect(recoverSpy).toHaveBeenCalledWith('sec_ach_ret');
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(pending.length).toBe(1);
    expect(pending[0].transactionId).toBe('pi_ach_ret');
    expect(successes.length).toBe(0);
    expect(started.length).toBe(0);
    expect(errors.length).toBe(0);
    expect(fixture.componentInstance.methodsLocked()).toBeTrue();
    expect(
      fixture.nativeElement.querySelector(
        '[data-testid="easy-payment-buttons-us-bank-account-panel"]',
      ),
    ).toBeNull();

    fixture.destroy();
  });

  it('keeps the ACH panel alive while busy even if availability flaps', async () => {
    await TestBed.configureTestingModule({
      imports: [EasyPaymentButtonsComponent],
      providers: [
        provideEasyPayments({
          enableMockMode: false,
          providers: {
            stripe: { publishableKey: 'pk_test_ach_keepalive' },
            usBankAccount: {},
          },
          backend: {
            createPaymentUrl: '/api/payments/create',
            createUsBankAccountPaymentUrl: '/api/payments/us-bank-account/create',
          },
        }),
        { provide: BrowserGuard, useValue: new FakeBrowserGuard() },
      ],
    }).compileComponents();

    const adapter = TestBed.inject(UsBankAccountAdapter);
    spyOn(adapter, 'ensureStripeLoaded').and.resolveTo({} as never);
    spyOn(adapter, 'createPaymentSession').and.resolveTo({ clientSecret: 'pi_keep_secret' });
    spyOn(adapter, 'mountPaymentElement').and.resolveTo();
    spyOn(adapter, 'updateAppearance').and.resolveTo();
    spyOn(adapter, 'destroy').and.resolveTo();
    spyOn(adapter, 'isConfirming').and.returnValue(false);
    spyOn(adapter, 'hasMountedElement').and.returnValue(true);

    const fixture = TestBed.createComponent(EasyPaymentButtonsComponent);
    fixture.componentRef.setInput('product', { ...SAMPLE_PRODUCT });
    fixture.componentRef.setInput('methods', ['us-bank-account']);
    applyAvailability(fixture, [
      { method: 'us-bank-account', isMock: false, available: true, status: 'available' },
    ]);
    await render(fixture);

    slotItem(fixture, 'us-bank-account')
      ?.querySelector('button')
      ?.dispatchEvent(new Event('click'));
    fixture.detectChanges();
    await fixture.whenStable();

    fixture.componentInstance.onUsBankAccountBusy(true);
    fixture.detectChanges();

    applyAvailability(fixture, [
      { method: 'us-bank-account', isMock: false, available: false, status: 'unavailable' },
    ]);
    fixture.detectChanges();

    expect(
      fixture.nativeElement.querySelector(
        '[data-testid="easy-payment-buttons-us-bank-account-panel"]',
      ),
    ).toBeTruthy();
  });

  async function configureRealAchButtons(): Promise<{
    fixture: ComponentFixture<EasyPaymentButtonsComponent>;
    adapter: UsBankAccountAdapter;
  }> {
    await TestBed.configureTestingModule({
      imports: [EasyPaymentButtonsComponent],
      providers: [
        provideEasyPayments({
          enableMockMode: false,
          providers: {
            stripe: { publishableKey: 'pk_test_ach_pending_ui' },
            usBankAccount: {},
          },
          backend: {
            createPaymentUrl: '/api/payments/create',
            createUsBankAccountPaymentUrl: '/api/payments/us-bank-account/create',
          },
        }),
        { provide: BrowserGuard, useValue: new FakeBrowserGuard() },
      ],
    }).compileComponents();

    const adapter = TestBed.inject(UsBankAccountAdapter);
    spyOn(adapter, 'ensureStripeLoaded').and.resolveTo({} as never);
    spyOn(adapter, 'createPaymentSession').and.resolveTo({ clientSecret: 'pi_pending_ui_secret' });
    spyOn(adapter, 'mountPaymentElement').and.resolveTo();
    spyOn(adapter, 'updateAppearance').and.resolveTo();
    spyOn(adapter, 'destroy').and.resolveTo();
    spyOn(adapter, 'isConfirming').and.returnValue(false);
    spyOn(adapter, 'hasMountedElement').and.returnValue(true);

    const fixture = TestBed.createComponent(EasyPaymentButtonsComponent);
    fixture.componentRef.setInput('product', { ...SAMPLE_PRODUCT });
    fixture.componentRef.setInput('methods', ['us-bank-account']);
    return { fixture, adapter };
  }

  it('closes ACH panel on pending, emits once, and blocks reselect/requestPayment', async () => {
    const { fixture, adapter } = await configureRealAchButtons();
    spyOn(adapter, 'confirmPayment').and.resolveTo({
      status: 'processing',
      method: 'us-bank-account',
      provider: 'usBankAccount',
      transactionId: 'pi_pending_ui',
    });

    const pending: PaymentResult[] = [];
    const successes: PaymentResult[] = [];
    fixture.componentInstance.pending.subscribe((result) => pending.push(result));
    fixture.componentInstance.success.subscribe((result) => successes.push(result));

    applyAvailability(fixture, [
      { method: 'us-bank-account', isMock: false, available: true, status: 'available' },
    ]);
    await render(fixture);

    slotItem(fixture, 'us-bank-account')
      ?.querySelector('button')
      ?.dispatchEvent(new Event('click'));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const pay = fixture.nativeElement.querySelector(
      '[data-testid="easy-payment-buttons-us-bank-account-panel"] button.ep-ach__pay',
    ) as HTMLButtonElement | null;
    expect(pay).toBeTruthy();
    pay!.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(pending.length).toBe(1);
    expect(successes.length).toBe(0);
    expect(fixture.componentInstance.selectedMethod()).toBeNull();
    expect(
      fixture.nativeElement.querySelector(
        '[data-testid="easy-payment-buttons-us-bank-account-panel"]',
      ),
    ).toBeNull();
    expect(fixture.nativeElement.querySelector('.ep-ach__pending-inline')).toBeNull();
    expect(fixture.componentInstance.methodsLocked()).toBeTrue();
    expect(fixture.componentInstance.canRequestPayment('us-bank-account')).toBeFalse();

    fixture.componentInstance.requestPayment('us-bank-account');
    fixture.componentInstance.selectMethod('us-bank-account');
    fixture.detectChanges();
    expect(fixture.componentInstance.selectedMethod()).toBeNull();
    expect(adapter.confirmPayment).toHaveBeenCalledTimes(1);

    // Late duplicate from a remounted/destroyed panel must not re-emit.
    fixture.componentInstance.onUsBankAccountSuccess({
      status: 'processing',
      method: 'us-bank-account',
      provider: 'usBankAccount',
      transactionId: 'pi_pending_ui',
    });
    expect(pending.length).toBe(1);
  });

  it('closes ACH panel on success from requestPayment and emits once', async () => {
    const { fixture, adapter } = await configureRealAchButtons();
    fixture.componentRef.setInput('selectorVisibility', 'merchant');
    spyOn(adapter, 'confirmPayment').and.resolveTo({
      status: 'success',
      method: 'us-bank-account',
      provider: 'usBankAccount',
      transactionId: 'pi_success_ui',
    });

    const pending: PaymentResult[] = [];
    const successes: PaymentResult[] = [];
    fixture.componentInstance.pending.subscribe((result) => pending.push(result));
    fixture.componentInstance.success.subscribe((result) => successes.push(result));

    applyAvailability(fixture, [
      { method: 'us-bank-account', isMock: false, available: true, status: 'available' },
    ]);
    await render(fixture);

    expect(fixture.componentInstance.canRequestPayment('us-bank-account')).toBeTrue();
    fixture.componentInstance.requestPayment('us-bank-account');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const pay = fixture.nativeElement.querySelector(
      '[data-testid="easy-payment-buttons-us-bank-account-panel"] button.ep-ach__pay',
    ) as HTMLButtonElement | null;
    expect(pay).toBeTruthy();
    pay!.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(successes.length).toBe(1);
    expect(pending.length).toBe(0);
    expect(fixture.componentInstance.selectedMethod()).toBeNull();
    expect(
      fixture.nativeElement.querySelector(
        '[data-testid="easy-payment-buttons-us-bank-account-panel"]',
      ),
    ).toBeNull();

    fixture.componentInstance.onUsBankAccountSuccess({
      status: 'success',
      method: 'us-bank-account',
      provider: 'usBankAccount',
      transactionId: 'pi_success_ui',
    });
    expect(successes.length).toBe(1);
  });

  it('forwards cardButtonAppearance onto a real ACH panel with chrome=minimal', async () => {
    await TestBed.configureTestingModule({
      imports: [EasyPaymentButtonsComponent],
      providers: [
        provideEasyPayments({
          enableMockMode: false,
          providers: {
            stripe: { publishableKey: 'pk_test_ach_btn' },
            usBankAccount: {},
          },
          backend: {
            createPaymentUrl: '/api/payments/create',
            createUsBankAccountPaymentUrl: '/api/payments/us-bank-account/create',
          },
        }),
        { provide: BrowserGuard, useValue: new FakeBrowserGuard() },
      ],
    }).compileComponents();

    const adapter = TestBed.inject(UsBankAccountAdapter);
    spyOn(adapter, 'ensureStripeLoaded').and.resolveTo({} as never);
    spyOn(adapter, 'createPaymentSession').and.resolveTo({ clientSecret: 'pi_ach_btn_secret' });
    spyOn(adapter, 'mountPaymentElement').and.resolveTo();
    spyOn(adapter, 'updateAppearance').and.resolveTo();
    spyOn(adapter, 'destroy').and.resolveTo();
    spyOn(adapter, 'isConfirming').and.returnValue(false);
    spyOn(adapter, 'hasMountedElement').and.returnValue(true);

    const fixture = TestBed.createComponent(EasyPaymentButtonsComponent);
    fixture.componentRef.setInput('product', { ...SAMPLE_PRODUCT });
    fixture.componentRef.setInput('methods', ['us-bank-account']);
    fixture.componentRef.setInput('cardButtonAppearance', {
      label: 'Pay from bank',
      backgroundColor: '#111827',
      textColor: '#f9fafb',
    });

    applyAvailability(fixture, [
      { method: 'us-bank-account', isMock: false, available: true, status: 'available' },
    ]);
    await render(fixture);

    slotItem(fixture, 'us-bank-account')
      ?.querySelector('button')
      ?.dispatchEvent(new Event('click'));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const achHost = fixture.nativeElement.querySelector(
      '[data-testid="easy-payment-buttons-us-bank-account-panel"] easy-us-bank-account-payment',
    ) as HTMLElement | null;
    expect(achHost).toBeTruthy();
    expect(achHost!.querySelector('.ep-ach')?.getAttribute('data-chrome')).toBe('minimal');
    const cta = achHost!.querySelector('button.ep-ach__pay') as HTMLButtonElement;
    expect(cta.textContent?.trim()).toBe('Pay from bank');
    expect(achHost!.style.getPropertyValue('--ep-card-cta-bg').trim()).toBe('#111827');
    expect(achHost!.style.getPropertyValue('--ep-card-cta-text').trim()).toBe('#f9fafb');
  });
});
