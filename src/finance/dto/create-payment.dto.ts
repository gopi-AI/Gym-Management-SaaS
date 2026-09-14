import { IsString, IsOptional, IsIn, IsDateString, IsNumber, Min, Length } from 'class-validator';
import { Type } from 'class-transformer';
import { PAYMENT_METHODS } from '../finance.constants';

/**
 * Manual front-desk payment recording (`POST /v1/invoices/{id}/payments`).
 *
 * The server decides the payment `status` (a manual recording is immediately
 * `succeeded`) — a client can never post a status. Gateway integration (Phase 3)
 * will introduce its own initiation endpoint and webhook.
 */
export class CreatePaymentDto {
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount!: number;

  @IsIn(PAYMENT_METHODS as unknown as string[])
  payment_method!: string;

  /** Gateway/provider reference; normally omitted for cash/card at the desk. */
  @IsString()
  @IsOptional()
  @Length(1, 255)
  transaction_id?: string;

  @IsDateString()
  @IsOptional()
  payment_date?: string;

  /**
   * Optional client-supplied idempotency key. Replaying the same key returns
   * the payment recorded by the first request instead of double-charging.
   */
  @IsString()
  @IsOptional()
  @Length(1, 255)
  idempotency_key?: string;
}
