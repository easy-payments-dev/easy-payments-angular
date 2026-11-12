import { Component, signal, ChangeDetectionStrategy } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { PaymentError } from '../../errors/payment-error';
import { UsBankAccountPaymentComponent } from './us-bank-account-payment.component';
import { UsBankAccountAdapter } from '../../adapters/us-bank-account/us-bank-account.adapter';
import {
  EasyPaymentsCardButtonAppearance,
  PaymentProduct,
  PaymentResult,
  ResolvedPaymentTheme,
} from '../../models';

@Component({
  standalone: true,
  imports: [UsBankAccountPaymentComponent],
  changeDetection: ChangeDetectionStrategy.Default,
  template: `
    <easy-us-bank-account-payment
      [product]="product()"
      [resolvedTheme]="theme()"
      [chrome]="chrome()"
      [cardButtonAppearance]="cardButtonAppearance()"
      (started)="starts.push($event)"
      (success)="successes.push($event)"
      (error)="errors.push($event)"
      (cancel)="cancels.push($event)"
      (busyChange)="busyChanges.push($event)"
    />
  `,
})
class HostComponent {
  readonly product = signal<PaymentProduct>({
    id: 'premium-plan',
    name: 'Premium Plan',
    amount: 99,
    currency: 'USD',
    quantity: 1,
  });
  readonly theme = signal<ResolvedPaymentTheme>('light');
  readonly chrome = signal<'full' | 'minimal'>('full');
  readonly cardButtonAppearance = signal<EasyPaymentsCardButtonAppearance | null>(null);
  starts: unknown[] = [];
  successes: PaymentResult[] = [];
  errors: PaymentError[] = [];
  cancels: PaymentResult[] = [];
  busyChanges: boolean[] = [];
}

describe('UsBankAccountPaymentComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let adapter: jasmine.SpyObj<UsBankAccountAdapter>;

  beforeEach(async () => {
    adapter = jasmine.createSpyObj<UsBankAccountAdapter>('UsBankAccountAdapter', [
      'ensureStripeLoaded',
      'createPaymentSession',
      'mountPaymentElement',
      'updateAppearance',
      'destroy',
      'confirmPayment',
      'recoverReturningPayment',
      'isConfirming',
      'hasMountedElement',
    ]);

    adapter.ensureStripeLoaded.and.resolveTo({} as never);
    adapter.createPaymentSession.and.resolveTo({ clientSecret: 'pi_ach_secret' });
    adapter.mountPaymentElement.and.resolveTo();
    adapter.updateAppearance.and.resolveTo();
    adapter.destroy.and.resolveTo();
    adapter.isConfirming.and.returnValue(false);
    adapter.hasMountedElement.and.returnValue(true);

    await TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [{ provide: UsBankAccountAdapter, useValue: adapter }],
    }).compileComponents();

    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    await Promise.resolve();
    await Promise.resolve();
  });

  function payButton(): HTMLButtonElement {
    return fixture.debugElement.query(By.css('button.ep-ach__pay')).nativeElement;
  }

  function achHost(): HTMLElement {
    return fixture.debugElement.query(By.css('easy-us-bank-account-payment')).nativeElement;
  }

  function panel(): UsBankAccountPaymentComponent {
    return fixture.debugElement.query(By.directive(UsBankAccountPaymentComponent))
      .componentInstance as UsBankAccountPaymentComponent;
  }

  async function waitUntilReady(): Promise<void> {
    for (let i = 0; i < 20 && panel().uiState() !== 'ready'; i += 1) {
      await fixture.whenStable();
      await Promise.resolve();
      fixture.detectChanges();
    }
    expect(panel().uiState()).toBe('ready');
  }

  it('uses chrome=minimal CTA label without amount', async () => {
    fixture.componentInstance.chrome.set('minimal');
    fixture.detectChanges();
    await waitUntilReady();

    expect(payButton().textContent?.trim()).toBe('Pay with US bank account');
    expect(payButton().textContent).not.toMatch(/\$\d/);
    expect(achHost().querySelector('.ep-ach')?.getAttribute('data-chrome')).toBe('minimal');
  });

  it('applies cardButtonAppearance to the ACH CTA', async () => {
    fixture.componentInstance.chrome.set('minimal');
    fixture.componentInstance.cardButtonAppearance.set({
      label: 'Debit my bank',
      backgroundColor: '#0f172a',
      textColor: '#f8fafc',
      fontSize: '15px',
      borderRadius: '8px',
    });
    fixture.detectChanges();
    await waitUntilReady();

    expect(payButton().textContent?.trim()).toBe('Debit my bank');
    expect(achHost().style.getPropertyValue('--ep-card-cta-bg').trim()).toBe('#0f172a');
    expect(achHost().style.getPropertyValue('--ep-card-cta-text').trim()).toBe('#f8fafc');
    expect(achHost().style.getPropertyValue('--ep-card-cta-font-size').trim()).toBe('15px');
    expect(achHost().style.getPropertyValue('--ep-card-cta-radius').trim()).toBe('8px');
  });

  it('exits loading into pending and emits processing once', async () => {
    await waitUntilReady();
    adapter.confirmPayment.and.resolveTo({
      status: 'processing',
      method: 'us-bank-account',
      provider: 'usBankAccount',
      transactionId: 'pi_pending_1',
      message: 'Payment is processing.',
    });

    await panel().onPay();
    fixture.detectChanges();

    expect(panel().uiState()).toBe('pending');
    expect(achHost().querySelector('.ep-ach__pending')).toBeTruthy();
    expect(payButton().disabled).toBeTrue();
    expect(fixture.componentInstance.successes.length).toBe(1);
    expect(fixture.componentInstance.successes[0].status).toBe('processing');
    expect(fixture.componentInstance.busyChanges).toEqual([true, false]);

    await panel().onPay();
    expect(adapter.confirmPayment).toHaveBeenCalledTimes(1);
  });

  it('exits loading into success and emits once', async () => {
    await waitUntilReady();
    adapter.confirmPayment.and.resolveTo({
      status: 'success',
      method: 'us-bank-account',
      provider: 'usBankAccount',
      transactionId: 'pi_ok_1',
    });

    await panel().onPay();
    fixture.detectChanges();

    expect(panel().uiState()).toBe('success');
    expect(payButton().getAttribute('aria-busy')).not.toBe('true');
    expect(fixture.componentInstance.successes.length).toBe(1);
    expect(fixture.componentInstance.successes[0].status).toBe('success');
  });

  it('Buttons Only keeps the processing CTA after a verified pending emit', async () => {
    fixture.componentInstance.chrome.set('minimal');
    fixture.detectChanges();
    await waitUntilReady();

    adapter.confirmPayment.and.resolveTo({
      status: 'processing',
      method: 'us-bank-account',
      provider: 'usBankAccount',
      transactionId: 'pi_pending_min',
    });

    await panel().onPay();
    fixture.detectChanges();

    expect(panel().uiState()).toBe('pending');
    expect(achHost().querySelector('.ep-ach__pending-inline')).toBeNull();
    expect(achHost().querySelector('.ep-ach__pending')).toBeNull();
    expect(payButton().textContent?.trim()).toBe('Processing payment…');
    expect(payButton().getAttribute('aria-busy')).toBe('true');
    expect(fixture.componentInstance.successes.length).toBe(1);
    expect(fixture.componentInstance.successes[0].status).toBe('processing');

    await panel().onPay();
    expect(adapter.confirmPayment).toHaveBeenCalledTimes(1);
  });
});
