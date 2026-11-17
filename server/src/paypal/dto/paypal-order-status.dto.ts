import { IsString, Matches, MaxLength } from 'class-validator';

export class PayPalOrderStatusDto {
  /**
   * PayPal order ID returned from create-order / JS SDK createOrder.
   */
  @IsString()
  @MaxLength(64)
  @Matches(/^[A-Z0-9-_]+$/i, { message: 'orderId must be a valid PayPal order id' })
  orderId!: string;
}
