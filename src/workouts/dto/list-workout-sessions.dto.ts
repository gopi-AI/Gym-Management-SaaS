import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsUUID } from 'class-validator';

/** Session-history filters. Soft-deleted rows are excluded by default. */
export class ListWorkoutSessionsDto {
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  include_deleted?: boolean;

  @IsOptional()
  @IsUUID()
  prescribed_day_id?: string;

  @IsOptional()
  @IsUUID()
  assignment_id?: string;
}
