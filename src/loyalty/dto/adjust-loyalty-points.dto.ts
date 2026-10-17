import { IsInt, IsString, Length, Max, Min, NotEquals } from 'class-validator';

/**
 * Body for `POST /v1/members/:memberId/points/adjust`.
 *
 * `points` is the SIGNED delta: positive credits the member, negative debits
 * them. It must be non-zero and is capped at ±100,000 so a single manual
 * adjustment cannot inflate or drain a balance by an unbounded amount.
 *
 * `idempotency_key` is required: it is stored as the transaction's
 * `reference_id` (with `reference_type = 'admin_adjust'`) and backed by a
 * partial unique index, so a retried request replays the original transaction
 * instead of applying twice.
 *
 * Every property is decorated because the global ValidationPipe runs with
 * `whitelist: true` — an undecorated field would be silently dropped.
 */
export class AdjustLoyaltyPointsDto {
  @IsInt()
  @NotEquals(0)
  @Min(-100000)
  @Max(100000)
  points!: number;

  @IsString()
  @Length(1, 500)
  reason!: string;

  @IsString()
  @Length(1, 255)
  idempotency_key!: string;
}
