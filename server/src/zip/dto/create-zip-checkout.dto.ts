import {
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';

/**
 * Browser may send productId + quantity + redirect URLs.
 * Trusted charge amount is resolved server-side from the product catalog.
 */
export class CreateZipCheckoutDto {
  @IsIn(['zip'])
  provider!: 'zip';

  @IsString()
  @MaxLength(128)
  productId!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  quantity!: number;

  @IsOptional()
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @Matches(/^[A-Z]{3}$/, { message: 'currency must be a 3-letter ISO code (e.g. USD)' })
  currency?: string;

  @IsString()
  @IsUrl({ require_tld: false })
  @MaxLength(2048)
  redirectConfirmUrl!: string;

  @IsString()
  @IsUrl({ require_tld: false })
  @MaxLength(2048)
  redirectCancelUrl!: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, string>;
}
