import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { signZipJsonBody, signZipKeyValues, ZIP_SIGNATURE_HEADER } from './zip-signature.util';
import { ZipService } from './zip.service';

function createService(): ZipService {
  const config = {
    get: (key: string) => {
      if (key === 'ZIP_MODE') return 'sandbox';
      return undefined;
    },
  } as ConfigService;
  return new ZipService(config);
}

describe('ZipService', () => {
  let service: ZipService;

  beforeEach(() => {
    service = createService();
    service.clearPendingForTests();
  });

  it('creates a signed checkout from the catalog amount', () => {
    const result = service.createCheckout({
      provider: 'zip',
      productId: 'premium-plan',
      quantity: 1,
      currency: 'USD',
      redirectConfirmUrl: 'http://localhost:4200/checkout?zip=confirm',
      redirectCancelUrl: 'http://localhost:4200/checkout?zip=cancel',
    });

    expect(result.provider).toBe('zip');
    expect(result.amount).toBe(99);
    expect(result.currency).toBe('USD');
    expect(result.mock).toBe(true);
    expect(result.requestBody['merchantReference']).toBe(result.merchantReference);
    expect(result.signature).toBe(
      signZipJsonBody(service.signingSecret(), JSON.stringify(result.requestBody)),
    );
  });

  it('verifies an approved return query and marks alreadyReported on duplicate', () => {
    const created = service.createCheckout({
      provider: 'zip',
      productId: 'basic-plan',
      quantity: 1,
      redirectConfirmUrl: 'http://localhost:4200/?ok=1',
      redirectCancelUrl: 'http://localhost:4200/?cancel=1',
    });

    const params = {
      merchantReference: created.merchantReference,
      orderId: 'ord-approve-1',
      success: 'True',
      amount: '29.99',
      currency: 'USD',
      merchantId: created.merchantId,
    };
    const signature = signZipKeyValues(service.signingSecret(), params);
    const returnQuery = new URLSearchParams({
      ...params,
      [ZIP_SIGNATURE_HEADER]: signature,
    }).toString();

    const first = service.verifyReturn({
      provider: 'zip',
      merchantReference: created.merchantReference,
      returnQuery,
    });
    expect(first.success).toBe(true);
    expect(first.status).toBe('confirmed');
    expect(first.alreadyReported).toBe(false);

    const second = service.verifyReturn({
      provider: 'zip',
      merchantReference: created.merchantReference,
      returnQuery,
    });
    expect(second.success).toBe(true);
    expect(second.alreadyReported).toBe(true);
  });

  it('rejects invalid return signatures', () => {
    const created = service.createCheckout({
      provider: 'zip',
      productId: 'basic-plan',
      quantity: 1,
      redirectConfirmUrl: 'http://localhost:4200/?ok=1',
      redirectCancelUrl: 'http://localhost:4200/?cancel=1',
    });

    expect(() =>
      service.verifyReturn({
        provider: 'zip',
        merchantReference: created.merchantReference,
        returnQuery: `merchantReference=${created.merchantReference}&success=True&X-QP-Signature=bad`,
      }),
    ).toThrow(BadRequestException);
  });

  it('treats success=False as declined', () => {
    const created = service.createCheckout({
      provider: 'zip',
      productId: 'basic-plan',
      quantity: 1,
      redirectConfirmUrl: 'http://localhost:4200/?ok=1',
      redirectCancelUrl: 'http://localhost:4200/?cancel=1',
    });

    const params = {
      merchantReference: created.merchantReference,
      orderId: 'ord-decline-1',
      success: 'False',
      amount: '29.99',
      currency: 'USD',
      merchantId: created.merchantId,
    };
    const signature = signZipKeyValues(service.signingSecret(), params);
    const returnQuery = new URLSearchParams({
      ...params,
      [ZIP_SIGNATURE_HEADER]: signature,
    }).toString();

    const result = service.verifyReturn({
      provider: 'zip',
      merchantReference: created.merchantReference,
      returnQuery,
    });
    expect(result.success).toBe(false);
    expect(result.status).toBe('declined');
  });

  it('captures idempotently in mock mode', async () => {
    const created = service.createCheckout({
      provider: 'zip',
      productId: 'basic-plan',
      quantity: 1,
      redirectConfirmUrl: 'http://localhost:4200/?ok=1',
      redirectCancelUrl: 'http://localhost:4200/?cancel=1',
    });

    const first = await service.captureOrder({
      provider: 'zip',
      orderId: 'ord-cap-1',
      merchantReference: created.merchantReference,
    });
    expect(first.alreadyCaptured).toBe(false);

    const second = await service.captureOrder({
      provider: 'zip',
      orderId: 'ord-cap-1',
      merchantReference: created.merchantReference,
    });
    expect(second.alreadyCaptured).toBe(true);
  });

  it('deduplicates webhook callbacks', () => {
    const created = service.createCheckout({
      provider: 'zip',
      productId: 'basic-plan',
      quantity: 1,
      redirectConfirmUrl: 'http://localhost:4200/?ok=1',
      redirectCancelUrl: 'http://localhost:4200/?cancel=1',
    });

    const body = {
      timestamp: '2020-04-27T12:34:56.000000Z',
      merchantId: created.merchantId,
      orderId: 'ord-wh-1',
      currency: 'USD',
      amount: 29.99,
      merchantReference: created.merchantReference,
      success: true,
    };
    const raw = JSON.stringify(body);
    const signature = signZipJsonBody(service.signingSecret(), raw);

    const first = service.applyWebhook(body, raw, signature);
    expect(first.duplicate).toBe(false);
    expect(first.ignored).toBe(false);

    const second = service.applyWebhook(body, raw, signature);
    expect(second.duplicate).toBe(true);
    expect(second.ignored).toBe(true);
  });
});
