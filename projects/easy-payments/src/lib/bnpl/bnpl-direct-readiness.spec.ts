import type { CheckoutOptions } from '../models/checkout-options.model';
import { evaluateBnplDirectReadiness } from './bnpl-direct-readiness';

const US_ADDRESS = {
  line1: '509 Amsterdam Ave',
  city: 'New York',
  state: 'NY',
  postalCode: '10024',
  country: 'US',
} as const;

function klarnaReadyCheckout(): CheckoutOptions {
  return {
    customer: {
      email: 'buyer@example.com',
      name: 'Jenny Rosen',
    },
  };
}

function affirmReadyCheckout(): CheckoutOptions {
  return {
    customer: {
      email: 'buyer@example.com',
      name: 'Jenny Rosen',
      address: { ...US_ADDRESS },
    },
  };
}

describe('evaluateBnplDirectReadiness', () => {
  it('marks Klarna Direct-ready with email and name', () => {
    const checkout = klarnaReadyCheckout();
    const snapshot = structuredClone(checkout);

    const result = evaluateBnplDirectReadiness({
      provider: 'klarna',
      mode: 'auto',
      checkout,
    });

    expect(result).toEqual({
      ready: true,
      selectedFlow: 'direct',
      missingFields: [],
      reasonCodes: ['ready'],
    });
    expect(checkout).toEqual(snapshot);
  });

  it('marks Affirm Direct-ready with email, name, and complete billing address', () => {
    const result = evaluateBnplDirectReadiness({
      provider: 'affirm',
      mode: 'direct',
      checkout: affirmReadyCheckout(),
    });

    expect(result.ready).toBeTrue();
    expect(result.selectedFlow).toBe('direct');
    expect(result.reasonCodes).toEqual(['ready']);
  });

  it('reports missing email and name without echoing values', () => {
    const result = evaluateBnplDirectReadiness({
      provider: 'klarna',
      mode: 'auto',
      checkout: {
        customer: { email: '   ', name: '' },
      },
    });

    expect(result.ready).toBeFalse();
    expect(result.selectedFlow).toBe('element');
    expect(result.missingFields).toEqual(['customer.email', 'customer.name']);
    expect(result.reasonCodes).toEqual(['missing_email', 'missing_name']);
    expect(JSON.stringify(result)).not.toContain('@');
  });

  it('requires Affirm billing address', () => {
    const result = evaluateBnplDirectReadiness({
      provider: 'affirm',
      mode: 'auto',
      checkout: {
        customer: { email: 'a@b.com', name: 'A B' },
      },
    });

    expect(result.ready).toBeFalse();
    expect(result.missingFields).toContain('customer.address');
    expect(result.reasonCodes).toContain('missing_billing_address');
    expect(result.selectedFlow).toBe('element');
  });

  it('reports incomplete Affirm billing address field paths', () => {
    const result = evaluateBnplDirectReadiness({
      provider: 'affirm',
      mode: 'auto',
      checkout: {
        customer: {
          email: 'a@b.com',
          name: 'A B',
          address: {
            line1: '1 Main',
            city: '',
            postalCode: '10001',
            country: 'US',
          },
        },
      },
    });

    expect(result.reasonCodes).toContain('incomplete_billing_address');
    expect(result.missingFields).toEqual(['customer.address.city']);
  });

  it('requires shipping name and address when shipping.required is true', () => {
    const result = evaluateBnplDirectReadiness({
      provider: 'klarna',
      mode: 'auto',
      checkout: {
        ...klarnaReadyCheckout(),
        shipping: { required: true },
      },
    });

    expect(result.ready).toBeFalse();
    expect(result.missingFields).toContain('shipping.name');
    expect(result.missingFields).toContain('shipping.address');
    expect(result.reasonCodes).toContain('missing_shipping_name');
    expect(result.reasonCodes).toContain('missing_shipping_address');
  });

  it('accepts Klarna with required shipping when shipping fields are complete', () => {
    const result = evaluateBnplDirectReadiness({
      provider: 'klarna',
      mode: 'auto',
      checkout: {
        customer: { email: 'a@b.com', name: 'A B' },
        shipping: {
          required: true,
          name: 'A B',
          address: { ...US_ADDRESS },
        },
      },
    });

    expect(result.ready).toBeTrue();
    expect(result.selectedFlow).toBe('direct');
  });

  it('rejects invalid country codes without including the value in codes', () => {
    const result = evaluateBnplDirectReadiness({
      provider: 'affirm',
      mode: 'direct',
      checkout: {
        customer: {
          email: 'a@b.com',
          name: 'A B',
          address: {
            ...US_ADDRESS,
            country: 'USA',
          },
        },
      },
    });

    expect(result.ready).toBeFalse();
    expect(result.selectedFlow).toBe('configuration-error');
    expect(result.reasonCodes).toContain('invalid_billing_country');
    expect(result.missingFields).toContain('customer.address.country');
    expect(result.reasonCodes.join(',')).not.toContain('USA');
  });

  it('treats whitespace-only address fields as incomplete', () => {
    const result = evaluateBnplDirectReadiness({
      provider: 'affirm',
      mode: 'auto',
      checkout: {
        customer: {
          email: 'a@b.com',
          name: 'A B',
          address: {
            line1: '  ',
            city: ' New York ',
            postalCode: '10024',
            country: ' us ',
          },
        },
      },
    });

    expect(result.ready).toBeFalse();
    expect(result.missingFields).toContain('customer.address.line1');
    // country with spaces around valid alpha-2 is accepted after trim
    expect(result.missingFields).not.toContain('customer.address.country');
  });

  it('uses auto fallback to element when Direct is not ready', () => {
    const result = evaluateBnplDirectReadiness({
      provider: 'klarna',
      mode: 'auto',
      checkout: {},
    });

    expect(result.selectedFlow).toBe('element');
    expect(result.ready).toBeFalse();
    expect(result.reasonCodes).not.toContain('direct_not_ready');
  });

  it('uses configuration-error for direct mode when not ready', () => {
    const result = evaluateBnplDirectReadiness({
      provider: 'affirm',
      mode: 'direct',
      checkout: klarnaReadyCheckout(),
    });

    expect(result.selectedFlow).toBe('configuration-error');
    expect(result.reasonCodes).toContain('missing_billing_address');
    expect(result.reasonCodes).toContain('direct_not_ready');
  });

  it('always selects Payment Element for element mode even when Direct-ready', () => {
    const result = evaluateBnplDirectReadiness({
      provider: 'klarna',
      mode: 'element',
      checkout: klarnaReadyCheckout(),
    });

    expect(result).toEqual({
      ready: false,
      selectedFlow: 'element',
      missingFields: [],
      reasonCodes: ['mode_element'],
    });
  });

  it('defaults omitted mode to auto', () => {
    const result = evaluateBnplDirectReadiness({
      provider: 'klarna',
      checkout: {},
    });
    expect(result.selectedFlow).toBe('element');
  });

  it('does not mutate nested checkout objects', () => {
    const checkout: CheckoutOptions = affirmReadyCheckout();
    const addressBefore = { ...checkout.customer!.address! };
    evaluateBnplDirectReadiness({
      provider: 'affirm',
      mode: 'auto',
      checkout,
    });
    expect(checkout.customer!.address).toEqual(addressBefore);
  });

  it('keeps legacy checkout shapes backward compatible', () => {
    const legacy: CheckoutOptions = {
      successBehavior: 'event-only',
      customer: { email: 'legacy@example.com', name: 'Legacy User' },
      shipping: { required: false },
    };

    const klarna = evaluateBnplDirectReadiness({
      provider: 'klarna',
      mode: 'auto',
      checkout: legacy,
    });
    expect(klarna.ready).toBeTrue();

    const affirm = evaluateBnplDirectReadiness({
      provider: 'affirm',
      mode: 'auto',
      checkout: legacy,
    });
    expect(affirm.ready).toBeFalse();
    expect(affirm.selectedFlow).toBe('element');
  });
});
