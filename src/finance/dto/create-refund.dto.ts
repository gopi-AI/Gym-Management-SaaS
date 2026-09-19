import { IsString, IsOptional, IsDateString, IsNumber, Min, Length } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Issue a refund against a payment (`POST /v1/payments/{id}/refunds`).
 *
 * The server decides `status`: in P3-02 a refund is staff-initiated and recorded
 * manually, so it is written directly as `succeeded` (§15 Q5 ruling). A client can
 * never post a status — the same rule `CreatePaymentDto` follows.
 *
 * `amount` is the refunded amount as a number, matching `CreatePaymentDto.amount`.
 * The refund invariant (`SUM(refunds.amount) <= payment.amount`, checked inside
 * the transaction against a row-locked payment) is what makes partial refunds
 * safe: any single refund that would exceed the payment's un-refunded total is
 * rejected, so the cap is the payment itself and no extra cap is needed.
 */
export class CreateRefundDto {
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount!: number;

  /**
   * Why the money was returned. Required, not optional: a refund with no recorded
   * basis is unauditable, and this is the only place the reason is captured.
   */
  @IsString()
  @Length(1, 500)
  reason!: string;

  /** Defaults to now when omitted, matching `payment_date`. */
  @IsDateString()
  @IsOptional()
  refund_date?: string;
}
