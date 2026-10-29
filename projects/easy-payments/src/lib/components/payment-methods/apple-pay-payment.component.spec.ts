import { Component, signal, ChangeDetectionStrategy } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideEasyPayments } from '../../config/provide-easy-payments';
import { PaymentProduct, ResolvedPaymentTheme } from '../../models';
import { ApplePayAdapter } from '../../adapters/apple-pay/apple-pay.adapter';
import { ApplePayPaymentComponent } from './apple-pay-payment.component';

@Component({
  standalone: true,
  imports: [ApplePayPaymentComponent],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    <easy-apple-pay-payment
      [product]="product()"
      [resolvedTheme]="theme()"
      (success)="successes.push($event)"
      (cancel)="cancels.push($event)"
      (error)="errors.push($event)"
    />
  `,
})
class HostComponent {
  readonly product = signal<PaymentProduct>({
    id: 'premium-plan',
    name: 'Premium Plan',
    amount: 99.99,
    currency: 'USD',
    quantity: 1,
  });
  readonly theme = signal<ResolvedPaymentTheme>('light');
  successes: unknown[] = [];
  cancels: unknown[] = [];
  errors: unknown[] = [];
}

describe('ApplePayPaymentComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;
  let adapter: jasmine.SpyObj<ApplePayAdapter>;

  beforeEach(async () => {
    adapter = jasmine.createSpyObj<ApplePayAdapter>('ApplePayAdapter', [
      'isConfigured',
      'createMountId',
      'mountExpressCheckout',
      'unmountExpressCheckout',
      'destroy',
      'isProcessing',
      'getAvailabilityStatus',
    ]);
    adapter.isConfigured.and.returnValue(true);
    adapter.createMountId.and.returnValue('apple-pay-ece-1');
    adapter.getAvailabilityStatus.and.returnValue('checking');
    adapter.mountExpressCheckout.and.callFake(async (_host, options, mountId) => {
      options.onReady?.();
      return mountId ?? 'apple-pay-ece-1';
    });
    adapter.isProcessing.and.returnValue(false);
    adapter.destroy.and.resolveTo();

    await TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [
        provideEasyPayments({
          enableMockMode: false,
          providers: {
            stripe: { publishableKey: 'pk_test_123' },
            applePay: { merchantName: 'Demo' },
          },
          backend: { createPaymentUrl: '/api/payments/create' },
        }),
        { provide: ApplePayAdapter, useValue: adapter },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('mounts Express Checkout without a pre-mount isAvailable probe', async () => {
    expect(adapter.mountExpressCheckout).toHaveBeenCalled();
    expect(adapter.isConfigured).toHaveBeenCalled();
  });

  it('does not remount on identical product/theme when already ready', async () => {
    adapter.getAvailabilityStatus.and.returnValue('available');
    const mountArgs = adapter.mountExpressCheckout.calls.mostRecent().args[1];
    mountArgs.onReady?.();
    fixture.detectChanges();
    await fixture.whenStable();

    const calls = adapter.mountExpressCheckout.calls.count();
    host.product.set({ ...host.product() });
    fixture.detectChanges();
    await fixture.whenStable();
    expect(adapter.mountExpressCheckout.calls.count()).toBe(calls);
  });

  it('emits success only once', async () => {
    const mountArgs = adapter.mountExpressCheckout.calls.mostRecent().args[1];
    mountArgs.onSuccess({
      status: 'success',
      method: 'apple-pay',
      provider: 'applePay',
      transactionId: 'pi_1',
    });
    mountArgs.onSuccess({
      status: 'success',
      method: 'apple-pay',
      provider: 'applePay',
      transactionId: 'pi_1',
    });
    expect(host.successes.length).toBe(1);
  });

  it('maps cancel from adapter', async () => {
    const mountArgs = adapter.mountExpressCheckout.calls.mostRecent().args[1];
    mountArgs.onCancel();
    expect(host.cancels.length).toBe(1);
    expect(host.cancels[0]).toEqual(
      jasmine.objectContaining({
        status: 'cancelled',
        method: 'apple-pay',
      }),
    );
  });

  it('does not mount when Apple Pay is not configured', async () => {
    adapter.isConfigured.and.returnValue(false);
    adapter.mountExpressCheckout.calls.reset();
    host.product.set({
      id: 'premium-plan',
      name: 'Premium Plan',
      amount: 49.99,
      currency: 'USD',
      quantity: 1,
    });
    fixture.detectChanges();
    await fixture.whenStable();
    expect(adapter.mountExpressCheckout).not.toHaveBeenCalled();
  });

  it('marks unavailable when ECE ready reports no Apple Pay', async () => {
    const mountArgs = adapter.mountExpressCheckout.calls.mostRecent().args[1];
    adapter.getAvailabilityStatus.and.returnValue('unavailable');
    mountArgs.onUnavailable?.();
    fixture.detectChanges();
    await fixture.whenStable();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('not available');
  });

  it('unmounts its owned ECE mount on destroy without adapter.destroy', () => {
    fixture.destroy();
    expect(adapter.unmountExpressCheckout).toHaveBeenCalledWith({
      preserveAvailability: true,
      mountId: 'apple-pay-ece-1',
    });
    expect(adapter.destroy).not.toHaveBeenCalled();
  });
});

describe('ApplePayPaymentComponent compact + ownership', () => {
  let fixture: ComponentFixture<ApplePayPaymentComponent>;
  let adapter: jasmine.SpyObj<ApplePayAdapter>;

  beforeEach(async () => {
    adapter = jasmine.createSpyObj<ApplePayAdapter>('ApplePayAdapter', [
      'isConfigured',
      'createMountId',
      'mountExpressCheckout',
      'unmountExpressCheckout',
      'destroy',
      'isProcessing',
      'getAvailabilityStatus',
    ]);
    adapter.isConfigured.and.returnValue(true);
    adapter.createMountId.and.returnValue('apple-pay-ece-compact-1');
    adapter.getAvailabilityStatus.and.returnValue('checking');
    adapter.mountExpressCheckout.and.callFake(async (_host, options, mountId) => {
      options.onReady?.();
      return mountId ?? 'apple-pay-ece-compact-1';
    });
    adapter.isProcessing.and.returnValue(false);

    await TestBed.configureTestingModule({
      imports: [ApplePayPaymentComponent],
      providers: [
        provideEasyPayments({
          enableMockMode: false,
          providers: {
            stripe: { publishableKey: 'pk_test_123' },
            applePay: { merchantName: 'Demo' },
          },
          backend: { createPaymentUrl: '/api/payments/create' },
        }),
        { provide: ApplePayAdapter, useValue: adapter },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ApplePayPaymentComponent);
    fixture.componentRef.setInput('product', {
      id: 'premium-plan',
      name: 'Premium Plan',
      amount: 99.99,
      currency: 'USD',
      quantity: 1,
    });
    fixture.componentRef.setInput('resolvedTheme', 'light');
    fixture.componentRef.setInput('compact', true);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it('hides checkout chrome while mounting Apple Pay–only ECE', () => {
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).not.toContain('Pay with Apple Pay');
    expect(adapter.mountExpressCheckout).toHaveBeenCalled();
    expect(adapter.mountExpressCheckout.calls.mostRecent().args[2]).toBe(
      'apple-pay-ece-compact-1',
    );
    expect(fixture.nativeElement.querySelector('.ep-apay--compact')).toBeTruthy();
  });

  it('passes owned mountId to unmount on destroy', () => {
    fixture.destroy();
    expect(adapter.unmountExpressCheckout).toHaveBeenCalledWith({
      preserveAvailability: true,
      mountId: 'apple-pay-ece-compact-1',
    });
  });
});
