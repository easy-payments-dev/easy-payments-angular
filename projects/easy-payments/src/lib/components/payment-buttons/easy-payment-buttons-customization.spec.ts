import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideEasyPayments } from '../../config/provide-easy-payments';
import { BrowserGuard } from '../../utils/browser-guard';
import { FakeBrowserGuard, SAMPLE_PRODUCT } from '../../testing/test-doubles';
import { EasyPaymentButtonsComponent } from './easy-payment-buttons.component';
import { EasyPaymentsComponent } from '../payments/easy-payments.component';
import { KlarnaAdapter } from '../../adapters/klarna/klarna.adapter';
import { AffirmAdapter } from '../../adapters/affirm/affirm.adapter';
import { PaymentError } from '../../errors/payment-error';
import { PaymentResult } from '../../models';
import { EasyPaymentsHeadless } from '../../headless/easy-payments-headless.service';
import { CheckoutHostContext } from '../../services/checkout-host-context';
import { StripeRedirectRecoveryService } from '../../adapters/stripe/stripe-redirect-recovery.service';
import { clearStripePendingReturn } from '../../adapters/stripe/stripe-redirect-return';

const DIRECT_READY_CHECKOUT = {
  customer: {
    email: 'jenny.rosen@example.com',
    name: 'Jenny Rosen',
    address: {
      line1: '510 Townsend St',
      city: 'San Francisco',
      state: 'CA',
      postalCode: '94103',
      country: 'US',
    },
  },
} as const;

describe('EasyPaymentButtonsComponent customization', () => {
  let fixture: ComponentFixture<EasyPaymentButtonsComponent>;

  beforeEach(async () => {
    clearStripePendingReturn();
    history.replaceState({}, '', '/');
    await TestBed.configureTestingModule({
      imports: [EasyPaymentButtonsComponent],
      providers: [
        provideEasyPayments({ enableMockMode: true, providers: {} }),
        { provide: BrowserGuard, useValue: new FakeBrowserGuard() },
      ],
    }).compileComponents();
    TestBed.inject(StripeRedirectRecoveryService).resetForTests();

    fixture = TestBed.createComponent(EasyPaymentButtonsComponent);
    fixture.componentRef.setInput('product', { ...SAMPLE_PRODUCT });
    fixture.componentRef.setInput('methods', ['card', 'klarna', 'affirm', 'paypal']);
  });

  afterEach(() => {
    clearStripePendingReturn();
    history.replaceState({}, '', '/');
    TestBed.inject(StripeRedirectRecoveryService).resetForTests();
    fixture.destroy();
  });

  async function settle(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function selector(method: string): HTMLButtonElement | null {
    return fixture.nativeElement.querySelector(
      `.ep-payment-buttons__item[data-method="${method}"] button.ep-payment-buttons__selector`,
    );
  }

  it('keeps the default selector appearance when no custom style is set', async () => {
    await settle();
    const host = fixture.nativeElement as HTMLElement;
    expect(host.getAttribute('data-selector-visibility')).toBe('library');
    expect(host.style.getPropertyValue('--ep-buttons-selector-bg')).toBe('');
    expect(host.style.getPropertyValue('--ep-buttons-selector-text')).toBe('');
    expect(host.style.getPropertyValue('--ep-buttons-selector-font-family')).toBe('');
    expect(selector('card')?.textContent).toContain('Card');
    expect(selector('klarna')?.querySelector('easy-payment-method-icon')).toBeTruthy();
    expect(selector('paypal')).toBeNull();
  });

  it('applies custom CSS hooks for library-owned selectors', async () => {
    fixture.componentRef.setInput('buttonsAppearance', {
      selectorBackgroundColor: '#112233',
      selectorTextColor: '#f8fafc',
      selectorFontFamily: 'Georgia, serif',
      selectorFontSize: '15px',
      selectorFontWeight: 650,
      selectorPadding: '0 18px',
      borderRadius: '18px',
      buttonHeight: '48px',
      selectorHoverBackgroundColor: '#1e293b',
      selectorFocusOutlineColor: '#22c55e',
      selectorSelectedBackgroundColor: '#14532d',
      selectorDisabledBackgroundColor: '#334155',
      selectorLoadingBackgroundColor: '#0f172a',
    });
    await settle();
    const host = fixture.nativeElement as HTMLElement;
    expect(host.style.getPropertyValue('--ep-buttons-selector-bg')).toBe('#112233');
    expect(host.style.getPropertyValue('--ep-buttons-selector-text')).toBe('#f8fafc');
    expect(host.style.getPropertyValue('--ep-buttons-selector-font-family')).toBe('Georgia, serif');
    expect(host.style.getPropertyValue('--ep-buttons-selector-font-size')).toBe('15px');
    expect(host.style.getPropertyValue('--ep-buttons-selector-font-weight')).toBe('650');
    expect(host.style.getPropertyValue('--ep-buttons-selector-padding')).toBe('0 18px');
    expect(host.style.getPropertyValue('--ep-buttons-selector-hover-bg')).toBe('#1e293b');
    expect(host.style.getPropertyValue('--ep-buttons-selector-focus-color')).toBe('#22c55e');
    expect(host.style.getPropertyValue('--ep-buttons-radius')).toBe('18px');
    expect(host.style.getPropertyValue('--ep-buttons-height')).toBe('48px');
    expect(host.style.getPropertyValue('--ep-buttons-selector-bg')).not.toContain('url(');
  });

  it('rejects unsafe style values and markup labels', async () => {
    fixture.componentRef.setInput('buttonsAppearance', {
      selectorBackgroundColor: 'red; background: url(https://evil.test)',
      selectorLabels: {
        card: '<img src=x onerror=alert(1)>',
        klarna: 'Pay with Klarna',
      },
    });
    await settle();
    const host = fixture.nativeElement as HTMLElement;
    expect(host.style.getPropertyValue('--ep-buttons-selector-bg')).toBe('');
    expect(selector('card')?.textContent).toContain('Card');
    expect(selector('card')?.textContent).not.toContain('<img');
    expect(selector('klarna')?.textContent).toContain('Pay with Klarna');
    expect(selector('klarna')?.querySelector('img[src="x"]')).toBeNull();
  });

  it('renders a disabled busy selector without starting a payment', async () => {
    const started: unknown[] = [];
    fixture.componentInstance.started.subscribe((value) => started.push(value));
    await settle();
    fixture.componentInstance.processingMethod.set('klarna');
    fixture.detectChanges();

    const button = selector('klarna');
    expect(button?.disabled).toBeTrue();
    expect(button?.getAttribute('aria-busy')).toBe('true');
    expect(started.length).toBe(0);
    expect(
      (fixture.nativeElement as HTMLElement).querySelector(
        '[data-testid="easy-payment-buttons-status"]',
      )?.textContent,
    ).toContain('klarna busy');
  });

  it('activates a library selector from the keyboard and keeps a visible focus ring', async () => {
    await settle();
    const button = selector('card');
    expect(button?.type).toBe('button');
    button?.focus();
    expect(document.activeElement).toBe(button);
    const outlineWidth = getComputedStyle(button as HTMLButtonElement).outlineWidth;
    expect(outlineWidth === '0px' || outlineWidth === '').toBeFalse();
    button?.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.selectedMethod()).toBe('card');
  });

  it('does not start a payment when the host is created or inputs change', async () => {
    const started: unknown[] = [];
    fixture.componentInstance.started.subscribe((value) => started.push(value));
    await settle();
    fixture.componentRef.setInput('bnplConfirmMode', 'direct');
    fixture.componentRef.setInput('buttonsAppearance', { selectorTextColor: '#111111' });
    fixture.detectChanges();
    await fixture.whenStable();
    expect(started.length).toBe(0);
    expect(fixture.componentInstance.selectedMethod()).toBeNull();
    expect(fixture.componentInstance.bnplDirectActive()).toBeFalse();
  });

  it('hides library selectors in merchant mode and keeps the official wallet slot', async () => {
    fixture.componentRef.setInput('selectorVisibility', 'merchant');
    await settle();
    expect(fixture.nativeElement.getAttribute('data-selector-visibility')).toBe('merchant');
    expect(selector('klarna')).toBeNull();
    expect(selector('affirm')).toBeNull();
    expect(selector('card')).toBeNull();
    const paypal = fixture.nativeElement.querySelector(
      '.ep-payment-buttons__item[data-method="paypal"]',
    ) as HTMLElement;
    expect(paypal.getAttribute('data-kind')).toBe('paypal-mock');
    expect(paypal.querySelector('easy-mock-method-panel')).toBeTruthy();
  });
});

describe('EasyPaymentButtonsComponent merchant-owned actions', () => {
  let fixture: ComponentFixture<EasyPaymentButtonsComponent>;
  let klarna: jasmine.SpyObj<KlarnaAdapter>;
  let affirm: jasmine.SpyObj<AffirmAdapter>;

  beforeEach(async () => {
    clearStripePendingReturn();
    history.replaceState({}, '', '/');
    (EasyPaymentButtonsComponent as unknown as { directPageLock: string | null }).directPageLock =
      null;
    klarna = jasmine.createSpyObj<KlarnaAdapter>(
      'KlarnaAdapter',
      [
        'initialize',
        'isAvailable',
        'createPayment',
        'ensureStripeLoaded',
        'createPaymentSession',
        'mountPaymentElement',
        'updateAppearance',
        'destroy',
        'confirmPayment',
        'confirmDirectPayment',
        'isConfirming',
        'hasMountedElement',
        'wasReturnConsumed',
        'consumeStripeReturn',
      ],
      { provider: 'klarna', isMock: false },
    );
    affirm = jasmine.createSpyObj<AffirmAdapter>(
      'AffirmAdapter',
      [
        'initialize',
        'isAvailable',
        'createPayment',
        'ensureStripeLoaded',
        'createPaymentSession',
        'mountPaymentElement',
        'updateAppearance',
        'destroy',
        'confirmPayment',
        'confirmDirectPayment',
        'isConfirming',
        'hasMountedElement',
        'wasReturnConsumed',
        'consumeStripeReturn',
      ],
      { provider: 'affirm', isMock: false },
    );
    klarna.initialize.and.resolveTo();
    klarna.isAvailable.and.resolveTo(true);
    klarna.ensureStripeLoaded.and.resolveTo({} as never);
    klarna.createPaymentSession.and.resolveTo({
      clientSecret: 'pi_klarna_merchant_secret',
      paymentIntentId: 'pi_klarna_merchant',
    });
    klarna.mountPaymentElement.and.resolveTo();
    klarna.destroy.and.resolveTo();
    klarna.isConfirming.and.returnValue(false);
    klarna.hasMountedElement.and.returnValue(false);
    klarna.wasReturnConsumed.and.returnValue(false);
    klarna.confirmDirectPayment.and.resolveTo({
      status: 'success',
      method: 'klarna',
      provider: 'klarna',
      transactionId: 'pi_klarna_merchant',
    });
    affirm.initialize.and.resolveTo();
    affirm.isAvailable.and.resolveTo(true);
    affirm.ensureStripeLoaded.and.resolveTo({} as never);
    affirm.createPaymentSession.and.resolveTo({
      clientSecret: 'pi_affirm_merchant_secret',
      paymentIntentId: 'pi_affirm_merchant',
    });
    affirm.mountPaymentElement.and.resolveTo();
    affirm.destroy.and.resolveTo();
    affirm.isConfirming.and.returnValue(false);
    affirm.hasMountedElement.and.returnValue(false);
    affirm.wasReturnConsumed.and.returnValue(false);
    affirm.confirmDirectPayment.and.resolveTo({
      status: 'success',
      method: 'affirm',
      provider: 'affirm',
      transactionId: 'pi_affirm_merchant',
    });

    await TestBed.configureTestingModule({
      imports: [EasyPaymentButtonsComponent],
      providers: [
        provideEasyPayments({
          enableMockMode: false,
          providers: {
            stripe: { publishableKey: 'pk_test_buttons_custom' },
            klarna: {},
            affirm: {},
          },
          backend: {
            createPaymentUrl: '/api/payments/create',
            klarnaCreatePaymentUrl: '/api/klarna/create',
            affirmCreatePaymentUrl: '/api/affirm/create',
          },
        }),
        { provide: BrowserGuard, useValue: new FakeBrowserGuard() },
        { provide: KlarnaAdapter, useValue: klarna },
        { provide: AffirmAdapter, useValue: affirm },
      ],
    }).compileComponents();
    TestBed.inject(StripeRedirectRecoveryService).resetForTests();

    fixture = TestBed.createComponent(EasyPaymentButtonsComponent);
    fixture.componentRef.setInput('product', { ...SAMPLE_PRODUCT });
    fixture.componentRef.setInput('methods', ['klarna', 'affirm', 'card', 'paypal']);
    fixture.componentRef.setInput('selectorVisibility', 'merchant');
    fixture.componentRef.setInput('checkoutInstanceId', 'merchant-buttons-1');
  });

  afterEach(() => {
    clearStripePendingReturn();
    history.replaceState({}, '', '/');
    TestBed.inject(StripeRedirectRecoveryService).resetForTests();
    (EasyPaymentButtonsComponent as unknown as { directPageLock: string | null }).directPageLock =
      null;
    fixture.destroy();
  });

  async function settle(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    await Promise.resolve();
    fixture.detectChanges();
  }

  it('does not confirm during initialization or input changes', async () => {
    await settle();
    fixture.componentRef.setInput('bnplConfirmMode', 'direct');
    fixture.componentRef.setInput('checkout', DIRECT_READY_CHECKOUT);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(klarna.createPaymentSession).not.toHaveBeenCalled();
    expect(klarna.confirmDirectPayment).not.toHaveBeenCalled();
    expect(affirm.confirmDirectPayment).not.toHaveBeenCalled();
    expect(fixture.debugElement.injector.get(CheckoutHostContext).instanceId()).toBe(
      'merchant-buttons-1',
    );
  });

  it('starts exactly one Klarna Direct attempt from requestPayment', async () => {
    const successes: PaymentResult[] = [];
    fixture.componentInstance.success.subscribe((value) => successes.push(value));
    fixture.componentRef.setInput('bnplConfirmMode', 'direct');
    fixture.componentRef.setInput('checkout', DIRECT_READY_CHECKOUT);
    let resolveConfirm: ((value: PaymentResult) => void) | undefined;
    klarna.confirmDirectPayment.and.returnValue(
      new Promise<PaymentResult>((resolve) => {
        resolveConfirm = resolve;
      }),
    );
    await settle();

    fixture.componentInstance.requestPayment('klarna');
    fixture.componentInstance.requestPayment('klarna');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(klarna.createPaymentSession).toHaveBeenCalledTimes(1);
    expect(klarna.confirmDirectPayment).toHaveBeenCalledTimes(1);
    expect(fixture.nativeElement.querySelector('easy-klarna-payment')).toBeNull();

    resolveConfirm!({
      status: 'success',
      method: 'klarna',
      provider: 'klarna',
      transactionId: 'pi_klarna_merchant',
    });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(successes.length).toBe(1);
    expect(successes[0].method).toBe('klarna');
  });

  it('starts exactly one Affirm Direct attempt from requestPayment', async () => {
    fixture.componentRef.setInput('bnplConfirmMode', 'auto');
    fixture.componentRef.setInput('checkout', DIRECT_READY_CHECKOUT);
    await settle();
    fixture.componentInstance.requestPayment('affirm');
    fixture.detectChanges();
    await fixture.whenStable();
    expect(affirm.createPaymentSession).toHaveBeenCalledTimes(1);
    expect(affirm.confirmDirectPayment).toHaveBeenCalledTimes(1);
    expect(klarna.confirmDirectPayment).not.toHaveBeenCalled();
  });

  it('falls back to Payment Element when auto readiness is incomplete', async () => {
    fixture.componentRef.setInput('bnplConfirmMode', 'auto');
    await settle();
    fixture.componentInstance.requestPayment('klarna');
    fixture.detectChanges();
    await fixture.whenStable();
    expect(klarna.confirmDirectPayment).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('easy-klarna-payment')).toBeTruthy();
  });

  it('emits a configuration error for direct mode without customer data', async () => {
    const errors: PaymentError[] = [];
    fixture.componentInstance.error.subscribe((value) => errors.push(value));
    fixture.componentRef.setInput('bnplConfirmMode', 'direct');
    await settle();
    fixture.componentInstance.requestPayment('affirm');
    fixture.detectChanges();
    await fixture.whenStable();
    expect(errors.length).toBe(1);
    expect(errors[0].code).toBe('CONFIG_INVALID');
    expect(affirm.createPaymentSession).not.toHaveBeenCalled();
    expect(affirm.confirmDirectPayment).not.toHaveBeenCalled();
  });

  it('refuses official wallet methods and keeps SDK ownership', async () => {
    const errors: PaymentError[] = [];
    fixture.componentInstance.error.subscribe((value) => errors.push(value));
    await settle();
    fixture.componentInstance.requestPayment('paypal');
    fixture.detectChanges();
    expect(errors.length).toBe(1);
    expect(errors[0].code).toBe('CONFIG_INVALID');
    expect(klarna.createPaymentSession).not.toHaveBeenCalled();
    expect(fixture.componentInstance.canRequestPayment('paypal')).toBeFalse();
    expect(fixture.componentInstance.canRequestPayment('google-pay')).toBeFalse();
    expect(fixture.componentInstance.canRequestPayment('apple-pay')).toBeFalse();
  });

  it('blocks a second host while the first Direct attempt is in flight', async () => {
    fixture.componentRef.setInput('bnplConfirmMode', 'direct');
    fixture.componentRef.setInput('checkout', DIRECT_READY_CHECKOUT);
    const fixtureB = TestBed.createComponent(EasyPaymentButtonsComponent);
    fixtureB.componentRef.setInput('product', { ...SAMPLE_PRODUCT, id: 'other-plan' });
    fixtureB.componentRef.setInput('methods', ['klarna', 'affirm']);
    fixtureB.componentRef.setInput('selectorVisibility', 'merchant');
    fixtureB.componentRef.setInput('bnplConfirmMode', 'direct');
    fixtureB.componentRef.setInput('checkout', DIRECT_READY_CHECKOUT);
    fixtureB.componentRef.setInput('checkoutInstanceId', 'merchant-buttons-2');

    let resolveConfirm: ((value: PaymentResult) => void) | undefined;
    klarna.confirmDirectPayment.and.returnValue(
      new Promise<PaymentResult>((resolve) => {
        resolveConfirm = resolve;
      }),
    );

    await settle();
    fixtureB.detectChanges();
    await fixtureB.whenStable();
    fixtureB.detectChanges();

    const errors: PaymentError[] = [];
    fixtureB.componentInstance.error.subscribe((value) => errors.push(value));
    fixture.componentInstance.requestPayment('klarna');
    fixture.detectChanges();
    await fixture.whenStable();
    fixtureB.componentInstance.requestPayment('affirm');
    fixtureB.detectChanges();
    await fixtureB.whenStable();

    expect(klarna.createPaymentSession).toHaveBeenCalledTimes(1);
    expect(affirm.createPaymentSession).not.toHaveBeenCalled();
    expect(errors.some((error) => error.code === 'PROVIDER_UNAVAILABLE')).toBeTrue();
    expect(fixture.debugElement.injector.get(CheckoutHostContext).instanceId()).not.toBe(
      fixtureB.debugElement.injector.get(CheckoutHostContext).instanceId(),
    );

    resolveConfirm!({
      status: 'success',
      method: 'klarna',
      provider: 'klarna',
      transactionId: 'pi_klarna_merchant',
    });
    await fixture.whenStable();
    fixture.destroy();
    fixtureB.destroy();
  });

  it('emits pending once and does not confirm again', async () => {
    const pending: PaymentResult[] = [];
    const successes: PaymentResult[] = [];
    fixture.componentInstance.pending.subscribe((value) => pending.push(value));
    fixture.componentInstance.success.subscribe((value) => successes.push(value));
    klarna.confirmDirectPayment.and.resolveTo({
      status: 'processing',
      method: 'klarna',
      provider: 'klarna',
      transactionId: 'pi_klarna_merchant',
    });
    fixture.componentRef.setInput('bnplConfirmMode', 'direct');
    fixture.componentRef.setInput('checkout', DIRECT_READY_CHECKOUT);
    await settle();
    fixture.componentInstance.requestPayment('klarna');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.componentInstance.requestPayment('klarna');
    await fixture.whenStable();
    expect(pending.length).toBe(1);
    expect(successes.length).toBe(0);
    expect(klarna.confirmDirectPayment).toHaveBeenCalledTimes(1);
    expect(fixture.componentInstance.methodsLocked()).toBeTrue();
  });

  it('emits cancel and allows a later attempt after the lock releases', async () => {
    const cancels: PaymentResult[] = [];
    fixture.componentInstance.cancel.subscribe((value) => cancels.push(value));
    klarna.confirmDirectPayment.and.rejectWith(
      new PaymentError({
        code: 'PAYMENT_CANCELLED',
        message: 'Cancelled.',
        method: 'klarna',
        provider: 'klarna',
      }),
    );
    fixture.componentRef.setInput('bnplConfirmMode', 'direct');
    fixture.componentRef.setInput('checkout', DIRECT_READY_CHECKOUT);
    await settle();
    fixture.componentInstance.requestPayment('klarna');
    fixture.detectChanges();
    await fixture.whenStable();
    expect(cancels.length).toBe(1);
    expect(fixture.componentInstance.canRequestPayment('klarna')).toBeTrue();
  });

  it('emits a definitive error without a second Intent', async () => {
    const errors: PaymentError[] = [];
    fixture.componentInstance.error.subscribe((value) => errors.push(value));
    klarna.confirmDirectPayment.and.rejectWith(
      new PaymentError({
        code: 'PAYMENT_FAILED',
        message: 'Declined.',
        method: 'klarna',
        provider: 'klarna',
      }),
    );
    fixture.componentRef.setInput('bnplConfirmMode', 'direct');
    fixture.componentRef.setInput('checkout', DIRECT_READY_CHECKOUT);
    await settle();
    fixture.componentInstance.requestPayment('klarna');
    fixture.detectChanges();
    await fixture.whenStable();
    expect(errors.length).toBe(1);
    expect(errors[0].code).toBe('PAYMENT_FAILED');
    expect(klarna.createPaymentSession).toHaveBeenCalledTimes(1);
  });

  it('ignores requestPayment after the host is destroyed', async () => {
    fixture.componentRef.setInput('bnplConfirmMode', 'direct');
    fixture.componentRef.setInput('checkout', DIRECT_READY_CHECKOUT);
    await settle();
    const instance = fixture.componentInstance;
    fixture.destroy();
    instance.requestPayment('klarna');
    expect(klarna.confirmDirectPayment).not.toHaveBeenCalled();
    expect(klarna.createPaymentSession).not.toHaveBeenCalled();
  });

  it('does not add merchant triggers to Full Checkout or Headless', () => {
    expect('requestPayment' in EasyPaymentsComponent.prototype).toBeFalse();
    expect('selectorVisibility' in EasyPaymentsComponent.prototype).toBeFalse();
    expect('requestPayment' in EasyPaymentsHeadless.prototype).toBeFalse();
    expect('bnplConfirmMode' in EasyPaymentsHeadless.prototype).toBeFalse();
  });
});
