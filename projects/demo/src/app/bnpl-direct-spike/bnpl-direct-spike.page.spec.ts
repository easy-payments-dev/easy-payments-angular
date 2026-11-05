import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { BnplDirectSpikePage } from './bnpl-direct-spike.page';
import { BNPL_SPIKE_ENVIRONMENT } from './bnpl-direct-spike-request';

const TEST_ENV = {
  stripePublishableKey: 'pk_test_spike_unit_placeholder',
  backendBaseUrl: 'http://localhost:3001',
  klarnaCreatePaymentUrl: '/api/payments/klarna/create',
  affirmCreatePaymentUrl: '/api/payments/affirm/create',
};

describe('BnplDirectSpikePage', () => {
  let http: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [BnplDirectSpikePage],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: BNPL_SPIKE_ENVIRONMENT, useValue: TEST_ENV },
      ],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
  });

  it('does not create PaymentIntents or confirm on load', () => {
    const fixture = TestBed.createComponent(BnplDirectSpikePage);
    fixture.detectChanges();
    http.expectNone(() => true);
    expect(fixture.componentInstance.busy()).toBeFalse();
    expect(fixture.componentInstance.status().message).toContain('Idle');
  });

  it('posts Klarna create to the configured endpoint without reserved metadata', async () => {
    const fixture = TestBed.createComponent(BnplDirectSpikePage);
    const page = fixture.componentInstance;
    fixture.detectChanges();

    const pending = page.onTestKlarna();
    const req = http.expectOne('http://localhost:3001/api/payments/klarna/create');
    expect(req.request.method).toBe('POST');
    expect(req.request.body.provider).toBe('klarna');
    expect(req.request.body.productId).toBe('premium-plan');
    expect(req.request.body.amount).toBeUndefined();
    expect(req.request.body.metadata.source).toBeUndefined();
    expect(req.request.body.metadata.orderId).toBe('SPIKE-H6241');

    req.flush(
      {
        message: 'Merchant metadata contains a reserved key.',
        error: 'Bad Request',
        statusCode: 400,
      },
      { status: 400, statusText: 'Bad Request' },
    );

    await pending;
    expect(page.status().message).toContain('Backend HTTP 400');
    expect(page.status().message).toContain('Merchant metadata contains a reserved key.');
    expect(page.status().message.toLowerCase()).not.toContain('client_secret');
    expect(page.busy()).toBeFalse();
  });

  it('posts Affirm create to the configured endpoint', async () => {
    const fixture = TestBed.createComponent(BnplDirectSpikePage);
    const page = fixture.componentInstance;
    fixture.detectChanges();

    const pending = page.onTestAffirm();
    const req = http.expectOne('http://localhost:3001/api/payments/affirm/create');
    expect(req.request.method).toBe('POST');
    expect(req.request.body.provider).toBe('affirm');
    expect(req.request.body.metadata.source).toBeUndefined();

    req.flush(
      { message: 'Affirm requires a minimum of about $35.00' },
      { status: 400, statusText: 'Bad Request' },
    );
    await pending;
    expect(page.status().message).toContain('Backend HTTP 400');
  });

  it('ignores a second click while a create request is in flight', async () => {
    const fixture = TestBed.createComponent(BnplDirectSpikePage);
    const page = fixture.componentInstance;
    fixture.detectChanges();

    const first = page.onTestKlarna();
    const ignored = page.onTestKlarna();
    await ignored;

    expect(page.status().message).toContain('already in progress');

    const req = http.expectOne('http://localhost:3001/api/payments/klarna/create');
    req.flush(
      { message: 'Merchant metadata contains a reserved key.' },
      { status: 400, statusText: 'Bad Request' },
    );
    await first;
  });
});
