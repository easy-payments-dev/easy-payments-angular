import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CatalogModule } from './catalog/catalog.module';
import { PayPalModule } from './paypal/paypal.module';
import { StripeModule } from './stripe/stripe.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { ZipModule } from './zip/zip.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env'],
    }),
    CatalogModule,
    StripeModule,
    PayPalModule,
    ZipModule,
    WebhooksModule,
  ],
})
export class AppModule {}
