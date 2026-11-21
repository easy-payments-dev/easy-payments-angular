import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideEasyPayments } from '../../config/provide-easy-payments';
import { BrowserGuard } from '../../utils/browser-guard';
import { FakeBrowserGuard, SAMPLE_PRODUCT } from '../../testing/test-doubles';
import { LinkAdapter } from '../../adapters/link/link.adapter';
import { PaymentError } from '../../errors/payment-error';
import { PaymentResult, ResolvedPaymentTheme } from '../../models';
import { EasyPaymentsI18nService } from '../../i18n';
import { LinkPaymentComponent } from './link-payment.component';

@Component({
  standalone: true,
  imports: [LinkPaymentComponent],
  providers: [EasyPaymentsI18nService],
  template: `
    <easy-link-payment
      [product]="product"
      [resolvedTheme]="theme"
      [chrome]="chrome()"
      (success)="successes.push($event)"
      (error)="errors.push($event)"
      (started)="starts.push($event)"
    />
  `,
})
class LinkHostComponent {
  readonly product = { ...SAMPLE_PRODUCT };
  readonly theme: ResolvedPaymentTheme = 'light';
  readonly chrome = signal<'full' | 'minimal'>('full');
  readonly successes: PaymentResult[] = [];
  readonly errors: PaymentError[] = [];
  readonly starts: void[] = [];
}

describe('LinkPaymentComponent', () => {
  let fixture: ComponentFixture<LinkHostComponent>;
  let link: jasmine.SpyObj<LinkAdapter>;
  let mountOptions: {
    onReady?: () => void;
    onSuccess: (result: PaymentResult) => void;
    onError: (error: PaymentError) => void;
    onAttempt?: () => void;
    locale?: string;
  };

  beforeEach(async () => {
    link = jasmine.createSpyObj<LinkAdapter>(
      'LinkAdapter',
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
      { provider: 'link', isMock: false },
    );
    link.initialize.and.resolveTo();
    link.isConfigured.and.returnValue(true);
    link.addAvailabilityListener.and.returnValue(() => undefined);
    link.createMountId.and.returnValue('link-ece-1');
    link.getAvailabilityStatus.and.returnValue('available');
    link.isAvailable.and.resolveTo(true);
    link.isProcessing.and.returnValue(false);
    link.mountExpressCheckout.and.callFake(async (_host, options, mountId) => {
      mountOptions = options as typeof mountOptions;
      options.onReady?.();
      return mountId ?? 'link-ece-1';
    });

    await TestBed.configureTestingModule({
      imports: [LinkHostComponent],
      providers: [
        provideEasyPayments({
          enableMockMode: false,
          providers: {
            stripe: { publishableKey: 'pk_test_link_panel' },
            link: {},
          },
          backend: {
            linkCreatePaymentUrl: '/api/payments/link/create',
          },
        }),
        { provide: BrowserGuard, useValue: new FakeBrowserGuard() },
        { provide: LinkAdapter, useValue: link },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(LinkHostComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it('shows Full Checkout success banner by default and emits success once', async () => {
    mountOptions.onAttempt?.();
    mountOptions.onSuccess({
      status: 'success',
      method: 'link',
      provider: 'link',
      transactionId: 'pi_link_full',
    });
    mountOptions.onSuccess({
      status: 'success',
      method: 'link',
      provider: 'link',
      transactionId: 'pi_link_full',
    });
    fixture.detectChanges();

    expect(fixture.componentInstance.starts.length).toBe(1);
    expect(fixture.componentInstance.successes.length).toBe(1);
    expect(fixture.nativeElement.querySelector('.ep-link__success')?.textContent).toContain(
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
      method: 'link',
      provider: 'link',
      transactionId: 'pi_link_minimal',
    });
    fixture.detectChanges();

    expect(fixture.componentInstance.successes.length).toBe(1);
    expect(fixture.nativeElement.querySelector('.ep-link__success')).toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain('Payment completed');
    expect(fixture.nativeElement.querySelector('.ep-link')?.getAttribute('data-chrome')).toBe(
      'minimal',
    );
    expect(fixture.nativeElement.querySelector('.ep-link__button--hidden')).toBeTruthy();
  });

  it('re-localizes an existing error when locale changes without emitting again', async () => {
    const i18n = fixture.debugElement.injector.get(EasyPaymentsI18nService);
    mountOptions.onError(
      new PaymentError({
        code: 'SDK_LOAD_FAILED',
        message: 'boom',
        method: 'link',
        provider: 'link',
      }),
    );
    fixture.detectChanges();

    expect(fixture.componentInstance.errors.length).toBe(1);
    expect(fixture.nativeElement.querySelector('.ep-link__error')?.textContent).toContain(
      'Unable to load the payment provider',
    );

    i18n.setRequestedLocale('es');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.componentInstance.errors.length).toBe(1);
    expect(fixture.componentInstance.successes.length).toBe(0);
    expect(fixture.nativeElement.querySelector('.ep-link__error')?.textContent).toContain(
      'No se pudo cargar el proveedor de pago',
    );
    expect(fixture.nativeElement.querySelector('.ep-link__retry')?.textContent?.trim()).toBe(
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
