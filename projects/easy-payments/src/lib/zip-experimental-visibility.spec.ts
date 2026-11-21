import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideEasyPayments } from './config/provide-easy-payments';
import { EasyPaymentsComponent } from './components/payments/easy-payments.component';
import { EasyPaymentButtonsComponent } from './components/payment-buttons/easy-payment-buttons.component';
import { EasyPaymentsHeadless } from './headless/easy-payments-headless.service';
import { BrowserGuard } from './utils/browser-guard';
import { FakeBrowserGuard, SAMPLE_PRODUCT } from './testing/test-doubles';
import { MockPaymentController } from './adapters/mock/mock-payment.controller';
import type { AvailablePaymentMethod } from './services/payment-orchestrator.service';

/**
 * Zip is experimental for 1.3.0: absent from library defaults / demos, but
 * explicit `methods` opt-in must still enable the existing integration.
 */
describe('Zip experimental visibility', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [EasyPaymentsComponent, EasyPaymentButtonsComponent],
      providers: [
        provideEasyPayments({
          enableMockMode: true,
          providers: { zip: {} },
          backend: {
            zipCreateCheckoutUrl: '/api/payments/zip/create',
            zipVerifyReturnUrl: '/api/payments/zip/verify',
          },
        }),
        { provide: BrowserGuard, useValue: new FakeBrowserGuard() },
      ],
    }).compileComponents();
    TestBed.inject(MockPaymentController).reset();
  });

  it('omits zip from Full Checkout default methods', () => {
    const fixture = TestBed.createComponent(EasyPaymentsComponent);
    fixture.componentRef.setInput('product', { ...SAMPLE_PRODUCT });
    fixture.detectChanges();
    const methods = fixture.componentInstance.methods();
    expect(methods).toEqual(['apple-pay', 'google-pay', 'paypal', 'card']);
    expect(methods.includes('zip')).toBeFalse();
  });

  it('omits zip from Buttons Only default methods', () => {
    const fixture = TestBed.createComponent(EasyPaymentButtonsComponent);
    fixture.componentRef.setInput('product', { ...SAMPLE_PRODUCT });
    fixture.detectChanges();
    const methods = fixture.componentInstance.methods();
    expect(methods).toEqual(['card', 'paypal', 'apple-pay', 'google-pay', 'klarna', 'affirm']);
    expect(methods.includes('zip')).toBeFalse();
  });

  it('still enables Zip in Full Checkout when methods explicitly include zip', async () => {
    const fixture = TestBed.createComponent(EasyPaymentsComponent);
    fixture.componentRef.setInput('product', { ...SAMPLE_PRODUCT });
    fixture.componentRef.setInput('methods', ['card', 'zip']);
    fixture.detectChanges();
    await fixture.whenStable();

    applyCheckoutAvailability(fixture, [
      { method: 'card', isMock: true, available: true, status: 'available' },
      { method: 'zip', isMock: true, available: true, status: 'available' },
    ]);
    fixture.detectChanges();

    expect(fixture.componentInstance.methods()).toEqual(['card', 'zip']);
    const visible = fixture.componentInstance
      .visibleMethods()
      .map((entry) => entry.method);
    expect(visible).toContain('zip');
    expect(visible).toContain('card');
  });

  it('still accepts zip in Headless session methods', async () => {
    const headless = TestBed.inject(EasyPaymentsHeadless);
    const session = headless.createSession({
      product: { ...SAMPLE_PRODUCT },
      methods: ['zip', 'card'],
      checkoutInstanceId: 'zip-experimental-opt-in',
    });
    await session.initialize();
    const available = session.availableMethods().map((entry) => entry.method);
    expect(available).toContain('zip');
    expect(available).toContain('card');
    await session.destroy();
  });
});

function applyCheckoutAvailability(
  fixture: ComponentFixture<EasyPaymentsComponent>,
  results: AvailablePaymentMethod[],
): void {
  (
    fixture.componentInstance as unknown as {
      availabilitySession: { apply: (value: readonly AvailablePaymentMethod[]) => void };
    }
  ).availabilitySession.apply(results);
}
