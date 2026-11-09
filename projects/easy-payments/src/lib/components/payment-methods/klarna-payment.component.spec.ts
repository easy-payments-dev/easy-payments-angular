import { Component, signal, ChangeDetectionStrategy } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { KlarnaPaymentComponent } from './klarna-payment.component';
import { KlarnaAdapter } from '../../adapters/klarna/klarna.adapter';
import { PaymentError } from '../../errors/payment-error';
import { PaymentProduct, PaymentResult, ResolvedPaymentTheme } from '../../models';
import {
  clearKlarnaPendingReturn,
  KLARNA_PENDING_STORAGE_KEY,
  markKlarnaPendingReturn,
} from '../../adapters/klarna/klarna-return';
import {
  markStripePendingReturn,
  readStripePendingReturn,
} from '../../adapters/stripe/stripe-redirect-return';
import { StripeConfirmationGate } from '../../adapters/stripe/stripe-confirmation-gate';
import { resetTestLocation, setTestLocation } from '../../testing/test-history';

@Component({
  standalone: true,
  imports: [KlarnaPaymentComponent],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    <easy-klarna-payment
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

describe('KlarnaPaymentComponent session reuse', () => {
  let fixture: ComponentFixture<HostComponent>;
  let adapter: jasmine.SpyObj<KlarnaAdapter>;

  beforeEach(async () => {
    clearKlarnaPendingReturn();
    resetTestLocation();

    adapter = jasmine.createSpyObj<KlarnaAdapter>('KlarnaAdapter', [
      'ensureStripeLoaded',
      'createPaymentSession',
      'mountPaymentElement',
      'updateAppearance',
      'destroy',
      'confirmPayment',
      'retrieveReturningPayment',
      'consumeStripeReturn',
      'wasReturnConsumed',
      'isConfirming',
      'hasMountedElement',
    ]);

    adapter.ensureStripeLoaded.and.resolveTo({} as never);
    adapter.createPaymentSession.and.resolveTo({ clientSecret: 'pi_klarna_secret_1' });
    adapter.mountPaymentElement.and.resolveTo();
    adapter.updateAppearance.and.resolveTo();
    adapter.destroy.and.resolveTo();
    adapter.wasReturnConsumed.and.returnValue(false);
    adapter.isConfirming.and.returnValue(false);
    adapter.hasMountedElement.and.returnValue(true);

    await TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [{ provide: KlarnaAdapter, useValue: adapter }],
    }).compileComponents();

    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    await Promise.resolve();
    await Promise.resolve();
  });

  afterEach(() => {
    clearKlarnaPendingReturn();
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
    adapter.createPaymentSession.and.resolveTo({ clientSecret: 'pi_klarna_secret_2' });

    fixture.componentInstance.product.update((p) => ({ ...p, quantity: 2 }));
    fixture.detectChanges();
    await fixture.whenStable();
    await Promise.resolve();
    await Promise.resolve();

    expect(adapter.createPaymentSession).toHaveBeenCalledTimes(1);
    expect(adapter.mountPaymentElement).toHaveBeenCalledTimes(1);
  });

  it('destroys the Klarna element on teardown', () => {
    const klarnaDebug = fixture.debugElement.query(By.directive(KlarnaPaymentComponent));
    expect(klarnaDebug).toBeTruthy();
    fixture.destroy();
    expect(adapter.destroy).toHaveBeenCalled();
  });

  it('confirms payment when Pay is clicked and emits success once', async () => {
    adapter.confirmPayment.and.resolveTo({
      status: 'success',
      method: 'klarna',
      provider: 'klarna',
      transactionId: 'pi_klarna_1',
    });

    await fixture.whenStable();
    await Promise.resolve();
    fixture.detectChanges();

    const klarnaDebug = fixture.debugElement.query(By.directive(KlarnaPaymentComponent));
    const klarnaCmp = klarnaDebug.componentInstance as KlarnaPaymentComponent;
    expect(klarnaCmp.canPay()).toBeTrue();

    await klarnaCmp.onPay();
    expect(adapter.confirmPayment).toHaveBeenCalled();
    expect(fixture.componentInstance.successCount).toBe(1);
    expect(fixture.componentInstance.lastSuccess?.method).toBe('klarna');
    expect(fixture.componentInstance.lastSuccess?.transactionId).toBe('pi_klarna_1');
    expect(sessionStorage.getItem(KLARNA_PENDING_STORAGE_KEY)).toBeNull();
  });

  it('allows a retry after a failed confirm and emits each terminal outcome once', async () => {
    adapter.confirmPayment.and.rejectWith(
      new PaymentError({ code: 'PAYMENT_FAILED', message: 'declined', method: 'klarna', provider: 'klarna' }),
    );
    await fixture.whenStable();
    await Promise.resolve();
    fixture.detectChanges();
    const klarnaCmp = fixture.debugElement.query(By.directive(KlarnaPaymentComponent))
      .componentInstance as KlarnaPaymentComponent;

    await klarnaCmp.onPay();
    expect(fixture.componentInstance.lastError?.code).toBe('PAYMENT_FAILED');
    expect(fixture.componentInstance.successCount).toBe(0);

    adapter.confirmPayment.and.resolveTo({
      status: 'success',
      method: 'klarna',
      provider: 'klarna',
      transactionId: 'pi_retry_ok',
    });
    fixture.detectChanges();
    await klarnaCmp.onPay();
    expect(adapter.confirmPayment).toHaveBeenCalledTimes(2);
    expect(fixture.componentInstance.successCount).toBe(1);
    expect(fixture.componentInstance.lastSuccess?.transactionId).toBe('pi_retry_ok');
    const [returnUrl, ownerId] = adapter.confirmPayment.calls.mostRecent().args;
    expect(new URL(returnUrl!).searchParams.get('ep_attempt')).toMatch(/^[a-f0-9]{16}$/);
    expect(ownerId).toMatch(/^klarna/);
  });

  it('does not overwrite or clear a sibling host pending marker while that host is confirming', async () => {
    const gate = TestBed.inject(StripeConfirmationGate);
    const releaseSibling = gate.acquire('affirm:sibling', 'affirm', 'affirm');
    markStripePendingReturn('affirm', 'other-plan', undefined, {
      attemptId: 'sibling0attempt1',
      hostKind: 'buttons',
      hostOrdinal: 0,
    });
    adapter.confirmPayment.and.callFake(async () => {
      gate.acquire('klarna:test', 'klarna', 'klarna');
      throw new Error('unreachable');
    });
    await fixture.whenStable();
    await Promise.resolve();
    fixture.detectChanges();
    const klarnaCmp = fixture.debugElement.query(By.directive(KlarnaPaymentComponent))
      .componentInstance as KlarnaPaymentComponent;

    await klarnaCmp.onPay();
    expect(fixture.componentInstance.lastError?.code).toBe('PROVIDER_UNAVAILABLE');
    expect(readStripePendingReturn()?.attemptId).toBe('sibling0attempt1');
    releaseSibling();
  });

  it('emits nothing after the panel is destroyed mid-confirm', async () => {
    let resolveConfirm!: (r: PaymentResult) => void;
    adapter.confirmPayment.and.returnValue(new Promise((resolve) => (resolveConfirm = resolve)));
    await fixture.whenStable();
    await Promise.resolve();
    fixture.detectChanges();
    const klarnaCmp = fixture.debugElement.query(By.directive(KlarnaPaymentComponent))
      .componentInstance as KlarnaPaymentComponent;

    const pay = klarnaCmp.onPay();
    fixture.destroy();
    resolveConfirm({ status: 'success', method: 'klarna', provider: 'klarna', transactionId: 'pi_late' });
    await pay;
    expect(fixture.componentInstance.successCount).toBe(0);
    expect(fixture.componentInstance.lastError).toBeNull();
  });
});

describe('KlarnaPaymentComponent during Stripe redirect return', () => {
  let fixture: ComponentFixture<HostComponent>;
  let adapter: jasmine.SpyObj<KlarnaAdapter>;

  afterEach(() => {
    clearKlarnaPendingReturn();
    resetTestLocation();
  });

  it('does not create a new PaymentIntent while Klarna return params are present', async () => {
    markKlarnaPendingReturn('premium-plan');
    setTestLocation(
      '/?payment_intent=pi_ret&payment_intent_client_secret=pi_ret_secret&ep_method=klarna',
    );

    adapter = jasmine.createSpyObj<KlarnaAdapter>('KlarnaAdapter', [
      'ensureStripeLoaded',
      'createPaymentSession',
      'mountPaymentElement',
      'updateAppearance',
      'destroy',
      'confirmPayment',
      'retrieveReturningPayment',
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
      providers: [{ provide: KlarnaAdapter, useValue: adapter }],
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
