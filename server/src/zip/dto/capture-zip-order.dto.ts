import { IsIn, IsNumber, IsOptional, IsString, Matches, MaxLength, Min } from 'class-validator';
import { Type, Transform } from 'class-transformer';

export class CaptureZipOrderDto {
  @IsIn(['zip'])
  provider!: 'zip';

  @IsString()
  @MaxLength(128)
  orderId!: string;

  @IsString()
  @MaxLength(128)
  merchantReference!: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  amount?: number;

  @IsOptional()
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @Matches(/^[A-Z]{3}$/)
  currency?: string;
}
