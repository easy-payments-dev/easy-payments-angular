import { Component, signal, ChangeDetectionStrategy } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { PaymentError } from '../../errors/payment-error';
import { AlipayPaymentComponent } from './alipay-payment.component';
import { AlipayAdapter } from '../../adapters/alipay/alipay.adapter';
import {
  EasyPaymentsCardButtonAppearance,
  PaymentProduct,
  PaymentResult,
  ResolvedPaymentTheme,
} from '../../models';
import { provideEasyPayments } from '../../config/provide-easy-payments';
import {
  EasyPaymentsI18nService,
  ES_TRANSLATIONS,
  FR_TRANSLATIONS,
  interpolate,
  PT_TRANSLATIONS,
} from '../../i18n';

@Component({
  standalone: true,
  imports: [AlipayPaymentComponent],
  changeDetection: ChangeDetectionStrategy.Default,
  providers: [EasyPaymentsI18nService],
  template: `
    <easy-alipay-payment
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

describe('AlipayPaymentComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let adapter: jasmine.SpyObj<AlipayAdapter>;

  beforeEach(async () => {
    adapter = jasmine.createSpyObj<AlipayAdapter>('AlipayAdapter', [
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
      'unmountPaymentElement',
    ]);

    adapter.ensureStripeLoaded.and.resolveTo({} as never);
    adapter.createPaymentSession.and.resolveTo({ clientSecret: 'pi_alipay_secret' });
    adapter.mountPaymentElement.and.resolveTo();
    adapter.updateAppearance.and.resolveTo();
    adapter.destroy.and.resolveTo();
    adapter.consumeStripeReturn.and.resolveTo(null);
    adapter.wasReturnConsumed.and.returnValue(false);
    adapter.isConfirming.and.returnValue(false);
    adapter.hasMountedElement.and.returnValue(true);

    await TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [
        provideEasyPayments({
          enableMockMode: false,
          providers: {
            stripe: { publishableKey: 'pk_test_alipay_cta' },
            alipay: {},
          },
          backend: { alipayCreatePaymentUrl: '/api/payments/alipay/create' },
        }),
        { provide: AlipayAdapter, useValue: adapter },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    await Promise.resolve();
    await Promise.resolve();
  });

  function payButton(): HTMLButtonElement {
    return fixture.debugElement.query(By.css('button.ep-alipay__pay')).nativeElement;
  }

  function alipayHost(): HTMLElement {
    return fixture.debugElement.query(By.css('easy-alipay-payment')).nativeElement;
  }

  function panel(): AlipayPaymentComponent {
    return fixture.debugElement.query(By.directive(AlipayPaymentComponent))
      .componentInstance as AlipayPaymentComponent;
  }

  async function waitUntilReady(): Promise<void> {
    for (let i = 0; i < 30 && panel().uiState() !== 'ready'; i += 1) {
      await fixture.whenStable();
      await Promise.resolve();
      fixture.detectChanges();
    }
    expect(panel().uiState()).toBe('ready');
  }

  it('keeps the localized Continue to Alipay label in Buttons Only without appearance', async () => {
    fixture.componentInstance.chrome.set('minimal');
    fixture.detectChanges();
    await waitUntilReady();

    expect(payButton().textContent?.trim()).toBe('Continue to Alipay');
    expect(payButton().textContent).not.toMatch(/\$\d/);
    expect(alipayHost().style.getPropertyValue('--ep-card-cta-bg').trim()).toBe('');
  });

  it('ignores Card label and keeps localized Alipay default', async () => {
    fixture.componentInstance.chrome.set('minimal');
    fixture.componentInstance.cardButtonAppearance.set({
      label: 'Complete card payment',
      backgroundColor: '#0b6e4f',
    });
    fixture.detectChanges();
    await waitUntilReady();

    expect(payButton().textContent?.trim()).toBe('Continue to Alipay');
    expect(payButton().textContent).not.toContain('card');
    expect(alipayHost().style.getPropertyValue('--ep-card-cta-bg').trim()).toBe('#0b6e4f');
  });

  it('applies alipayLabel and shared CSS vars to the Alipay CTA', async () => {
    fixture.componentInstance.chrome.set('minimal');
    fixture.componentInstance.cardButtonAppearance.set({
      label: 'Complete card payment',
      alipayLabel: 'Pay via Alipay',
      backgroundColor: '#1677FF',
      textColor: '#ffffff',
      fontSize: '15px',
      fontWeight: 700,
      borderRadius: '8px',
      padding: '0 20px',
      minHeight: '44px',
      width: '100%',
      hoverBackgroundColor: '#0958d9',
      disabledBackgroundColor: '#94a3b8',
      loadingBackgroundColor: '#1e293b',
      focusOutlineColor: '#1677FF',
    });
    fixture.detectChanges();
    await waitUntilReady();

    expect(payButton().textContent?.trim()).toBe('Pay via Alipay');
    expect(alipayHost().style.getPropertyValue('--ep-card-cta-bg').trim()).toBe('#1677FF');
    expect(alipayHost().style.getPropertyValue('--ep-card-cta-text').trim()).toBe('#ffffff');
    expect(alipayHost().style.getPropertyValue('--ep-card-cta-font-size').trim()).toBe('15px');
    expect(alipayHost().style.getPropertyValue('--ep-card-cta-font-weight').trim()).toBe('700');
    expect(alipayHost().style.getPropertyValue('--ep-card-cta-radius').trim()).toBe('8px');
    expect(alipayHost().style.getPropertyValue('--ep-card-cta-padding').trim()).toBe('0 20px');
    expect(alipayHost().style.getPropertyValue('--ep-card-cta-min-height').trim()).toBe('44px');
    expect(alipayHost().style.getPropertyValue('--ep-card-cta-width').trim()).toBe('100%');
    expect(alipayHost().style.getPropertyValue('--ep-card-cta-hover-bg').trim()).toBe('#0958d9');
    expect(alipayHost().style.getPropertyValue('--ep-card-cta-disabled-bg').trim()).toBe('#94a3b8');
    expect(alipayHost().style.getPropertyValue('--ep-card-cta-loading-bg').trim()).toBe('#1e293b');
    expect(alipayHost().style.getPropertyValue('--ep-card-cta-focus-color').trim()).toBe('#1677FF');
  });

  it('ignores blank alipayLabel and keeps localized default', async () => {
    fixture.componentInstance.chrome.set('minimal');
    fixture.componentInstance.cardButtonAppearance.set({
      label: 'Complete card payment',
      alipayLabel: '   ',
    });
    fixture.detectChanges();
    await waitUntilReady();

    expect(payButton().textContent?.trim()).toBe('Continue to Alipay');
  });

  it('localizes the Alipay default CTA in ES / PT / FR and prefers alipayLabel', async () => {
    fixture.componentInstance.chrome.set('minimal');
    fixture.detectChanges();
    await waitUntilReady();

    const i18n = fixture.debugElement.injector.get(EasyPaymentsI18nService);

    i18n.setRequestedLocale('es');
    fixture.detectChanges();
    expect(payButton().textContent?.trim()).toBe(
      interpolate(ES_TRANSLATIONS.continueToMethod, { method: 'Alipay' }),
    );

    i18n.setRequestedLocale('pt');
    fixture.detectChanges();
    expect(payButton().textContent?.trim()).toBe(
      interpolate(PT_TRANSLATIONS.continueToMethod, { method: 'Alipay' }),
    );

    i18n.setRequestedLocale('fr');
    fixture.detectChanges();
    expect(payButton().textContent?.trim()).toBe(
      interpolate(FR_TRANSLATIONS.continueToMethod, { method: 'Alipay' }),
    );

    fixture.componentInstance.cardButtonAppearance.set({
      label: 'Complete card payment',
      alipayLabel: 'Payer avec Alipay',
    });
    fixture.detectChanges();
    expect(payButton().textContent?.trim()).toBe('Payer avec Alipay');

    i18n.setRequestedLocale('en');
    fixture.detectChanges();
    expect(payButton().textContent?.trim()).toBe('Payer avec Alipay');
  });

  it('disables the CTA until ready', async () => {
    fixture.componentInstance.chrome.set('minimal');
    fixture.detectChanges();
    // Before ready settles, button may already be present and disabled.
    const btn = payButton();
    if (panel().uiState() !== 'ready') {
      expect(btn.disabled).toBeTrue();
    }
    await waitUntilReady();
    expect(payButton().disabled).toBeFalse();
  });

  it('shows processing copy and aria-busy while confirming', async () => {
    fixture.componentInstance.chrome.set('minimal');
    fixture.detectChanges();
    await waitUntilReady();

    let resolveConfirm!: (value: PaymentResult) => void;
    adapter.confirmPayment.and.callFake(() => {
      adapter.isConfirming.and.returnValue(true);
      return new Promise<PaymentResult>((resolve) => {
        resolveConfirm = resolve;
      });
    });

    const pending = panel().onPay();
    fixture.detectChanges();

    expect(panel().uiState()).toBe('processing');
    expect(payButton().textContent?.trim()).toBe('Processing payment…');
    expect(payButton().getAttribute('aria-busy')).toBe('true');
    expect(payButton().disabled).toBeTrue();

    adapter.isConfirming.and.returnValue(false);
    resolveConfirm({
      status: 'success',
      method: 'alipay',
      provider: 'alipay',
      transactionId: 'pi_alipay_ok',
    });
    await pending;
    fixture.detectChanges();
  });
});
