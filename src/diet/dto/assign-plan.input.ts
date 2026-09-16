import {
  IsUUID,
  IsString,
  IsOptional,
  IsDateString,
  MaxLength,
} from 'class-validator';

/**
 * Input contract for `DietService.assignPlan()`.
 *
 * Single write path for `DietPlanAssignment` (mirrors Workouts' `AssignPlanInput`).
 */
export class AssignPlanInput {
  @IsUUID()
  memberId!: string;

  @IsUUID()
  dietPlanId!: string;

  @IsString()
  @MaxLength(100)
  assignedBy!: string;

  @IsDateString()
  startDate!: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;
}
