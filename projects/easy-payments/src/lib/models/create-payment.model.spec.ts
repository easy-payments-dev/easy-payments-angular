import {
  toAffirmCreatePaymentRequest,
  toKlarnaCreatePaymentRequest,
  toPayPalCreateOrderRequest,
  toUsBankAccountCreatePaymentRequest,
} from './create-payment.model';

describe('toPayPalCreateOrderRequest', () => {
  it('maps only provider, productId, quantity, and currency', () => {
    const body = toPayPalCreateOrderRequest({
      productId: 'premium-plan',
      quantity: 1,
      currency: 'usd',
    });

    expect(body).toEqual({
      provider: 'paypal',
      productId: 'premium-plan',
      quantity: 1,
      currency: 'USD',
    });
    expect(Object.keys(body)).not.toContain('amount');
    expect(Object.keys(body)).not.toContain('metadata');
  });

  it('strips accidental extra fields when mapping from a richer object', () => {
    const dirty = {
      productId: 'premium-plan',
      quantity: 2,
      currency: 'USD',
      amount: 1,
      metadata: { productName: 'Premium Plan' },
    };

    const body = toPayPalCreateOrderRequest(dirty);

    expect(Object.keys(body).sort()).toEqual(['currency', 'productId', 'provider', 'quantity']);
    expect(Object.keys(body)).not.toContain('amount');
    expect(Object.keys(body)).not.toContain('metadata');
  });

  it('copies an explicit order reference and still drops a metadata map', () => {
    const body = toPayPalCreateOrderRequest({
      productId: 'premium-plan',
      quantity: 1,
      currency: 'USD',
      orderReference: 'ORDER-12345',
    });

    expect(body.orderReference).toBe('ORDER-12345');
    expect(Object.keys(body)).not.toContain('metadata');
    expect(Object.keys(body)).not.toContain('amount');
  });
});

describe('toKlarnaCreatePaymentRequest', () => {
  it('maps only provider, productId, quantity, and currency', () => {
    const body = toKlarnaCreatePaymentRequest({
      productId: 'premium-plan',
      quantity: 1,
      currency: 'eur',
    });

    expect(body).toEqual({
      provider: 'klarna',
      productId: 'premium-plan',
      quantity: 1,
      currency: 'EUR',
    });
    expect(Object.keys(body)).not.toContain('amount');
    expect(Object.keys(body)).not.toContain('metadata');
  });

  it('includes preferredLocale when provided', () => {
    const body = toKlarnaCreatePaymentRequest({
      productId: 'premium-plan',
      quantity: 1,
      currency: 'USD',
      preferredLocale: 'es-US',
    });
    expect(body.preferredLocale).toBe('es-US');
  });

  it('copies validated metadata and still omits amount', () => {
    const body = toKlarnaCreatePaymentRequest({
      productId: 'premium-plan',
      quantity: 1,
      currency: 'USD',
      metadata: { orderId: 'ORDER-12345' },
    });
    expect(body.metadata).toEqual({ orderId: 'ORDER-12345' });
    expect(Object.keys(body)).not.toContain('amount');
  });
});

describe('toAffirmCreatePaymentRequest', () => {
  it('maps only provider, productId, quantity, and currency', () => {
    const body = toAffirmCreatePaymentRequest({
      productId: 'premium-plan',
      quantity: 1,
      currency: 'cad',
    });

    expect(body).toEqual({
      provider: 'affirm',
      productId: 'premium-plan',
      quantity: 1,
      currency: 'CAD',
    });
    expect(Object.keys(body)).not.toContain('amount');
    expect(Object.keys(body)).not.toContain('metadata');
  });

  it('includes preferredLocale when provided', () => {
    const body = toAffirmCreatePaymentRequest({
      productId: 'premium-plan',
      quantity: 1,
      currency: 'USD',
      preferredLocale: 'en_US',
    });
    expect(body.preferredLocale).toBe('en_US');
  });
});

describe('toUsBankAccountCreatePaymentRequest', () => {
  it('maps only provider, productId, quantity, and currency', () => {
    const body = toUsBankAccountCreatePaymentRequest({
      productId: 'premium-plan',
      quantity: 1,
      currency: 'usd',
    });

    expect(body).toEqual({
      provider: 'usBankAccount',
      productId: 'premium-plan',
      quantity: 1,
      currency: 'USD',
    });
    expect(Object.keys(body)).not.toContain('amount');
    expect(Object.keys(body)).not.toContain('metadata');
  });

  it('copies validated metadata and still omits amount', () => {
    const body = toUsBankAccountCreatePaymentRequest({
      productId: 'premium-plan',
      quantity: 2,
      currency: 'USD',
      metadata: { orderId: 'ORDER-ACH-1' },
    });
    expect(body.metadata).toEqual({ orderId: 'ORDER-ACH-1' });
    expect(Object.keys(body)).not.toContain('amount');
  });
});
