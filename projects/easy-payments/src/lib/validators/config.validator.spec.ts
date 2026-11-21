import { TestBed } from '@angular/core/testing';
import { provideEasyPayments } from '../config/provide-easy-payments';
import { EasyPaymentsConfigValidator } from './config.validator';

describe('EasyPaymentsConfigValidator', () => {
  it('reports configured providers and required-field gaps without exposing secrets', () => {
    TestBed.configureTestingModule({
      providers: [
        provideEasyPayments({
          enableMockMode: true,
          providers: {
            stripe: { publishableKey: 'pk_test_secret_value' },
            paypal: { clientId: 'paypal-client' },
            googlePay: { merchantId: 'merchant-123' },
            applePay: { merchantName: 'Demo' },
            klarna: {},
            affirm: {},
          },
        }),
      ],
    });

    const validator = TestBed.inject(EasyPaymentsConfigValidator);
    const summary = validator.getStatusSummary();

    expect(summary).toContain('Stripe: configured (demo mode)');
    expect(summary).toContain('PayPal: configured (demo mode)');
    expect(summary).toContain('Google Pay: configured (demo mode)');
    expect(summary).toContain('Apple Pay: configured (demo mode)');
    expect(summary).toContain('Klarna: configured (demo mode)');
    expect(summary).toContain('Affirm: configured (demo mode)');
    expect(summary.join(' ')).not.toContain('pk_test_secret_value');
  });
  it('treats Link as explicit opt-in via providers.link', () => {
    TestBed.configureTestingModule({
      providers: [
        provideEasyPayments({
          enableMockMode: false,
          providers: { stripe: { publishableKey: 'pk_test_123' } },
        }),
      ],
    });
    const validator = TestBed.inject(EasyPaymentsConfigValidator);

    expect(validator.validateProvider('link', undefined).status).toBe('missing');
    expect(validator.validateProvider('link', {}).status).toBe('configured');
    expect(
      validator.validateAll(['link'], {
        providers: { stripe: { publishableKey: 'pk_test_123' }, link: {} },
      }).find((r) => r.provider === 'link')?.status,
    ).toBe('configured');
    expect(
      validator.validateAll(['card'], {
        providers: { stripe: { publishableKey: 'pk_test_123' }, link: {} },
      }).find((r) => r.provider === 'link')?.status,
    ).toBe('not_requested');
    expect(validator.formatStatusLine({ provider: 'link', status: 'missing', message: 'x' })).toContain(
      'Link:',
    );
  });

  it('treats Amazon Pay as explicit opt-in via providers.amazonPay', () => {
    TestBed.configureTestingModule({
      providers: [
        provideEasyPayments({
          enableMockMode: false,
          providers: { stripe: { publishableKey: 'pk_test_123' } },
        }),
      ],
    });
    const validator = TestBed.inject(EasyPaymentsConfigValidator);

    expect(validator.validateProvider('amazonPay', undefined).status).toBe('missing');
    expect(validator.validateProvider('amazonPay', {}).status).toBe('configured');
    expect(
      validator.validateAll(['amazon-pay'], {
        providers: { stripe: { publishableKey: 'pk_test_123' }, amazonPay: {} },
      }).find((r) => r.provider === 'amazonPay')?.status,
    ).toBe('configured');
    expect(
      validator.formatStatusLine({ provider: 'amazonPay', status: 'missing', message: 'x' }),
    ).toContain('Amazon Pay:');
  });

  it('rejects Stripe secret keys in frontend configuration', () => {
    TestBed.configureTestingModule({
      providers: [
        provideEasyPayments({
          enableMockMode: false,
          providers: {
            stripe: { publishableKey: 'sk_test_should_never_be_here' },
          },
        }),
      ],
    });

    const validator = TestBed.inject(EasyPaymentsConfigValidator);
    const result = validator.validateProvider('stripe', {
      publishableKey: 'sk_test_should_never_be_here',
    });
    expect(result.status).toBe('invalid');
    expect(result.message).toContain('secret key');
  });

  it('omits the demo-mode suffix when mock mode is off', () => {
    TestBed.configureTestingModule({
      providers: [
        provideEasyPayments({
          enableMockMode: false,
          providers: {
            stripe: { publishableKey: 'pk_live_example' },
          },
        }),
      ],
    });

    const validator = TestBed.inject(EasyPaymentsConfigValidator);
    expect(validator.getStatusSummary()).toContain('Stripe: configured');
    expect(validator.getStatusSummary().find((line) => line.startsWith('Stripe:'))).not.toContain(
      'demo mode',
    );
  });
});
