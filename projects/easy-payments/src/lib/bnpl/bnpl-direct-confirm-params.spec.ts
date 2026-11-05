import {
  buildAffirmDirectConfirmParams,
  buildKlarnaDirectConfirmParams,
} from './bnpl-direct-confirm-params';

const COMPLETE_ADDRESS = {
  line1: '509 Amsterdam Ave',
  line2: 'Apt 1',
  city: 'New York',
  state: 'NY',
  postalCode: '10024',
  country: 'us',
} as const;

describe('bnpl-direct-confirm-params', () => {
  describe('buildKlarnaDirectConfirmParams', () => {
    it('always includes return_url and omits payment_method without country', () => {
      const data = buildKlarnaDirectConfirmParams('https://example.com/return', {
        email: 'a@b.com',
        name: 'A B',
      });
      expect(data.return_url).toBe('https://example.com/return');
      expect(data.payment_method).toBeUndefined();
    });

    it('maps billing with required ISO country and snake_case postal_code', () => {
      const data = buildKlarnaDirectConfirmParams('https://example.com/r', {
        email: 'buyer@example.com',
        name: 'Jenny Rosen',
        phone: '+13106683312',
        address: { ...COMPLETE_ADDRESS },
      });

      expect(data.payment_method).toEqual({
        billing_details: {
          email: 'buyer@example.com',
          name: 'Jenny Rosen',
          phone: '+13106683312',
          address: {
            line1: '509 Amsterdam Ave',
            line2: 'Apt 1',
            city: 'New York',
            state: 'NY',
            postal_code: '10024',
            country: 'US',
          },
        },
      });
    });

    it('maps complete shipping and omits incomplete shipping', () => {
      const withShip = buildKlarnaDirectConfirmParams(
        'https://example.com/r',
        { email: 'a@b.com', name: 'A', address: { ...COMPLETE_ADDRESS } },
        {
          name: 'Ship To',
          address: { ...COMPLETE_ADDRESS },
        },
      );
      expect(withShip.shipping?.name).toBe('Ship To');
      expect(withShip.shipping?.address.country).toBe('US');
      expect(withShip.shipping?.address.postal_code).toBe('10024');

      const incomplete = buildKlarnaDirectConfirmParams('https://example.com/r', undefined, {
        name: 'Ship To',
        address: { line1: '1 Main', city: '', postalCode: '1', country: 'US' },
      });
      expect(incomplete.shipping).toBeUndefined();
    });

    it('rejects invalid country without inventing data', () => {
      const data = buildKlarnaDirectConfirmParams('https://example.com/r', {
        email: 'a@b.com',
        address: { ...COMPLETE_ADDRESS, country: 'USA' },
      });
      expect(data.payment_method).toBeUndefined();
    });
  });

  describe('buildAffirmDirectConfirmParams', () => {
    it('allows billing without inventing missing address', () => {
      const data = buildAffirmDirectConfirmParams('https://example.com/r', {
        email: 'a@b.com',
        name: 'A B',
      });
      expect(data.return_url).toBe('https://example.com/r');
      expect(data.payment_method).toEqual({
        billing_details: {
          email: 'a@b.com',
          name: 'A B',
        },
      });
    });

    it('maps Affirm billing and shipping addresses', () => {
      const data = buildAffirmDirectConfirmParams(
        'https://example.com/r',
        {
          email: 'a@b.com',
          name: 'A B',
          address: { ...COMPLETE_ADDRESS },
        },
        {
          name: 'A B',
          address: { ...COMPLETE_ADDRESS },
        },
      );
      const paymentMethod = data.payment_method;
      expect(typeof paymentMethod).toBe('object');
      if (paymentMethod && typeof paymentMethod === 'object') {
        expect(paymentMethod.billing_details?.address?.country).toBe('US');
      }
      expect(data.shipping?.address.postal_code).toBe('10024');
    });
  });
});
