import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Member report for a prescribed workout day.
 *
 * Exercise results are derived server-side from the member's finished sessions
 * for the day, then snapshotted; the client cannot submit arbitrary completion
 * values. `notes` is the only free-text field.
 */
export class SubmitPlanDayDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}
