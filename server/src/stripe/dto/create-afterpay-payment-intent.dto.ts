import {
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';

/**
 * Trusted Afterpay/Clearpay via Stripe PaymentIntent creation.
 * Amount is resolved server-side from the catalog — never trust a client amount.
 * Presentment: USD/CAD/AUD/NZD/GBP with Stripe domestic amount limits.
 */
export class CreateAfterpayPaymentIntentDto {
  @IsIn(['afterpay'])
  provider!: 'afterpay';

  @IsString()
  @MaxLength(128)
  productId!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  quantity!: number;

  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @Matches(/^[A-Z]{3}$/, { message: 'currency must be a 3-letter ISO code (e.g. USD)' })
  currency!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsObject()
  @ValidateIf((_, value) => value !== undefined)
  metadata?: Record<string, string>;
}
