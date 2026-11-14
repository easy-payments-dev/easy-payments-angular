import { Controller, Headers, HttpCode, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { ZipWebhookService } from './zip-webhook.service';

@Controller('api/webhooks')
export class ZipWebhookController {
  constructor(private readonly zipWebhookService: ZipWebhookService) {}

  /**
   * Zip Gateway callback. Authenticity uses X-QP-Signature HMAC over the raw JSON body.
   */
  @Post('zip')
  @HttpCode(200)
  handleZip(
    @Req() req: Request,
    @Headers('x-qp-signature') signature?: string,
  ) {
    const rawBody =
      typeof (req as Request & { rawBody?: string | Buffer }).rawBody === 'string'
        ? (req as Request & { rawBody: string }).rawBody
        : Buffer.isBuffer((req as Request & { rawBody?: Buffer }).rawBody)
          ? (req as Request & { rawBody: Buffer }).rawBody.toString('utf8')
          : JSON.stringify(req.body ?? {});

    return this.zipWebhookService.handle(rawBody, signature, req.body);
  }
}
