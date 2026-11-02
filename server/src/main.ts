import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import 'reflect-metadata';
import { AppModule } from './app.module';

async function bootstrap() {
  // rawBody: true keeps the exact bytes for Stripe signature verification
  // without disabling JSON parsing for existing payment endpoints.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
  });
  const config = app.get(ConfigService);

  // Bound JSON bodies for payment + webhook endpoints (default Express limit is larger).
  app.useBodyParser('json', { limit: '256kb' });

  // Comma-separated list supported for local DX (localhost + 127.0.0.1).
  // Production typically sets a single https origin.
  const frontendOrigins = (config.get<string>('FRONTEND_ORIGIN')?.trim() || 'http://localhost:4200')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  const corsOrigin = frontendOrigins.length === 1 ? frontendOrigins[0] : frontendOrigins;
  app.enableCors({
    origin: corsOrigin,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Stripe-Signature'],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // Local default 3001 avoids clashing with other apps on 3000. Override via PORT.
  const port = Number(config.get<string>('PORT') ?? 3001);
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`easy-payments demo server listening on http://localhost:${port}`);
  // eslint-disable-next-line no-console
  console.log(`CORS origin: ${frontendOrigins.join(', ')}`);
  // eslint-disable-next-line no-console
  console.log(`Stripe: POST http://localhost:${port}/api/payments/create`);
  // eslint-disable-next-line no-console
  console.log(`PayPal create: POST http://localhost:${port}/api/payments/paypal/create`);
  // eslint-disable-next-line no-console
  console.log(`PayPal capture: POST http://localhost:${port}/api/payments/paypal/capture`);
  // eslint-disable-next-line no-console
  console.log(`Stripe webhook: POST http://localhost:${port}/api/webhooks/stripe`);
  // eslint-disable-next-line no-console
  console.log(`PayPal webhook: POST http://localhost:${port}/api/webhooks/paypal`);
  // eslint-disable-next-line no-console
  console.log(`Catalog: GET http://localhost:${port}/api/catalog/products/:productId`);
}

void bootstrap();
