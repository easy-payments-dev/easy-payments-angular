import { Component, signal, ChangeDetectionStrategy } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { AffirmPaymentComponent } from './affirm-payment.component';
import { AffirmAdapter } from '../../adapters/affirm/affirm.adapter';
import { PaymentError } from '../../errors/payment-error';
import { PaymentProduct, PaymentResult, ResolvedPaymentTheme } from '../../models';
import {
  clearStripePendingReturn,
  markStripePendingReturn,
  STRIPE_PENDING_STORAGE_KEY,
} from '../../adapters/stripe/stripe-redirect-return';
import { resetTestLocation, setTestLocation } from '../../testing/test-history';

@Component({
  standalone: true,
  imports: [AffirmPaymentComponent],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    <easy-affirm-payment
      [product]="product()"
      [resolvedTheme]="theme()"
      (success)="onSuccess($event)"
      (cancel)="onCancel($event)"
      (error)="onError($event)"
      (returning)="onReturning($event)"
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

  successCount = 0;
  lastSuccess: PaymentResult | null = null;
  lastCancel: PaymentResult | null = null;
  lastError: PaymentError | null = null;
  returningEvents: boolean[] = [];

  onSuccess(result: PaymentResult): void {
    this.successCount += 1;
    this.lastSuccess = result;
  }

  onCancel(result: PaymentResult): void {
    this.lastCancel = result;
  }

  onError(error: PaymentError): void {
    this.lastError = error;
  }

  onReturning(active: boolean): void {
    this.returningEvents.push(active);
  }
}

describe('AffirmPaymentComponent session reuse', () => {
  let fixture: ComponentFixture<HostComponent>;
  let adapter: jasmine.SpyObj<AffirmAdapter>;

  beforeEach(async () => {
    clearStripePendingReturn();
    resetTestLocation();

    adapter = jasmine.createSpyObj<AffirmAdapter>('AffirmAdapter', [
      'ensureStripeLoaded',
      'createPaymentSession',
      'mountPaymentElement',
      'updateAppearance',
      'destroy',
      'confirmPayment',
      'consumeStripeReturn',
      'wasReturnConsumed',
      'isConfirming',
      'hasMountedElement',
    ]);

    adapter.ensureStripeLoaded.and.resolveTo({} as never);
    adapter.createPaymentSession.and.resolveTo({ clientSecret: 'pi_affirm_secret_1' });
    adapter.mountPaymentElement.and.resolveTo();
    adapter.updateAppearance.and.resolveTo();
    adapter.destroy.and.resolveTo();
    adapter.wasReturnConsumed.and.returnValue(false);
    adapter.isConfirming.and.returnValue(false);
    adapter.hasMountedElement.and.returnValue(true);

    await TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [{ provide: AffirmAdapter, useValue: adapter }],
    }).compileComponents();

    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    await Promise.resolve();
    await Promise.resolve();
  });

  afterEach(() => {
    clearStripePendingReturn();
    resetTestLocation();
  });

  it('creates a payment session once on mount', async () => {
    expect(adapter.createPaymentSession).toHaveBeenCalledTimes(1);
    expect(adapter.mountPaymentElement).toHaveBeenCalledTimes(1);
  });

  it('does not recreate the session when only theme changes', async () => {
    adapter.createPaymentSession.calls.reset();
    adapter.mountPaymentElement.calls.reset();

    fixture.componentInstance.theme.set('dark');
    fixture.detectChanges();
    await fixture.whenStable();
    await Promise.resolve();

    expect(adapter.createPaymentSession).not.toHaveBeenCalled();
    expect(adapter.mountPaymentElement).not.toHaveBeenCalled();
    expect(adapter.updateAppearance).toHaveBeenCalledWith('dark', jasmine.any(String));
  });

  it('does not recreate the session when product identity is unchanged', async () => {
    adapter.createPaymentSession.calls.reset();
    adapter.mountPaymentElement.calls.reset();

    fixture.componentInstance.product.set({
      id: 'premium-plan',
      name: 'Premium Plan (renamed)',
      amount: 49.99,
      currency: 'USD',
      quantity: 1,
    });
    fixture.detectChanges();
    await fixture.whenStable();
    await Promise.resolve();

    expect(adapter.createPaymentSession).not.toHaveBeenCalled();
    expect(adapter.mountPaymentElement).not.toHaveBeenCalled();
  });

  it('creates a new session when quantity changes', async () => {
    adapter.createPaymentSession.calls.reset();
    adapter.mountPaymentElement.calls.reset();
    adapter.createPaymentSession.and.resolveTo({ clientSecret: 'pi_affirm_secret_2' });

    fixture.componentInstance.product.update((p) => ({ ...p, quantity: 2 }));
    fixture.detectChanges();
    await fixture.whenStable();
    await Promise.resolve();
    await Promise.resolve();

    expect(adapter.createPaymentSession).toHaveBeenCalledTimes(1);
    expect(adapter.mountPaymentElement).toHaveBeenCalledTimes(1);
  });

  it('destroys the Affirm element on teardown', () => {
    const affirmDebug = fixture.debugElement.query(By.directive(AffirmPaymentComponent));
    expect(affirmDebug).toBeTruthy();
    fixture.destroy();
    expect(adapter.destroy).toHaveBeenCalled();
  });

  it('confirms payment when Pay is clicked and emits success once', async () => {
    adapter.confirmPayment.and.resolveTo({
      status: 'success',
      method: 'affirm',
      provider: 'affirm',
      transactionId: 'pi_affirm_1',
    });

    await fixture.whenStable();
    await Promise.resolve();
    fixture.detectChanges();

    const affirmDebug = fixture.debugElement.query(By.directive(AffirmPaymentComponent));
    const affirmCmp = affirmDebug.componentInstance as AffirmPaymentComponent;
    expect(affirmCmp.canPay()).toBeTrue();

    await affirmCmp.onPay();
    expect(adapter.confirmPayment).toHaveBeenCalled();
    expect(fixture.componentInstance.successCount).toBe(1);
    expect(fixture.componentInstance.lastSuccess?.method).toBe('affirm');
    expect(fixture.componentInstance.lastSuccess?.transactionId).toBe('pi_affirm_1');
    expect(sessionStorage.getItem(STRIPE_PENDING_STORAGE_KEY)).toBeNull();
  });
});

describe('AffirmPaymentComponent during Stripe redirect return', () => {
  let fixture: ComponentFixture<HostComponent>;
  let adapter: jasmine.SpyObj<AffirmAdapter>;

  afterEach(() => {
    clearStripePendingReturn();
    resetTestLocation();
  });

  it('does not create a new PaymentIntent while Affirm return params are present', async () => {
    markStripePendingReturn('affirm', 'premium-plan');
    setTestLocation(
      '/?payment_intent=pi_ret&payment_intent_client_secret=pi_ret_secret&ep_method=affirm',
    );

    adapter = jasmine.createSpyObj<AffirmAdapter>('AffirmAdapter', [
      'ensureStripeLoaded',
      'createPaymentSession',
      'mountPaymentElement',
      'updateAppearance',
      'destroy',
      'confirmPayment',
      'consumeStripeReturn',
      'wasReturnConsumed',
      'isConfirming',
      'hasMountedElement',
    ]);
    adapter.wasReturnConsumed.and.returnValue(false);
    adapter.isConfirming.and.returnValue(false);
    adapter.hasMountedElement.and.returnValue(false);
    adapter.destroy.and.resolveTo();

    await TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [{ provide: AffirmAdapter, useValue: adapter }],
    }).compileComponents();

    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    await Promise.resolve();
    await Promise.resolve();

    expect(adapter.createPaymentSession).not.toHaveBeenCalled();
    expect(adapter.consumeStripeReturn).not.toHaveBeenCalled();
  });
});
