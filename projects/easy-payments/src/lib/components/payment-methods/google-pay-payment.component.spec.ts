import { Component, signal, ChangeDetectionStrategy } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideEasyPayments } from '../../config/provide-easy-payments';
import { PaymentProduct, ResolvedPaymentTheme } from '../../models';
import { GooglePayAdapter } from '../../adapters/google-pay/google-pay.adapter';
import { GooglePaySdkLoader } from '../../adapters/google-pay/google-pay-sdk.loader';
import { StripeSdkLoader } from '../../adapters/stripe/stripe-sdk.loader';
import { GooglePayPaymentComponent } from './google-pay-payment.component';
import { PaymentError } from '../../errors/payment-error';

@Component({
  standalone: true,
  imports: [GooglePayPaymentComponent],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    <easy-google-pay-payment
      [product]="product()"
      [resolvedTheme]="theme()"
      (started)="starts.push($event)"
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
  starts: unknown[] = [];
  successes: unknown[] = [];
  cancels: unknown[] = [];
  errors: unknown[] = [];
}

describe('GooglePayPaymentComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;
  let adapter: jasmine.SpyObj<GooglePayAdapter>;

  beforeEach(async () => {
    adapter = jasmine.createSpyObj<GooglePayAdapter>('GooglePayAdapter', [
      'isAvailable',
      'renderOfficialButton',
      'payWithGooglePay',
      'destroy',
      'destroyButtonMount',
      'clearButtonHost',
      'isProcessing',
    ]);
    adapter.isAvailable.and.resolveTo(true);
    adapter.renderOfficialButton.and.resolveTo('google-pay-button-1');
    adapter.destroy.and.resolveTo();
    adapter.destroyButtonMount.and.stub();
    adapter.isProcessing.and.returnValue(false);

    await TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [
        provideEasyPayments({
          enableMockMode: false,
          providers: {
            stripe: { publishableKey: 'pk_test_123' },
            googlePay: { environment: 'TEST', merchantName: 'Demo' },
          },
          backend: { createPaymentUrl: '/api/payments/create' },
        }),
        { provide: GooglePayAdapter, useValue: adapter },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it('renders the official button once on mount', async () => {
    expect(adapter.isAvailable).toHaveBeenCalled();
    expect(adapter.renderOfficialButton).toHaveBeenCalledTimes(1);
  });

  it('does not start payments when theme changes (only restyles button)', async () => {
    adapter.renderOfficialButton.calls.reset();
    adapter.isAvailable.calls.reset();
    adapter.renderOfficialButton.and.resolveTo('google-pay-button-1');

    host.theme.set('dark');
    fixture.detectChanges();
    await fixture.whenStable();

    // Theme change may rebuild the official button style, but never payWithGooglePay.
    expect(adapter.payWithGooglePay).not.toHaveBeenCalled();
  });

  it('uses Google Pay security copy without claiming Stripe branding', () => {
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Secure checkout with Google Pay');
    expect(text).toContain('Pay with Google Pay');
  });

  it('cleans up only its button mount on destroy (not adapter.destroy)', () => {
    fixture.destroy();
    expect(adapter.destroyButtonMount).toHaveBeenCalledWith('google-pay-button-1');
    expect(adapter.destroy).not.toHaveBeenCalled();
  });

  it('wires the official button click into the payment flow without premature success', async () => {
    const options = adapter.renderOfficialButton.calls.mostRecent().args[1];
    expect(host.starts.length).toBe(0);
    expect(host.successes.length).toBe(0);

    adapter.payWithGooglePay.and.resolveTo({
      status: 'success',
      method: 'google-pay',
      provider: 'googlePay',
      transactionId: 'pi_1',
    });

    await options.onClick();
    expect(adapter.payWithGooglePay).toHaveBeenCalled();
    expect(host.starts.length).toBe(1);
    expect(host.successes.length).toBe(1);
  });

  it('emits cancel without success when the buyer cancels the sheet', async () => {
    const options = adapter.renderOfficialButton.calls.mostRecent().args[1];
    adapter.payWithGooglePay.and.rejectWith(
      new PaymentError({
        code: 'PAYMENT_CANCELLED',
        message: 'Cancelled',
        method: 'google-pay',
        provider: 'googlePay',
      }),
    );

    await options.onClick();
    expect(host.cancels.length).toBe(1);
    expect(host.successes.length).toBe(0);
  });
});

describe('GooglePayPaymentComponent compact', () => {
  let fixture: ComponentFixture<GooglePayPaymentComponent>;
  let adapter: jasmine.SpyObj<GooglePayAdapter>;

  beforeEach(async () => {
    adapter = jasmine.createSpyObj<GooglePayAdapter>('GooglePayAdapter', [
      'isAvailable',
      'renderOfficialButton',
      'payWithGooglePay',
      'destroy',
      'destroyButtonMount',
      'clearButtonHost',
      'isProcessing',
    ]);
    adapter.isAvailable.and.resolveTo(true);
    adapter.renderOfficialButton.and.resolveTo('google-pay-button-compact');
    adapter.destroyButtonMount.and.stub();
    adapter.isProcessing.and.returnValue(false);

    await TestBed.configureTestingModule({
      imports: [GooglePayPaymentComponent],
      providers: [
        provideEasyPayments({
          enableMockMode: false,
          providers: {
            stripe: { publishableKey: 'pk_test_123' },
            googlePay: { environment: 'TEST', merchantName: 'Demo' },
          },
          backend: { createPaymentUrl: '/api/payments/create' },
        }),
        { provide: GooglePayAdapter, useValue: adapter },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(GooglePayPaymentComponent);
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

  it('hides checkout chrome while still mounting the official button', () => {
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).not.toContain('Pay with Google Pay');
    expect(text).not.toContain('Secure checkout with Google Pay');
    expect(adapter.renderOfficialButton).toHaveBeenCalledTimes(1);
    expect(fixture.nativeElement.querySelector('.ep-gpay--compact')).toBeTruthy();
  });
});

describe('GooglePayPaymentComponent dual-host mount ownership', () => {
  @Component({
    standalone: true,
    imports: [GooglePayPaymentComponent],
    changeDetection: ChangeDetectionStrategy.Eager,
    template: `
      <easy-google-pay-payment
        [product]="product"
        [resolvedTheme]="'light'"
        [compact]="true"
        (started)="starts.push($event)"
        (success)="successes.push($event)"
      />
    `,
  })
  class DualHost {
    product: PaymentProduct = {
      id: 'premium-plan',
      name: 'Premium Plan',
      amount: 99.99,
      currency: 'USD',
      quantity: 1,
    };
    starts: unknown[] = [];
    successes: unknown[] = [];
  }

  let adapter: GooglePayAdapter;
  let clickHandlers: Array<() => void | Promise<void>>;

  beforeEach(async () => {
    clickHandlers = [];
    const paymentsClient = jasmine.createSpyObj('PaymentsClient', [
      'isReadyToPay',
      'createButton',
      'loadPaymentData',
    ]);
    paymentsClient.isReadyToPay.and.resolveTo({ result: true });
    paymentsClient.createButton.and.callFake((options: { onClick: (event: Event) => void }) => {
      const el = document.createElement('button');
      el.type = 'button';
      el.textContent = 'GPay';
      el.addEventListener('click', (event) => options.onClick(event));
      clickHandlers.push(async () => options.onClick(new Event('click')));
      return el;
    });

    const googleNs = {
      payments: {
        api: {
          PaymentsClient: jasmine.createSpy('PaymentsClient').and.returnValue(paymentsClient),
        },
      },
    };

    const googlePaySdk = jasmine.createSpyObj<GooglePaySdkLoader>('GooglePaySdkLoader', ['load']);
    googlePaySdk.load.and.resolveTo(googleNs as never);
    const stripeSdk = jasmine.createSpyObj<StripeSdkLoader>('StripeSdkLoader', ['load']);
    stripeSdk.load.and.resolveTo({} as never);

    await TestBed.configureTestingModule({
      imports: [DualHost],
      providers: [
        provideEasyPayments({
          enableMockMode: false,
          providers: {
            stripe: { publishableKey: 'pk_test_dual' },
            googlePay: { environment: 'TEST', merchantName: 'Demo' },
          },
          backend: { createPaymentUrl: '/api/payments/create' },
        }),
        { provide: GooglePaySdkLoader, useValue: googlePaySdk },
        { provide: StripeSdkLoader, useValue: stripeSdk },
      ],
    }).compileComponents();

    adapter = TestBed.inject(GooglePayAdapter);
    await adapter.initialize();
  });

  it('destroying one Google Pay host leaves the sibling mount functional', async () => {
    const fixtureA = TestBed.createComponent(DualHost);
    const fixtureB = TestBed.createComponent(DualHost);
    fixtureB.componentInstance.product = {
      ...fixtureB.componentInstance.product,
      id: 'other-plan',
    };

    fixtureA.detectChanges();
    fixtureB.detectChanges();
    await fixtureA.whenStable();
    await fixtureB.whenStable();
    await Promise.resolve();
    await Promise.resolve();
    fixtureA.detectChanges();
    fixtureB.detectChanges();

    expect(adapter.getActiveButtonMountCount()).toBe(2);
    expect(clickHandlers.length).toBe(2);

    fixtureA.destroy();
    expect(adapter.getActiveButtonMountCount()).toBe(1);

    const paySpy = spyOn(adapter, 'payWithGooglePay').and.resolveTo({
      status: 'success',
      method: 'google-pay',
      provider: 'googlePay',
      transactionId: 'pi_b',
    });

    await clickHandlers[1]();
    expect(paySpy).toHaveBeenCalledTimes(1);
    expect(fixtureA.componentInstance.starts.length).toBe(0);
    expect(fixtureB.componentInstance.starts.length).toBe(1);
    expect(fixtureB.componentInstance.successes.length).toBe(1);
    expect(fixtureA.componentInstance.successes.length).toBe(0);

    fixtureB.destroy();
    expect(adapter.getActiveButtonMountCount()).toBe(0);
  });
});
