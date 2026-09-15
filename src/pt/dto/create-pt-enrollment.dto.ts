import {
  IsUUID,
  IsOptional,
  IsNumber,
  IsDateString,
  Min,
  Max,
} from 'class-validator';

/**
 * Input for creating a `PTEnrollment` (§1 / §12 Q1, Q2).
 *
 * Deliberately contains NO workout template field: the §1 schema has no such
 * column on `PTEnrollment` and the `PTEnrollmentCreated.v1` payload has no
 * template field, so plan assignment is an explicit, separate action
 * (`PtEnrollmentsService.assignWorkoutPlan()`) rather than an implicit effect of
 * enrollment creation.
 */
export class CreatePtEnrollmentDto {
  @IsUUID()
  member_id!: string;

  @IsUUID()
  package_id!: string;

  @IsUUID()
  trainer_id!: string;

  /** Overrides `PTPackage.commission_percent` for this enrollment only. */
  @IsNumber()
  @Min(0)
  @Max(100)
  @IsOptional()
  commission_percent?: number;

  /** Defaults to today (UTC) when omitted. */
  @IsDateString()
  @IsOptional()
  start_date?: string;

  @IsDateString()
  @IsOptional()
  end_date?: string;
}