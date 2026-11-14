import { TestBed } from '@angular/core/testing';
import { provideEasyPayments } from '../../config/provide-easy-payments';
import { AdapterFactory } from '../adapter.factory';
import { AdapterRegistry } from '../../core/adapter-registry';
import { MockPaymentController } from './mock-payment.controller';
import { SAMPLE_PRODUCT } from '../../testing/test-doubles';
import { PaymentContext } from '../../models';
import { PaymentError } from '../../errors/payment-error';

const context: PaymentContext = {
  product: { ...SAMPLE_PRODUCT },
  theme: 'light',
};

describe('mock adapters', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideEasyPayments({
          enableMockMode: true,
          providers: {},
        }),
      ],
    });
  });

  it('registers a mock adapter for every provider', async () => {
    const factory = TestBed.inject(AdapterFactory);
    const registry = TestBed.inject(AdapterRegistry);

    await factory.initializeAdapters();

    const adapters = registry.getAll();
    expect(adapters.length).toBe(11);
    expect(adapters.every((adapter) => adapter.isMock)).toBeTrue();
    expect(adapters.map((adapter) => adapter.provider).sort()).toEqual([
      'affirm',
      'afterpay',
      'applePay',
      'cashAppPay',
      'googlePay',
      'klarna',
      'paypal',
      'stripe',
      'usBankAccount',
      'venmo',
      'zip',
    ]);
  });

  it('simulates an opt-in processing mock payment without treating it as success', async () => {
    const factory = TestBed.inject(AdapterFactory);
    const controller = TestBed.inject(MockPaymentController);
    await factory.initializeAdapters();
    controller.setOutcome('processing');

    const result = await factory.getAdapter('usBankAccount')!.createPayment({
      method: 'us-bank-account',
      context,
    });

    expect(result.status).toBe('processing');
    expect(result.method).toBe('us-bank-account');
    expect(result.provider).toBe('usBankAccount');
    expect(result.message).toContain('processing');
    expect(result.message).toContain('Do not treat this as success');
    expect(result.metadata?.['mock']).toBeTrue();
  });

  it('simulates a successful mock payment', async () => {
    const factory = TestBed.inject(AdapterFactory);
    const controller = TestBed.inject(MockPaymentController);
    await factory.initializeAdapters();
    controller.setOutcome('success');

    const result = await factory.getAdapter('paypal')!.createPayment({
      method: 'paypal',
      context,
    });

    expect(result.status).toBe('success');
    expect(result.method).toBe('paypal');
    expect(result.provider).toBe('paypal');
    expect(result.transactionId?.startsWith('mock_paypal_')).toBeTrue();
    expect(result.message).toContain('not a real transaction');
    expect(result.metadata?.['mock']).toBeTrue();
  });

  it('simulates a cancelled mock payment', async () => {
    const factory = TestBed.inject(AdapterFactory);
    const controller = TestBed.inject(MockPaymentController);
    await factory.initializeAdapters();
    controller.setOutcome('cancelled');

    const result = await factory.getAdapter('applePay')!.createPayment({
      method: 'apple-pay',
      context,
    });

    expect(result.status).toBe('cancelled');
    expect(result.method).toBe('apple-pay');
    expect(result.message).toContain('cancelled');
    expect(result.message).toContain('No real payment');
  });

  it('simulates a failed mock payment as PaymentError', async () => {
    const factory = TestBed.inject(AdapterFactory);
    const controller = TestBed.inject(MockPaymentController);
    await factory.initializeAdapters();
    controller.setOutcome('failed');

    await expectAsync(
      factory.getAdapter('stripe')!.createPayment({
        method: 'card',
        context,
      }),
    ).toBeRejectedWith(jasmine.any(PaymentError));

    try {
      await factory.getAdapter('stripe')!.createPayment({
        method: 'card',
        context,
      });
      fail('expected failure');
    } catch (error) {
      expect(error).toBeInstanceOf(PaymentError);
      expect((error as PaymentError).code).toBe('PAYMENT_FAILED');
      expect((error as PaymentError).method).toBe('card');
      expect((error as PaymentError).message).toContain('No real payment');
    }
  });
});
