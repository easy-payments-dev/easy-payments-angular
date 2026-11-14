import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ZipService } from '../zip/zip.service';
import { PaymentStatusStore } from './payment-status.store';
import { formatMajorAmount } from '../catalog/product-catalog';

export interface ZipWebhookHandleResult {
  received: true;
  duplicate: boolean;
  ignored: boolean;
  orderId: string;
}

@Injectable()
export class ZipWebhookService {
  private readonly logger = new Logger(ZipWebhookService.name);

  constructor(
    private readonly zipService: ZipService,
    private readonly paymentStatusStore: PaymentStatusStore,
  ) {}

  handle(
    rawBody: string,
    signature: string | undefined,
    body: unknown,
  ): ZipWebhookHandleResult {
    const sig = signature?.trim();
    if (!sig) {
      throw new BadRequestException('Missing X-QP-Signature header.');
    }

    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new BadRequestException('Malformed Zip webhook body.');
    }

    const record = body as Record<string, unknown>;
    const apply = this.zipService.applyWebhook(record, rawBody, sig);

    const amount =
      typeof record['amount'] === 'number'
        ? formatMajorAmount(record['amount'])
        : undefined;
    const currency =
      typeof record['currency'] === 'string' ? record['currency'] : undefined;

    const storeApply = this.paymentStatusStore.apply({
      provider: 'zip',
      eventId: `zip-webhook:${apply.orderId}:${typeof record['timestamp'] === 'string' ? record['timestamp'] : 'na'}`,
      eventType: apply.success ? 'zip.webhook.success' : 'zip.webhook.failure',
      paymentId: apply.orderId,
      status: apply.success ? 'SUCCEEDED' : 'FAILED',
      amount,
      currency,
      orderId: apply.orderId,
    });

    this.logger.log(
      `Zip webhook accepted orderId=${apply.orderId} duplicate=${apply.duplicate || storeApply.duplicate} ignored=${apply.ignored || storeApply.ignored}`,
    );

    return {
      received: true,
      duplicate: apply.duplicate || storeApply.duplicate,
      ignored: apply.ignored || storeApply.ignored,
      orderId: apply.orderId,
    };
  }
}
