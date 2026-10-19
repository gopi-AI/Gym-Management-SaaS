import { IsInt, IsString, Length, Max, Min, NotEquals } from 'class-validator';

/**
 * Body for `POST /v1/memberships/:id/extend`.
 *
 * `days` is the SIGNED delta applied to `end_date`: positive extends, negative
 * shortens. It must be non-zero and is capped at ±365 so one call cannot move
 * a membership by an unbounded amount.
 *
 * `idempotency_key` is stored as the history row's `reference_id` (with
 * `reference_type = 'extend'`) and backed by the partial unique index
 * `UQ_membership_history_extend_key`, so a retried request replays the original
 * extension instead of applying twice.
 *
 * Every property is decorated because the global ValidationPipe runs with
 * `whitelist: true` — an undecorated field would be silently dropped.
 */
export class ExtendMembershipDto {
  @IsInt()
  @NotEquals(0)
  @Min(-365)
  @Max(365)
  days!: number;

  @IsString()
  @Length(1, 500)
  reason!: string;

  @IsString()
  @Length(1, 255)
  idempotency_key!: string;
}
