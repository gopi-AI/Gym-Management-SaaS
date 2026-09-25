import {
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
} from "class-validator";

/**
 * `POST /v1/leads/{id}/follow-ups` (`docs/api-plan.md` line 84, §8).
 *
 * `follow_up_date` is the date staff should act on the lead. `sla_policy_id` is
 * optional: without it the follow-up carries no SLA deadline to miss, which is
 * what lets staff schedule an ad-hoc reminder that never breaches.
 */
export class CreateFollowUpDto {
  @IsDateString() follow_up_date!: string;
  @IsOptional() @IsUUID() sla_policy_id?: string;
}

/**
 * `POST /v1/follow-ups/{id}/complete`.
 *
 * `outcome` is deliberately NOT optional. §9 names SLA gaming as a scope risk and
 * says the outcome "is the only guard"; an empty completion would let staff clear
 * the due queue with nothing recorded.
 */
export class CompleteFollowUpDto {
  @IsString() @Length(1, 1000) @Matches(/\S/) outcome!: string;
}

/** `GET /v1/follow-ups/due` — due and overdue follow-ups. */
export class ListDueFollowUpsDto {
  /** How far ahead of `now` to look, in hours. 0 = due or already overdue. */
  @IsOptional() @IsInt() @Min(0) @Max(168) withinHours = 0;
  @IsOptional() @IsInt() @Min(1) page = 1;
  @IsOptional() @IsInt() @Min(1) @Max(100) limit = 20;
}
