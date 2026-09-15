import { IsUUID, IsOptional, IsString, IsDateString } from 'class-validator';

/**
 * Input for booking a `PTSession` against an enrollment (§1).
 *
 * `member_id` is intentionally absent: the session's member is always the
 * enrollment's member, copied server-side so a caller can never book a session
 * for a member who does not own the enrollment.
 *
 * `trainer_id` and `branch_id` are optional overrides for a session led by a
 * substitute trainer or at another branch; both default to the enrollment's
 * trainer (and that trainer's branch) when omitted.
 */
export class BookPtSessionDto {
  @IsUUID()
  enrollment_id!: string;

  @IsUUID()
  @IsOptional()
  trainer_id?: string;

  @IsUUID()
  @IsOptional()
  branch_id?: string;

  @IsDateString()
  scheduled_start!: string;

  @IsDateString()
  scheduled_end!: string;

  @IsString()
  @IsOptional()
  notes?: string;
}