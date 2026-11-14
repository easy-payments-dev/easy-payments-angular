import { IsIn, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

export class VerifyZipReturnDto {
  @IsIn(['zip'])
  provider!: 'zip';

  @IsString()
  @MaxLength(128)
  merchantReference!: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  orderId?: string;

  /** Raw query string from the Zip redirect confirm URL. */
  @IsOptional()
  @IsString()
  @MaxLength(8192)
  returnQuery?: string;

  @IsOptional()
  @IsObject()
  clientResult?: Record<string, unknown>;
}
