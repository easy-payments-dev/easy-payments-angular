import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { signZipJsonBody } from '../zip/zip-signature.util';
import { ZipService } from '../zip/zip.service';
import { PaymentStatusStore } from './payment-status.store';
import { ZipWebhookService } from './zip-webhook.service';

describe('ZipWebhookService', () => {
  let zipService: ZipService;
  let store: PaymentStatusStore;
  let webhook: ZipWebhookService;

  beforeEach(() => {
    const config = {
      get: () => undefined,
    } as unknown as ConfigService;
    zipService = new ZipService(config);
    zipService.clearPendingForTests();
    store = new PaymentStatusStore();
    store.clear();
    webhook = new ZipWebhookService(zipService, store);
  });

  it('accepts a signed webhook and stores SUCCEEDED', () => {
    const created = zipService.createCheckout({
      provider: 'zip',
      productId: 'basic-plan',
      quantity: 1,
      redirectConfirmUrl: 'http://localhost:4200/?ok=1',
      redirectCancelUrl: 'http://localhost:4200/?cancel=1',
    });

    const body = {
      timestamp: '2020-04-27T12:34:56.000000Z',
      merchantId: created.merchantId,
      orderId: 'ord-wh-accept',
      currency: 'USD',
      amount: 29.99,
      merchantReference: created.merchantReference,
      success: true,
    };
    const raw = JSON.stringify(body);
    const signature = signZipJsonBody(zipService.signingSecret(), raw);

    const result = webhook.handle(raw, signature, body);
    expect(result.received).toBe(true);
    expect(result.duplicate).toBe(false);
    expect(store.get('zip', 'ord-wh-accept')?.status).toBe('SUCCEEDED');
  });

  it('marks duplicate callbacks as duplicate', () => {
    const created = zipService.createCheckout({
      provider: 'zip',
      productId: 'basic-plan',
      quantity: 1,
      redirectConfirmUrl: 'http://localhost:4200/?ok=1',
      redirectCancelUrl: 'http://localhost:4200/?cancel=1',
    });

    const body = {
      timestamp: '2020-04-27T12:34:56.000000Z',
      merchantId: created.merchantId,
      orderId: 'ord-wh-dup',
      currency: 'USD',
      amount: 29.99,
      merchantReference: created.merchantReference,
      success: true,
    };
    const raw = JSON.stringify(body);
    const signature = signZipJsonBody(zipService.signingSecret(), raw);

    expect(webhook.handle(raw, signature, body).duplicate).toBe(false);
    expect(webhook.handle(raw, signature, body).duplicate).toBe(true);
  });

  it('rejects missing or invalid signatures', () => {
    expect(() => webhook.handle('{}', undefined, {})).toThrow(BadRequestException);
    expect(() => webhook.handle('{}', 'bad', { orderId: 'x', success: true })).toThrow(
      BadRequestException,
    );
  });
});
