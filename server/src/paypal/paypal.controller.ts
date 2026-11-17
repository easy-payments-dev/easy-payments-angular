import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { CapturePayPalOrderDto } from './dto/capture-paypal-order.dto';
import { CreatePayPalOrderDto } from './dto/create-paypal-order.dto';
import { CreateVenmoHandoffDto } from './dto/create-venmo-handoff.dto';
import { CompleteVenmoHandoffDto } from './dto/complete-venmo-handoff.dto';
import { PayPalOrderStatusDto } from './dto/paypal-order-status.dto';
import { PayPalService } from './paypal.service';

/**
 * Provider-aware PayPal endpoints.
 *
 * Architecture decision (scales to future providers):
 * - Stripe PaymentIntent create stays at POST /api/payments/create
 * - PayPal uses POST /api/payments/paypal/create and .../capture
 * - Each provider keeps a clear create (+ capture when required) surface
 * - Shared trusted catalog lives in catalog/product-catalog.ts
 */
@Controller('api/payments/paypal')
export class PayPalController {
  constructor(private readonly paypalService: PayPalService) {}

  @Post('create')
  @HttpCode(201)
  createOrder(@Body() body: CreatePayPalOrderDto) {
    return this.paypalService.createOrder(body);
  }

  @Post('capture')
  @HttpCode(200)
  captureOrder(@Body() body: CapturePayPalOrderDto) {
    return this.paypalService.captureOrder(body.orderId);
  }

  /** Read-only status for leave-app / App Link verification (does not capture). */
  @Post('status')
  @HttpCode(200)
  getOrderStatus(@Body() body: PayPalOrderStatusDto) {
    return this.paypalService.getOrderStatus(body.orderId);
  }

  /**
   * Ionic smoke Venmo handoff: Orders v2 + payment_source.venmo, catalog pricing,
   * attempt binding. Returns Sandbox link rels; approvalUrl only when PayPal provides one.
   */
  @Post('venmo/handoff')
  @HttpCode(201)
  createVenmoHandoff(@Body() body: CreateVenmoHandoffDto) {
    return this.paypalService.createVenmoHandoff(body);
  }

  /** Reconcile attempt↔order and capture (idempotent when already COMPLETED). */
  @Post('venmo/complete')
  @HttpCode(200)
  completeVenmoHandoff(@Body() body: CompleteVenmoHandoffDto) {
    return this.paypalService.completeVenmoHandoff(body);
  }

  @Get('venmo/attempts/:attemptId')
  getVenmoAttempt(@Param('attemptId') attemptId: string) {
    return this.paypalService.getVenmoAttempt(attemptId);
  }
}
