import {
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { AssignmentLoggingMode } from '../entities/assignment-logging-mode.enum';

/**
 * Assign a reusable weekly plan template to the member in the route.
 *
 * The member id comes from the URL, never this body. The template's days and
 * prescriptions are snapshotted at assignment time.
 */
export class CreateAssignmentDto {
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

  /** Trainer picks the logging experience for this member. */
  @IsOptional()
  @IsEnum(AssignmentLoggingMode)
  logging_mode?: AssignmentLoggingMode;
}
