import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideEasyPayments } from '../../config/provide-easy-payments';
import { PaymentProduct, ResolvedPaymentTheme } from '../../models';
import { VenmoAdapter } from '../../adapters/venmo/venmo.adapter';
import { VenmoPaymentComponent } from './venmo-payment.component';

@Component({
  standalone: true,
  imports: [VenmoPaymentComponent],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    <easy-venmo-payment
      [product]="product()"
      [resolvedTheme]="theme()"
      [compact]="compact()"
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
  readonly compact = signal(false);
  starts: unknown[] = [];
  successes: unknown[] = [];
  cancels: unknown[] = [];
  errors: unknown[] = [];
}

describe('VenmoPaymentComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;
  let adapter: jasmine.SpyObj<VenmoAdapter>;
  let createOrderFn: (() => Promise<string>) | undefined;
  let onApproveFn: ((data: { orderID: string }) => Promise<void>) | undefined;
  let onCancelFn: (() => void) | undefined;

  beforeEach(async () => {
    adapter = jasmine.createSpyObj<VenmoAdapter>('VenmoAdapter', [
      'ensureSdkLoaded',
      'renderButtons',
      'destroyButtons',
      'createOrder',
      'captureOrder',
      'isBusy',
      'getActiveOrderId',
    ]);
    adapter.ensureSdkLoaded.and.resolveTo({} as never);
    adapter.destroyButtons.and.resolveTo();
    adapter.isBusy.and.returnValue(false);
    adapter.getActiveOrderId.and.returnValue(null);
    adapter.renderButtons.and.callFake(async (_host, options) => {
      createOrderFn = options.createOrder;
      onApproveFn = options.onApprove;
      onCancelFn = options.onCancel;
      return 'venmo-mount-1';
    });

    await TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [
        provideEasyPayments({
          enableMockMode: false,
          providers: {
            paypal: { clientId: 'sb' },
            venmo: { sandboxBuyerCountry: 'US' },
          },
          backend: {
            paypalCreateOrderUrl: '/paypal/create',
            paypalCaptureOrderUrl: '/paypal/capture',
          },
        }),
        { provide: VenmoAdapter, useValue: adapter },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it('renders Venmo Buttons once on mount', async () => {
    expect(adapter.ensureSdkLoaded).toHaveBeenCalledTimes(1);
    expect(adapter.renderButtons).toHaveBeenCalledTimes(1);
  });

  it('guards duplicate capture and success emissions', async () => {
    adapter.createOrder.and.resolveTo('ORDER-V');
    adapter.captureOrder.and.resolveTo({
      status: 'success',
      method: 'venmo',
      provider: 'venmo',
      transactionId: 'CAP-V',
      sessionId: 'ORDER-V',
    });

    await createOrderFn!();
    expect(host.starts.length).toBe(1);

    await onApproveFn!({ orderID: 'ORDER-V' });
    await onApproveFn!({ orderID: 'ORDER-V' });

    expect(adapter.captureOrder).toHaveBeenCalledTimes(1);
    expect(host.successes.length).toBe(1);
    expect((host.successes[0] as { method: string }).method).toBe('venmo');
  });

  it('emits cancel once and returns to ready for retry', async () => {
    onCancelFn!();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(host.cancels.length).toBe(1);
    expect((host.cancels[0] as { method: string }).method).toBe('venmo');
  });

  it('omits strip banners in compact mode', async () => {
    host.compact.set(true);
    fixture.detectChanges();
    await fixture.whenStable();

    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('.ep-venmo--compact')).toBeTruthy();
    expect(root.querySelector('.ep-venmo__header')).toBeNull();
  });
});
