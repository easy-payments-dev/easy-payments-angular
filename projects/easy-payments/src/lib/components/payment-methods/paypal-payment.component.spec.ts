import { Component, signal, ChangeDetectionStrategy } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideEasyPayments } from '../../config/provide-easy-payments';
import { PaymentProduct, ResolvedPaymentTheme } from '../../models';
import { PayPalAdapter } from '../../adapters/paypal/paypal.adapter';
import { PayPalNamespace } from '../../adapters/paypal/paypal.types';
import { SdkLoaderService } from '../../loaders/sdk-loader.service';
import { PayPalPaymentComponent } from './paypal-payment.component';

@Component({
  standalone: true,
  imports: [PayPalPaymentComponent],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    <easy-paypal-payment
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

describe('PayPalPaymentComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;
  let adapter: jasmine.SpyObj<PayPalAdapter>;

  beforeEach(async () => {
    adapter = jasmine.createSpyObj<PayPalAdapter>('PayPalAdapter', [
      'ensureSdkLoaded',
      'renderButtons',
      'destroyButtons',
      'destroy',
      'createOrder',
      'captureOrder',
      'isBusy',
      'getActiveOrderId',
    ]);
    adapter.ensureSdkLoaded.and.resolveTo({} as never);
    adapter.renderButtons.and.resolveTo('mount-host-1');
    adapter.destroyButtons.and.resolveTo();
    adapter.destroy.and.resolveTo();
    adapter.isBusy.and.returnValue(false);
    adapter.getActiveOrderId.and.returnValue(null);

    await TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [
        provideEasyPayments({
          enableMockMode: false,
          providers: { paypal: { clientId: 'sb' } },
          backend: {
            paypalCreateOrderUrl: '/paypal/create',
            paypalCaptureOrderUrl: '/paypal/capture',
          },
        }),
        { provide: PayPalAdapter, useValue: adapter },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it('renders PayPal Buttons once on mount', async () => {
    expect(adapter.ensureSdkLoaded).toHaveBeenCalledTimes(1);
    expect(adapter.renderButtons).toHaveBeenCalledTimes(1);
  });

  it('does not recreate buttons on theme change', async () => {
    adapter.renderButtons.calls.reset();
    adapter.ensureSdkLoaded.calls.reset();

    host.theme.set('dark');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(adapter.renderButtons).not.toHaveBeenCalled();
    expect(adapter.ensureSdkLoaded).not.toHaveBeenCalled();
  });

  it('re-renders when product identity changes', async () => {
    adapter.renderButtons.calls.reset();
    adapter.renderButtons.and.resolveTo('mount-host-1');

    host.product.set({
      id: 'premium-plan',
      name: 'Premium Plan',
      amount: 99.99,
      currency: 'USD',
      quantity: 2,
    });
    fixture.detectChanges();
    await fixture.whenStable();

    expect(adapter.renderButtons).toHaveBeenCalledTimes(1);
    expect(adapter.renderButtons.calls.mostRecent().args[3]).toBe('mount-host-1');
  });

  it('cleans up only its Buttons mount on destroy (not adapter.destroy)', () => {
    fixture.destroy();
    expect(adapter.destroyButtons).toHaveBeenCalledWith('mount-host-1');
    expect(adapter.destroy).not.toHaveBeenCalled();
  });

  it('wires createOrder / onApprove / onCancel callbacks', async () => {
    const options = adapter.renderButtons.calls.mostRecent().args[1];
    expect(options.createOrder).toBeTruthy();
    expect(options.onApprove).toBeTruthy();
    expect(options.onCancel).toBeTruthy();

    adapter.createOrder.and.resolveTo('ORDER-1');
    await options.createOrder();
    await options.createOrder();
    expect(adapter.createOrder).toHaveBeenCalledTimes(2);
    expect(host.starts.length).toBe(1);

    adapter.captureOrder.and.resolveTo({
      status: 'success',
      method: 'paypal',
      provider: 'paypal',
      transactionId: 'CAPTURE-1',
      sessionId: 'ORDER-1',
    });
    await options.onApprove({ orderID: 'ORDER-1' });
    await options.onApprove({ orderID: 'ORDER-1' });
    expect(adapter.captureOrder).toHaveBeenCalledTimes(1);
    expect(host.successes.length).toBe(1);
    expect(host.starts.length).toBe(1);
    expect(JSON.stringify(host.successes)).not.toContain('client_secret');

    options.onCancel?.();
    fixture.detectChanges();
    expect(host.cancels.length).toBe(1);
  });

  it('reports its own order id on cancel, never another host order', async () => {
    const options = adapter.renderButtons.calls.mostRecent().args[1];
    adapter.createOrder.and.resolveTo('ORDER-OWN');
    adapter.getActiveOrderId.and.returnValue('ORDER-OTHER-HOST');
    await options.createOrder();

    options.onCancel?.();
    fixture.detectChanges();
    expect(host.cancels.length).toBe(1);
    expect((host.cancels[0] as { sessionId?: string }).sessionId).toBe('ORDER-OWN');
    expect(adapter.createOrder).toHaveBeenCalledWith(
      jasmine.anything(),
      undefined,
      jasmine.any(String),
    );
  });

  it('exposes the buttons host for official PayPal UI', () => {
    const component = fixture.debugElement.query(By.directive(PayPalPaymentComponent));
    expect(component).toBeTruthy();
    expect(fixture.nativeElement.querySelector('[aria-label="PayPal official checkout"]')).toBeTruthy();
  });

  it('does not mention Stripe in the PayPal security helper text', () => {
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Secure checkout powered by PayPal');
    expect(text.toLowerCase()).not.toContain('stripe');
  });
});

describe('PayPalPaymentComponent compact', () => {
  let fixture: ComponentFixture<PayPalPaymentComponent>;
  let adapter: jasmine.SpyObj<PayPalAdapter>;

  beforeEach(async () => {
    adapter = jasmine.createSpyObj<PayPalAdapter>('PayPalAdapter', [
      'ensureSdkLoaded',
      'renderButtons',
      'destroyButtons',
      'destroy',
      'createOrder',
      'captureOrder',
      'isBusy',
      'getActiveOrderId',
    ]);
    adapter.ensureSdkLoaded.and.resolveTo({} as never);
    adapter.renderButtons.and.resolveTo('mount-compact-1');
    adapter.destroyButtons.and.resolveTo();
    adapter.destroy.and.resolveTo();
    adapter.isBusy.and.returnValue(false);
    adapter.getActiveOrderId.and.returnValue(null);

    await TestBed.configureTestingModule({
      imports: [PayPalPaymentComponent],
      providers: [
        provideEasyPayments({
          enableMockMode: false,
          providers: { paypal: { clientId: 'sb' } },
          backend: {
            paypalCreateOrderUrl: '/paypal/create',
            paypalCaptureOrderUrl: '/paypal/capture',
          },
        }),
        { provide: PayPalAdapter, useValue: adapter },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(PayPalPaymentComponent);
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

  it('hides checkout chrome while still mounting official Buttons', () => {
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).not.toContain('Pay with PayPal');
    expect(text).not.toContain('Secure checkout powered by PayPal');
    expect(adapter.renderButtons).toHaveBeenCalledTimes(1);
    expect(fixture.nativeElement.querySelector('.ep-paypal--compact')).toBeTruthy();
  });
});

describe('PayPalPaymentComponent dual-host mount ownership', () => {
  @Component({
    standalone: true,
    imports: [PayPalPaymentComponent],
    changeDetection: ChangeDetectionStrategy.Eager,
    template: `
      <easy-paypal-payment
        [product]="product"
        [resolvedTheme]="'light'"
        [compact]="true"
        (started)="starts.push($event)"
        (success)="successes.push($event)"
        (cancel)="cancels.push($event)"
        (error)="errors.push($event)"
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
    cancels: unknown[] = [];
    errors: unknown[] = [];
  }

  let adapter: PayPalAdapter;
  let closes: jasmine.Spy[];
  let paypalNs: PayPalNamespace;
  let renderSpy: jasmine.Spy;

  beforeEach(async () => {
    closes = [];
    renderSpy = jasmine.createSpy('render').and.resolveTo();
    paypalNs = {
      Buttons: jasmine.createSpy('Buttons').and.callFake(() => {
        const close = jasmine.createSpy('close').and.resolveTo();
        closes.push(close);
        return { render: renderSpy, close };
      }),
    };

    const sdkLoader = jasmine.createSpyObj<SdkLoaderService>('SdkLoaderService', [
      'loadScript',
      'unloadScript',
    ]);
    sdkLoader.loadScript.and.callFake(async () => {
      (window as Window & { paypal?: PayPalNamespace }).paypal = paypalNs;
    });

    await TestBed.configureTestingModule({
      imports: [DualHost],
      providers: [
        provideEasyPayments({
          enableMockMode: false,
          providers: { paypal: { clientId: 'sb-dual' } },
          backend: {
            paypalCreateOrderUrl: '/paypal/create',
            paypalCaptureOrderUrl: '/paypal/capture',
          },
        }),
        { provide: SdkLoaderService, useValue: sdkLoader },
      ],
    }).compileComponents();

    adapter = TestBed.inject(PayPalAdapter);
    await adapter.initialize();
  });

  afterEach(() => {
    delete (window as Window & { paypal?: PayPalNamespace }).paypal;
  });

  it('destroying one PayPal host leaves the sibling mount functional', async () => {
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
    expect(closes.length).toBe(2);

    const optionsB = (paypalNs.Buttons as jasmine.Spy).calls.mostRecent().args[0];
    expect(optionsB.createOrder).toBeTruthy();

    fixtureA.destroy();
    await Promise.resolve();

    expect(closes[0]).toHaveBeenCalledTimes(1);
    expect(closes[1]).not.toHaveBeenCalled();
    expect(adapter.getActiveButtonMountCount()).toBe(1);

    // Sibling callbacks still work; no duplicate success from the destroyed host.
    const createSpy = spyOn(adapter, 'createOrder').and.resolveTo('ORDER-B');
    const captureSpy = spyOn(adapter, 'captureOrder').and.resolveTo({
      status: 'success',
      method: 'paypal',
      provider: 'paypal',
      transactionId: 'CAP-B',
      sessionId: 'ORDER-B',
    });

    await optionsB.createOrder();
    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(fixtureA.componentInstance.starts.length).toBe(0);
    expect(fixtureB.componentInstance.starts.length).toBe(1);

    await optionsB.onApprove({ orderID: 'ORDER-B' });
    await optionsB.onApprove({ orderID: 'ORDER-B' });
    expect(captureSpy).toHaveBeenCalledTimes(1);
    expect(fixtureB.componentInstance.successes.length).toBe(1);
    expect(fixtureA.componentInstance.successes.length).toBe(0);

    fixtureB.destroy();
    await Promise.resolve();
    expect(closes[1]).toHaveBeenCalledTimes(1);
    expect(adapter.getActiveButtonMountCount()).toBe(0);
  });
});
