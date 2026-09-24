import { IsOptional, IsInt, Min, IsUUID, IsIn } from 'class-validator';
import { Type } from 'class-transformer';
import { REFUND_STATUS } from '../finance.constants';

/**
 * Refund search query (`GET /v1/refunds`): page/limit plus org-scoped filters.
 *
 * There is no `invoice_id` filter because `FINANCE_REFUNDS` has no such column —
 * a refund attaches to a payment (§2). Asking for a refund's invoice means asking
 * its payment; `GET /v1/refunds?payment_id=…` is the supported route.
 */
export class QueryRefundDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 20;

  @IsOptional()
  @IsUUID()
  payment_id?: string;

  /**
   * One of `REFUND_STATUS`. `@IsIn` against the constant (rather than free text)
   * so an unknown status is a 400 instead of a silently empty result set — the
   * same treatment `@IsIn(PAYMENT_METHODS)` gives a payment method.
   */
  @IsOptional()
  @IsIn(Object.values(REFUND_STATUS))
  status?: string;
}
