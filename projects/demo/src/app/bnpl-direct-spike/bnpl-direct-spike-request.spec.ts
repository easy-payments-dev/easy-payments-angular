import { HttpErrorResponse } from '@angular/common/http';
import { MERCHANT_METADATA_RESERVED_KEYS } from '@easy-payments/angular';
import {
  buildCreateBnplPaymentBody,
  describeSpikeConfig,
  formatSpikeFailure,
  resolveSpikeCreateUrl,
} from './bnpl-direct-spike-request';

describe('bnpl-direct-spike-request', () => {
  describe('buildCreateBnplPaymentBody', () => {
    it('preserves server-priced catalog product identity and normalizes currency', () => {
      const body = buildCreateBnplPaymentBody({
        provider: 'klarna',
        productId: '  premium-plan  ',
        quantity: 2,
        currency: 'usd',
      });

      expect(body).toEqual({
        provider: 'klarna',
        productId: 'premium-plan',
        quantity: 2,
        currency: 'USD',
        metadata: {
          orderId: 'SPIKE-H6241',
          customerReference: 'SPIKE-TEST',
        },
      });
      expect((body as { amount?: unknown }).amount).toBeUndefined();
    });

    it('builds Affirm bodies with the affirm provider and defaults empty product id', () => {
      const body = buildCreateBnplPaymentBody({
        provider: 'affirm',
        productId: '   ',
        quantity: 0,
        currency: '',
      });

      expect(body.provider).toBe('affirm');
      expect(body.productId).toBe('premium-plan');
      expect(body.quantity).toBe(1);
      expect(body.currency).toBe('USD');
    });

    it('never sends reserved merchant metadata keys', () => {
      for (const provider of ['klarna', 'affirm'] as const) {
        const body = buildCreateBnplPaymentBody({
          provider,
          productId: 'premium-plan',
          quantity: 1,
          currency: 'USD',
        });
        const keys = Object.keys(body.metadata ?? {}).map((key) => key.toLowerCase());
        for (const reserved of MERCHANT_METADATA_RESERVED_KEYS) {
          expect(keys).not.toContain(reserved);
        }
        expect(keys).not.toContain('source');
        expect(keys).not.toContain('spike');
      }
    });

    it('only uses allowed merchant-style metadata keys', () => {
      const body = buildCreateBnplPaymentBody({
        provider: 'klarna',
        productId: 'premium-plan',
        quantity: 1,
        currency: 'USD',
      });
      expect(Object.keys(body.metadata ?? {}).sort()).toEqual([
        'customerReference',
        'orderId',
      ]);
    });
  });

  describe('formatSpikeFailure', () => {
    it('surfaces Nest HTTP 400 public validation messages safely', () => {
      const err = new HttpErrorResponse({
        status: 400,
        statusText: 'Bad Request',
        error: {
          message: 'Merchant metadata contains a reserved key.',
          error: 'Bad Request',
          statusCode: 400,
        },
      });

      expect(formatSpikeFailure(err, 'backend')).toBe(
        'Backend HTTP 400: Merchant metadata contains a reserved key.',
      );
    });

    it('does not echo client secrets from error payloads', () => {
      const err = new HttpErrorResponse({
        status: 500,
        error: { message: 'client_secret=pi_secret_leak' },
      });

      expect(formatSpikeFailure(err)).toBe('Backend HTTP 500: Request failed.');
    });

    it('prefixes generic Error messages for the spike phase', () => {
      expect(formatSpikeFailure(new Error('boom'))).toBe('Spike failed: boom');
      expect(formatSpikeFailure({})).toBe('Spike failed: Unknown error');
    });
  });

  describe('describeSpikeConfig', () => {
    it('allows empty backendBaseUrl when create URLs are absolute', () => {
      const result = describeSpikeConfig({
        stripePublishableKey: 'pk_test_x',
        backendBaseUrl: '',
        klarnaCreatePaymentUrl: 'http://localhost:3001/api/payments/klarna/create',
        affirmCreatePaymentUrl: 'http://localhost:3001/api/payments/affirm/create',
      });
      expect(result.blockers).toEqual([]);
      expect(result.notes.some((n) => n.includes('absolute create URLs'))).toBeTrue();
    });

    it('blocks non-test publishable keys', () => {
      const result = describeSpikeConfig({
        stripePublishableKey: 'YOUR_STRIPE_PUBLISHABLE_KEY',
        backendBaseUrl: 'http://localhost:3001',
        klarnaCreatePaymentUrl: '/api/payments/klarna/create',
        affirmCreatePaymentUrl: '/api/payments/affirm/create',
      });
      expect(result.blockers.join(' ')).toContain('pk_test_');
    });
  });

  describe('resolveSpikeCreateUrl', () => {
    it('joins relative paths and preserves absolute URLs', () => {
      expect(resolveSpikeCreateUrl('/api/payments/klarna/create', 'http://localhost:3001')).toBe(
        'http://localhost:3001/api/payments/klarna/create',
      );
      expect(
        resolveSpikeCreateUrl('http://localhost:3001/api/payments/affirm/create', ''),
      ).toBe('http://localhost:3001/api/payments/affirm/create');
    });
  });
});
