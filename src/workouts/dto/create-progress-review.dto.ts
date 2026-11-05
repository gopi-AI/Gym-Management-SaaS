import { Type } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { AssignmentLoggingMode } from '../entities/assignment-logging-mode.enum';
import { ProgressReviewDecision } from '../entities/progress-review-decision.enum';

/** Optional next assignment created atomically with the review. */
export class NextAssignmentInputDto {
  @IsUUID()
  plan_template_id!: string;

  @IsDateString()
  start_date!: string;

  @IsOptional()
  @IsDateString()
  end_date?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @IsOptional()
  @IsEnum(AssignmentLoggingMode)
  logging_mode?: AssignmentLoggingMode;
}

/**
 * Record a trainer-led workout progress review.
 *
 * `measurement_ids` reference EXISTING `MEMBERS_MEMBER_MEASUREMENTS` rows; the
 * review stores a snapshot of the values used, never a second measurement
 * store. `next_assignment` is optional and, when present, is created in the
 * same transaction and linked from the review.
 */
export class CreateProgressReviewDto {
  @IsUUID()
  assignment_id!: string;

  @IsDateString()
  review_date!: string;

  @IsDateString()
  period_start!: string;

  @IsDateString()
  period_end!: string;

  @IsEnum(ProgressReviewDecision)
  decision!: ProgressReviewDecision;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  results?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  fitness_improvements?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  goal_assessment?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  observations?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  recommendations?: string;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  measurement_ids?: string[];

  @IsOptional()
  @ValidateNested()
  @Type(() => NextAssignmentInputDto)
  next_assignment?: NextAssignmentInputDto;
}
