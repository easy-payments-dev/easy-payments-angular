import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideEasyPayments } from '../../config/provide-easy-payments';
import { EasyPaymentsComponent } from './easy-payments.component';
import { MockPaymentController } from '../../adapters/mock/mock-payment.controller';
import { PaymentOrchestratorService } from '../../services/payment-orchestrator.service';
import { SAMPLE_PRODUCT } from '../../testing/test-doubles';
import type { AvailablePaymentMethod } from '../../services/payment-orchestrator.service';
import type { PaymentResult } from '../../models';

function stubAvailability(
  fixture: ComponentFixture<EasyPaymentsComponent>,
  results: AvailablePaymentMethod[],
): void {
  const host = fixture.componentInstance as unknown as {
    availabilitySession: { apply: (value: readonly AvailablePaymentMethod[]) => void };
  };
  host.availabilitySession.apply(results);
}

describe('EasyPaymentsComponent ACH Full Checkout', () => {
  let fixture: ComponentFixture<EasyPaymentsComponent>;
  let mockController: MockPaymentController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [EasyPaymentsComponent],
      providers: [
        provideEasyPayments({
          enableMockMode: true,
          providers: {},
        }),
      ],
    }).compileComponents();

    mockController = TestBed.inject(MockPaymentController);
    const orchestrator = TestBed.inject(PaymentOrchestratorService);
    await orchestrator.reinitialize();

    fixture = TestBed.createComponent(EasyPaymentsComponent);
    fixture.componentRef.setInput('product', { ...SAMPLE_PRODUCT });
    fixture.componentRef.setInput('methods', ['card', 'us-bank-account']);
  });

  it('emits pending (not success) when mock ACH outcome is processing', async () => {
    mockController.setOutcome('processing');
    stubAvailability(fixture, [
      { method: 'card', isMock: true, available: true, status: 'available' },
      { method: 'us-bank-account', isMock: true, available: true, status: 'available' },
    ]);
    fixture.detectChanges();
    await fixture.whenStable();

    const pending: PaymentResult[] = [];
    const successes: PaymentResult[] = [];
    fixture.componentInstance.pending.subscribe((result) => pending.push(result));
    fixture.componentInstance.success.subscribe((result) => successes.push(result));

    (
      fixture.componentInstance as unknown as {
        updateSelectedMethod: (method: 'us-bank-account') => void;
      }
    ).updateSelectedMethod('us-bank-account');
    fixture.detectChanges();
    await fixture.componentInstance.onPay('us-bank-account');
    fixture.detectChanges();

    expect(pending.length).toBe(1);
    expect(pending[0].status).toBe('processing');
    expect(pending[0].method).toBe('us-bank-account');
    expect(successes.length).toBe(0);
    // Verified processing exits the spinner into a settled pending confirmation.
    expect(fixture.componentInstance.viewState()).toBe('pending');
  });

  it('still emits success for mock ACH when outcome is success', async () => {
    mockController.setOutcome('success');
    stubAvailability(fixture, [
      { method: 'us-bank-account', isMock: true, available: true, status: 'available' },
    ]);
    fixture.componentRef.setInput('methods', ['us-bank-account']);
    fixture.detectChanges();
    await fixture.whenStable();

    const pending: PaymentResult[] = [];
    const successes: PaymentResult[] = [];
    fixture.componentInstance.pending.subscribe((result) => pending.push(result));
    fixture.componentInstance.success.subscribe((result) => successes.push(result));

    await fixture.componentInstance.onPay('us-bank-account');
    fixture.detectChanges();

    expect(successes.length).toBe(1);
    expect(successes[0].status).toBe('success');
    expect(pending.length).toBe(0);
  });
});
