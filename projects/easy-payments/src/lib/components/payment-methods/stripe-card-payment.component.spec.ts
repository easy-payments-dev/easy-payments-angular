import { Component, signal, ChangeDetectionStrategy } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { PaymentError } from '../../errors/payment-error';
import { StripeCardPaymentComponent } from './stripe-card-payment.component';
import { StripeCardAdapter } from '../../adapters/stripe/stripe-card.adapter';
import {
  EasyPaymentsCardButtonAppearance,
  PaymentProduct,
  PaymentResult,
  ResolvedPaymentTheme,
} from '../../models';

@Component({
  standalone: true,
  imports: [StripeCardPaymentComponent],
  changeDetection: ChangeDetectionStrategy.Default,
  template: `
    <easy-stripe-card-payment
      [product]="product()"
      [resolvedTheme]="theme()"
      [chrome]="chrome()"
      [cardButtonAppearance]="cardButtonAppearance()"
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
  readonly cardButtonAppearance = signal<EasyPaymentsCardButtonAppearance | null>(null);
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

  it('keeps the default localized CTA label without cardButtonAppearance', () => {
    const cta = fixture.nativeElement.querySelector(
      'button.ep-stripe-card__pay',
    ) as HTMLButtonElement;
    expect(cta.textContent?.trim()).toMatch(/^Pay \$/);
    expect(
      (fixture.nativeElement.querySelector('easy-stripe-card-payment') as HTMLElement).style
        .getPropertyValue('--ep-card-cta-bg')
        .trim(),
    ).toBe('');
  });

  it('falls back to theme --ep-cta tokens when cardButtonAppearance is omitted', () => {
    const cardHost = fixture.nativeElement.querySelector(
      'easy-stripe-card-payment',
    ) as HTMLElement;
    const cta = cardHost.querySelector('button.ep-stripe-card__pay') as HTMLButtonElement;
    cardHost.style.setProperty('--ep-cta-bg', '#0b6e4f');
    cardHost.style.setProperty('--ep-cta-text', '#f8fafc');
    expect(cardHost.style.getPropertyValue('--ep-card-cta-bg').trim()).toBe('');
    expect(getComputedStyle(cta).backgroundColor).toBeTruthy();
  });

  it('keeps merchant accent-driven dark CTA fallbacks when only label is customized', async () => {
    fixture.componentInstance.cardButtonAppearance.set({ label: 'Pay now' });
    fixture.detectChanges();
    await fixture.whenStable();

    const cardHost = fixture.nativeElement.querySelector(
      'easy-stripe-card-payment',
    ) as HTMLElement;
    const cta = cardHost.querySelector('button.ep-stripe-card__pay') as HTMLButtonElement;
    expect(cta.textContent?.trim()).toBe('Pay now');
    expect(cardHost.style.getPropertyValue('--ep-card-cta-bg').trim()).toBe('');
    expect(cardHost.style.getPropertyValue('--ep-card-cta-text').trim()).toBe('');
  });

  it('applies a custom Card CTA label and sanitized CSS variables', async () => {
    fixture.componentInstance.cardButtonAppearance.set({
      label: 'Complete card payment',
      backgroundColor: '#0b6e4f',
      textColor: '#f8fafc',
      fontFamily: 'Georgia, serif',
      fontSize: '17px',
      fontWeight: 700,
      textAlign: 'left',
      border: 'none',
      borderRadius: '12px',
      minHeight: '52px',
      width: '100%',
      padding: '10px 18px',
      hoverBackgroundColor: '#095c42',
      hoverTextColor: '#ffffff',
      disabledBackgroundColor: '#4b5563',
      disabledTextColor: '#d1d5db',
      loadingBackgroundColor: '#1f2937',
      loadingTextColor: '#f9fafb',
      focusOutlineColor: '#22c55e',
      focusOutlineWidth: '3px',
      focusOutlineOffset: '3px',
    });
    fixture.detectChanges();
    await fixture.whenStable();

    const host = fixture.nativeElement.querySelector(
      'easy-stripe-card-payment',
    ) as HTMLElement;
    const cta = host.querySelector('button.ep-stripe-card__pay') as HTMLButtonElement;

    expect(cta.textContent?.trim()).toBe('Complete card payment');
    expect(host.style.getPropertyValue('--ep-card-cta-bg').trim()).toBe('#0b6e4f');
    expect(host.style.getPropertyValue('--ep-card-cta-text').trim()).toBe('#f8fafc');
    expect(host.style.getPropertyValue('--ep-card-cta-font-family').trim()).toBe('Georgia, serif');
    expect(host.style.getPropertyValue('--ep-card-cta-font-size').trim()).toBe('17px');
    expect(host.style.getPropertyValue('--ep-card-cta-font-weight').trim()).toBe('700');
    expect(host.style.getPropertyValue('--ep-card-cta-text-align').trim()).toBe('left');
    expect(host.style.getPropertyValue('--ep-card-cta-border-style').trim()).toBe('none');
    expect(host.style.getPropertyValue('--ep-card-cta-border-width').trim()).toBe('0px');
    expect(host.style.getPropertyValue('--ep-card-cta-radius').trim()).toBe('12px');
    expect(host.style.getPropertyValue('--ep-card-cta-min-height').trim()).toBe('52px');
    expect(host.style.getPropertyValue('--ep-card-cta-width').trim()).toBe('100%');
    expect(host.style.getPropertyValue('--ep-card-cta-padding').trim()).toBe('10px 18px');
    expect(host.style.getPropertyValue('--ep-card-cta-hover-bg').trim()).toBe('#095c42');
    expect(host.style.getPropertyValue('--ep-card-cta-disabled-bg').trim()).toBe('#4b5563');
    expect(host.style.getPropertyValue('--ep-card-cta-loading-bg').trim()).toBe('#1f2937');
    expect(host.style.getPropertyValue('--ep-card-cta-focus-color').trim()).toBe('#22c55e');
  });

  it('ignores invalid cardButtonAppearance values and keeps localized label', async () => {
    fixture.componentInstance.cardButtonAppearance.set({
      label: 'x'.repeat(120),
      backgroundColor: 'red; width: 100%',
      fontSize: 'huge',
    });
    fixture.detectChanges();
    await fixture.whenStable();

    const host = fixture.nativeElement.querySelector(
      'easy-stripe-card-payment',
    ) as HTMLElement;
    const cta = host.querySelector('button.ep-stripe-card__pay') as HTMLButtonElement;
    expect(cta.textContent?.trim()).toMatch(/^Pay \$/);
    expect(host.style.getPropertyValue('--ep-card-cta-bg').trim()).toBe('');
    expect(host.style.getPropertyValue('--ep-card-cta-font-size').trim()).toBe('');
  });

  it('uses a custom label in chrome=minimal instead of payWithCard', async () => {
    fixture.componentInstance.chrome.set('minimal');
    fixture.componentInstance.cardButtonAppearance.set({ label: 'Confirm card' });
    fixture.detectChanges();
    await fixture.whenStable();

    expect(
      (
        fixture.nativeElement.querySelector('button.ep-stripe-card__pay') as HTMLButtonElement
      ).textContent?.trim(),
    ).toBe('Confirm card');
  });

  it('destroys the Stripe element on teardown', () => {
    const cardDebug = fixture.debugElement.query(By.directive(StripeCardPaymentComponent));
    expect(cardDebug).toBeTruthy();
    fixture.destroy();
    expect(adapter.destroy).toHaveBeenCalled();
  });
});
