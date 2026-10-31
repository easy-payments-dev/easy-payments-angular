import { Component, signal, ChangeDetectionStrategy } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { PaymentError } from '../../errors/payment-error';
import { StripeCardPaymentComponent } from './stripe-card-payment.component';
import { StripeCardAdapter } from '../../adapters/stripe/stripe-card.adapter';
import { PaymentProduct, PaymentResult, ResolvedPaymentTheme } from '../../models';

@Component({
  standalone: true,
  imports: [StripeCardPaymentComponent],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    <easy-stripe-card-payment
      [product]="product()"
      [resolvedTheme]="theme()"
      [chrome]="chrome()"
      (started)="starts.push($event)"
      (success)="successes.push($event)"
      (error)="errors.push($event)"
      (cancel)="cancels.push($event)"
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
  readonly chrome = signal<'full' | 'minimal'>('full');
  starts: unknown[] = [];
  successes: PaymentResult[] = [];
  errors: PaymentError[] = [];
  cancels: PaymentResult[] = [];
}

describe('StripeCardPaymentComponent session reuse', () => {
  let fixture: ComponentFixture<HostComponent>;
  let adapter: jasmine.SpyObj<StripeCardAdapter>;

  beforeEach(async () => {
    adapter = jasmine.createSpyObj<StripeCardAdapter>('StripeCardAdapter', [
      'ensureStripeLoaded',
      'createPaymentSession',
      'mountPaymentElement',
      'updateAppearance',
      'destroy',
      'confirmPayment',
      'isConfirming',
      'hasMountedElement',
    ]);

    adapter.ensureStripeLoaded.and.resolveTo({} as never);
    adapter.createPaymentSession.and.resolveTo({ clientSecret: 'pi_secret_1' });
    adapter.mountPaymentElement.and.resolveTo();
    adapter.updateAppearance.and.resolveTo();
    adapter.destroy.and.resolveTo();
    adapter.isConfirming.and.returnValue(false);
    adapter.hasMountedElement.and.returnValue(true);

    await TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [{ provide: StripeCardAdapter, useValue: adapter }],
    }).compileComponents();

    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    await Promise.resolve();
    await Promise.resolve();
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
      amount: 99.99,
      currency: 'USD',
      quantity: 1,
    });
    fixture.detectChanges();
    await fixture.whenStable();
    await Promise.resolve();

    expect(adapter.createPaymentSession).not.toHaveBeenCalled();
    expect(adapter.mountPaymentElement).not.toHaveBeenCalled();
  });

  it('creates a new session when amount changes', async () => {
    adapter.createPaymentSession.calls.reset();
    adapter.mountPaymentElement.calls.reset();
    adapter.createPaymentSession.and.resolveTo({ clientSecret: 'pi_secret_2' });

    fixture.componentInstance.product.update((p) => ({ ...p, amount: 49.99 }));
    fixture.detectChanges();
    await fixture.whenStable();
    await Promise.resolve();
    await Promise.resolve();

    expect(adapter.createPaymentSession).toHaveBeenCalledTimes(1);
    expect(adapter.mountPaymentElement).toHaveBeenCalledTimes(1);
  });

  it('emits started once and success only after confirmation', async () => {
    expect(fixture.componentInstance.starts.length).toBe(0);
    adapter.confirmPayment.and.resolveTo({
      status: 'success',
      method: 'card',
      provider: 'stripe',
      transactionId: 'pi_123',
      message: 'Card payment completed successfully.',
    });

    fixture.detectChanges();
    const button = fixture.nativeElement.querySelector(
      'button.ep-stripe-card__pay',
    ) as HTMLButtonElement;
    expect(button.disabled).toBeFalse();
    button.click();
    button.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(adapter.confirmPayment).toHaveBeenCalledTimes(1);
    expect(fixture.componentInstance.starts.length).toBe(1);
    expect(fixture.componentInstance.successes).toEqual([
      jasmine.objectContaining({
        status: 'success',
        method: 'card',
        provider: 'stripe',
        transactionId: 'pi_123',
      }),
    ]);
    expect(JSON.stringify(fixture.componentInstance.successes)).not.toContain('clientSecret');
    expect(JSON.stringify(fixture.componentInstance.successes)).not.toContain('pi_secret_1');
    expect(fixture.componentInstance.cancels.length).toBe(0);
  });

  it('emits a declined-card error and allows a later retry', async () => {
    const secret = ['sk', '_test_', 'examplekey'].join('');
    adapter.confirmPayment.and.rejectWith(
      new PaymentError({
        code: 'CARD_DECLINED',
        message: `declined ${secret}`,
        method: 'card',
        provider: 'stripe',
      }),
    );

    const button = () =>
      fixture.nativeElement.querySelector('button.ep-stripe-card__pay') as HTMLButtonElement;
    fixture.detectChanges();
    expect(button().disabled).toBeFalse();
    button().click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.componentInstance.starts.length).toBe(1);
    expect(fixture.componentInstance.successes.length).toBe(0);
    expect(fixture.componentInstance.cancels.length).toBe(0);
    expect(fixture.componentInstance.errors.map((error) => error.code)).toEqual(['CARD_DECLINED']);
    expect(JSON.stringify(fixture.componentInstance.starts)).not.toContain(secret);

    button().click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(adapter.confirmPayment).toHaveBeenCalledTimes(2);
    expect(fixture.componentInstance.starts.length).toBe(2);
    expect(fixture.componentInstance.errors.length).toBe(2);
  });

  it('shows the Full Checkout success banner after confirmation by default', async () => {
    adapter.confirmPayment.and.resolveTo({
      status: 'success',
      method: 'card',
      provider: 'stripe',
      transactionId: 'pi_full_banner',
    });
    fixture.detectChanges();
    (fixture.nativeElement.querySelector('button.ep-stripe-card__pay') as HTMLButtonElement).click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.ep-stripe-card__success')?.textContent).toContain(
      'Payment completed',
    );
  });

  it('emits success without an application-level banner when chrome is minimal', async () => {
    fixture.componentInstance.chrome.set('minimal');
    fixture.detectChanges();
    await fixture.whenStable();

    adapter.confirmPayment.and.resolveTo({
      status: 'success',
      method: 'card',
      provider: 'stripe',
      transactionId: 'pi_minimal_ok',
    });
    (fixture.nativeElement.querySelector('button.ep-stripe-card__pay') as HTMLButtonElement).click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.componentInstance.successes.length).toBe(1);
    expect(fixture.nativeElement.querySelector('.ep-stripe-card__success')).toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain('Payment completed');
    expect(fixture.nativeElement.querySelector('button.ep-stripe-card__pay')).toBeTruthy();
  });

  it('keeps decline alerts visible for retry in chrome=minimal', async () => {
    fixture.componentInstance.chrome.set('minimal');
    fixture.detectChanges();
    await fixture.whenStable();

    adapter.confirmPayment.and.rejectWith(
      new PaymentError({
        code: 'CARD_DECLINED',
        message: 'declined',
        method: 'card',
        provider: 'stripe',
      }),
    );

    (fixture.nativeElement.querySelector('button.ep-stripe-card__pay') as HTMLButtonElement).click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.ep-stripe-card__error')?.getAttribute('role')).toBe(
      'alert',
    );
    expect(fixture.componentInstance.errors.map((error) => error.code)).toEqual(['CARD_DECLINED']);
    expect(
      (fixture.nativeElement.querySelector('button.ep-stripe-card__pay') as HTMLButtonElement)
        .disabled,
    ).toBeFalse();
  });

  it('styles the Card CTA with opaque disabled contrast (not pale opacity washout)', () => {
    const styleText = Array.from(document.querySelectorAll('style'))
      .map((el) => el.textContent ?? '')
      .join('\n');
    // Angular encodes host attrs between class and pseudo (:disabled).
    expect(styleText).toMatch(
      /ep-stripe-card__pay[^{]*:disabled[^{]*\{[^}]*opacity:\s*1/,
    );
    expect(styleText).toMatch(
      /ep-stripe-card__pay[^{]*:disabled[^{]*\{[^}]*color-mix/,
    );
    expect(styleText).toMatch(
      /ep-stripe-card__pay\[aria-busy[^\]]*\][^{]*:disabled[^{]*\{[^}]*color-mix/,
    );
  });

  it('destroys the Stripe element on teardown', () => {
    const cardDebug = fixture.debugElement.query(By.directive(StripeCardPaymentComponent));
    expect(cardDebug).toBeTruthy();
    fixture.destroy();
    expect(adapter.destroy).toHaveBeenCalled();
  });
});
