import {
  IsUUID,
  IsString,
  IsOptional,
  IsDateString,
  MaxLength,
} from 'class-validator';

/**
 * Input contract for `WorkoutsService.assignPlan()`.
 *
 * This is the single write path for creating workout plan assignments,
 * whether called from a future PT enrollment flow or a member-initiated
 * self-assignment. There is deliberately no separate "create assignment"
 * DTO for the API — the controller wraps this same input type.
 */
export class AssignPlanInput {
  @IsUUID()
  memberId!: string;

  @IsUUID()
  templateId!: string;

  @IsString()
  @MaxLength(100)
  assignedBy!: string;

  @IsDateString()
  startDate!: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}