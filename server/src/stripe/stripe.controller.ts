import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { CreatePaymentIntentDto } from './dto/create-payment-intent.dto';
import { CreateKlarnaPaymentIntentDto } from './dto/create-klarna-payment-intent.dto';
import { CreateAffirmPaymentIntentDto } from './dto/create-affirm-payment-intent.dto';
import { CreateUsBankAccountPaymentIntentDto } from './dto/create-us-bank-account-payment-intent.dto';
import { StripeService } from './stripe.service';

@Controller('api/payments')
export class StripeController {
  constructor(private readonly stripeService: StripeService) {}

  /**
   * Matches the Angular demo createPaymentUrl:
   * POST http://localhost:3000/api/payments/create
   */
  @Post('create')
  @HttpCode(201)
  createPaymentIntent(@Body() body: CreatePaymentIntentDto) {
    return this.stripeService.createPaymentIntent(body);
  }

  /**
   * Klarna via Stripe PaymentIntent:
   * POST http://localhost:3000/api/payments/klarna/create
   */
  @Post('klarna/create')
  @HttpCode(201)
  createKlarnaPaymentIntent(@Body() body: CreateKlarnaPaymentIntentDto) {
    return this.stripeService.createKlarnaPaymentIntent(body);
  }

  /**
   * Affirm via Stripe PaymentIntent:
   * POST http://localhost:3000/api/payments/affirm/create
   */
  @Post('affirm/create')
  @HttpCode(201)
  createAffirmPaymentIntent(@Body() body: CreateAffirmPaymentIntentDto) {
    return this.stripeService.createAffirmPaymentIntent(body);
  }

  /**
   * ACH (US bank account) via Stripe PaymentIntent:
   * POST http://localhost:3000/api/payments/us-bank-account/create
   */
  @Post('us-bank-account/create')
  @HttpCode(201)
  createUsBankAccountPaymentIntent(@Body() body: CreateUsBankAccountPaymentIntentDto) {
    return this.stripeService.createUsBankAccountPaymentIntent(body);
  }
}
