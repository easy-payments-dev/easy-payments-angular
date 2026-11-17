import { IsInt, IsOptional, IsString, IsUrl, Matches, Max, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Ionic smoke Android Venmo handoff — Nest creates Orders v2 with payment_source.venmo.
 * Amount/currency always come from the server catalog.
 */
export class CreateVenmoHandoffDto {
  /** Client checkout attempt id (correlated on App Link return). */
  @IsString()
  @MaxLength(64)
  @Matches(/^[a-z0-9]{8,64}$/i, { message: 'attemptId must be 8–64 alphanumeric chars' })
  attemptId!: string;

  @IsString()
  @MaxLength(128)
  productId!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  quantity?: number;

  /** Documented Venmo experience_context.return_url (HTTPS App Link). */
  @IsUrl({ require_tld: true, protocols: ['https'] })
  @MaxLength(2040)
  returnUrl!: string;

  /** Documented Venmo experience_context.cancel_url (HTTPS App Link). */
  @IsUrl({ require_tld: true, protocols: ['https'] })
  @MaxLength(2040)
  cancelUrl!: string;
}
