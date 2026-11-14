import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { CaptureZipOrderDto } from './dto/capture-zip-order.dto';
import { CreateZipCheckoutDto } from './dto/create-zip-checkout.dto';
import { VerifyZipReturnDto } from './dto/verify-zip-return.dto';
import { ZipService } from './zip.service';

/**
 * Zip US Gateway endpoints.
 * Secrets and catalog amounts stay on the server. The create response returns a
 * signed requestBody for `window.quadpay.apiCheckout.openCheckout`.
 */
@Controller('api/payments/zip')
export class ZipController {
  constructor(private readonly zipService: ZipService) {}

  @Post('create')
  @HttpCode(201)
  createCheckout(@Body() body: CreateZipCheckoutDto) {
    return this.zipService.createCheckout(body);
  }

  @Post('verify')
  @HttpCode(200)
  verifyReturn(@Body() body: VerifyZipReturnDto) {
    return this.zipService.verifyReturn(body);
  }

  @Post('capture')
  @HttpCode(200)
  captureOrder(@Body() body: CaptureZipOrderDto) {
    return this.zipService.captureOrder(body);
  }
}
