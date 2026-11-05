import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { PlanDayReviewDecision } from '../entities/plan-day-review-decision.enum';

/**
 * Trainer decision on a prescribed workout day.
 *
 * No completion percentage is required or computed: the trainer is
 * authoritative, and may approve a fully complete, partially complete, or
 * entirely missed day.
 */
export class ReviewPlanDayDto {
  @IsEnum(PlanDayReviewDecision)
  decision!: PlanDayReviewDecision;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  notes?: string;
}
