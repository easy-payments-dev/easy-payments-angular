import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideEasyPayments } from '../../config/provide-easy-payments';
import { BrowserGuard } from '../../utils/browser-guard';
import { FakeBrowserGuard, SAMPLE_PRODUCT } from '../../testing/test-doubles';
import { AmazonPayAdapter } from '../../adapters/amazon-pay/amazon-pay.adapter';
import { PaymentError } from '../../errors/payment-error';
import { PaymentResult, ResolvedPaymentTheme } from '../../models';
import { EasyPaymentsI18nService } from '../../i18n';
import { AmazonPayPaymentComponent } from './amazon-pay-payment.component';

@Component({
  standalone: true,
  imports: [AmazonPayPaymentComponent],
  providers: [EasyPaymentsI18nService],
  template: `
    <easy-amazon-pay-payment
      [product]="product"
      [resolvedTheme]="theme"
      [chrome]="chrome()"
      (success)="successes.push($event)"
      (error)="errors.push($event)"
      (started)="starts.push($event)"
    />
  `,
})
class AmazonPayHostComponent {
  readonly product = { ...SAMPLE_PRODUCT };
  readonly theme: ResolvedPaymentTheme = 'light';
  readonly chrome = signal<'full' | 'minimal'>('full');
  readonly successes: PaymentResult[] = [];
  readonly errors: PaymentError[] = [];
  readonly starts: void[] = [];
}

describe('AmazonPayPaymentComponent', () => {
  let fixture: ComponentFixture<AmazonPayHostComponent>;
  let amazonPay: jasmine.SpyObj<AmazonPayAdapter>;
  let mountOptions: {
    onReady?: () => void;
    onSuccess: (result: PaymentResult) => void;
    onError: (error: PaymentError) => void;
    onAttempt?: () => void;
    locale?: string;
  };

  beforeEach(async () => {
    amazonPay = jasmine.createSpyObj<AmazonPayAdapter>(
      'AmazonPayAdapter',
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
      { provider: 'amazonPay', isMock: false },
    );
    amazonPay.initialize.and.resolveTo();
    amazonPay.isConfigured.and.returnValue(true);
    amazonPay.addAvailabilityListener.and.returnValue(() => undefined);
    amazonPay.createMountId.and.returnValue('amazon-pay-ece-1');
    amazonPay.getAvailabilityStatus.and.returnValue('available');
    amazonPay.isAvailable.and.resolveTo(true);
    amazonPay.isProcessing.and.returnValue(false);
    amazonPay.mountExpressCheckout.and.callFake(async (_host, options, mountId) => {
      mountOptions = options as typeof mountOptions;
      options.onReady?.();
      return mountId ?? 'amazon-pay-ece-1';
    });

    await TestBed.configureTestingModule({
      imports: [AmazonPayHostComponent],
      providers: [
        provideEasyPayments({
          enableMockMode: false,
          providers: {
            stripe: { publishableKey: 'pk_test_amazon_pay_panel' },
            amazonPay: {},
          },
          backend: {
            amazonPayCreatePaymentUrl: '/api/payments/amazon-pay/create',
          },
        }),
        { provide: BrowserGuard, useValue: new FakeBrowserGuard() },
        { provide: AmazonPayAdapter, useValue: amazonPay },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AmazonPayHostComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it('shows Full Checkout success banner by default and emits success once', async () => {
    mountOptions.onAttempt?.();
    mountOptions.onSuccess({
      status: 'success',
      method: 'amazon-pay',
      provider: 'amazonPay',
      transactionId: 'pi_amazon_pay_full',
    });
    mountOptions.onSuccess({
      status: 'success',
      method: 'amazon-pay',
      provider: 'amazonPay',
      transactionId: 'pi_amazon_pay_full',
    });
    fixture.detectChanges();

    expect(fixture.componentInstance.starts.length).toBe(1);
    expect(fixture.componentInstance.successes.length).toBe(1);
    expect(fixture.nativeElement.querySelector('.ep-amazon-pay__success')?.textContent).toContain(
      'Payment completed',
    );
  });

  it('emits success without inline Payment completed when chrome is minimal', async () => {
    fixture.componentInstance.chrome.set('minimal');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    mountOptions.onAttempt?.();
    mountOptions.onSuccess({
      status: 'success',
      method: 'amazon-pay',
      provider: 'amazonPay',
      transactionId: 'pi_amazon_pay_minimal',
    });
    fixture.detectChanges();

    expect(fixture.componentInstance.successes.length).toBe(1);
    expect(fixture.nativeElement.querySelector('.ep-amazon-pay__success')).toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain('Payment completed');
    expect(fixture.nativeElement.querySelector('.ep-amazon-pay')?.getAttribute('data-chrome')).toBe(
      'minimal',
    );
    expect(fixture.nativeElement.querySelector('.ep-amazon-pay__button--hidden')).toBeTruthy();
  });

  it('re-localizes an existing error when locale changes without emitting again', async () => {
    const i18n = fixture.debugElement.injector.get(EasyPaymentsI18nService);
    mountOptions.onError(
      new PaymentError({
        code: 'SDK_LOAD_FAILED',
        message: 'boom',
        method: 'amazon-pay',
        provider: 'amazonPay',
      }),
    );
    fixture.detectChanges();

    expect(fixture.componentInstance.errors.length).toBe(1);
    expect(fixture.nativeElement.querySelector('.ep-amazon-pay__error')?.textContent).toContain(
      'Unable to load the payment provider',
    );

    i18n.setRequestedLocale('es');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.componentInstance.errors.length).toBe(1);
    expect(fixture.componentInstance.successes.length).toBe(0);
    expect(fixture.nativeElement.querySelector('.ep-amazon-pay__error')?.textContent).toContain(
      'No se pudo cargar el proveedor de pago',
    );
    expect(fixture.nativeElement.querySelector('.ep-amazon-pay__retry')?.textContent?.trim()).toBe(
      'Intentar de nuevo',
    );
  });

  it('passes the resolved Stripe Elements locale into ECE mount', async () => {
    const i18n = fixture.debugElement.injector.get(EasyPaymentsI18nService);
    i18n.setRequestedLocale('fr');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(mountOptions.locale).toBe('fr');
  });
});
