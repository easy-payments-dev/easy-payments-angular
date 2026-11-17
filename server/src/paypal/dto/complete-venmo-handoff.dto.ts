import { IsString, Matches, MaxLength } from 'class-validator';

/**
 * Reconcile Ionic smoke Venmo return: verify attempt↔order binding, then
 * server-side capture when needed (idempotent if already COMPLETED).
 */
export class CompleteVenmoHandoffDto {
  @IsString()
  @MaxLength(64)
  @Matches(/^[a-z0-9]{8,64}$/i, { message: 'attemptId must be 8–64 alphanumeric chars' })
  attemptId!: string;

  @IsString()
  @MaxLength(64)
  @Matches(/^[A-Z0-9-_]+$/i, { message: 'orderId must be a valid PayPal order id' })
  orderId!: string;
}
