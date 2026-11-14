import { Module } from '@nestjs/common';
import { PayPalModule } from '../paypal/paypal.module';
import { ZipModule } from '../zip/zip.module';
import { PaymentStatusStore } from './payment-status.store';
import { PayPalWebhookController } from './paypal-webhook.controller';
import { PayPalWebhookService } from './paypal-webhook.service';
import { StripeWebhookController } from './stripe-webhook.controller';
import { StripeWebhookService } from './stripe-webhook.service';
import { WebhooksStatusController } from './webhooks.controller';
import { ZipWebhookController } from './zip-webhook.controller';
import { ZipWebhookService } from './zip-webhook.service';

@Module({
  imports: [PayPalModule, ZipModule],
  controllers: [
    StripeWebhookController,
    PayPalWebhookController,
    ZipWebhookController,
    WebhooksStatusController,
  ],
  providers: [
    PaymentStatusStore,
    StripeWebhookService,
    PayPalWebhookService,
    ZipWebhookService,
  ],
  exports: [PaymentStatusStore],
})
export class WebhooksModule {}
