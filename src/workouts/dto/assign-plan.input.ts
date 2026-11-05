import {
  IsUUID,
  IsString,
  IsOptional,
  IsDateString,
  IsEnum,
  MaxLength,
} from 'class-validator';
import { AssignmentLoggingMode } from '../entities/assignment-logging-mode.enum';

/**
 * Input contract for `WorkoutsService.assignPlan()`.
 *
 * This is the single write path for creating LEGACY flat-template workout plan
 * assignments, used by the PT module. The member-facing trainer API assigns a
 * weekly plan template instead (`CreateAssignmentDto`).
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

  /** PT members use detailed logging; defaults to simple when omitted. */
  @IsOptional()
  @IsEnum(AssignmentLoggingMode)
  loggingMode?: AssignmentLoggingMode;
}