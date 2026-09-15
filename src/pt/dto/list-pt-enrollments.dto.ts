import { IsOptional, IsUUID, IsEnum } from 'class-validator';
import { PTEnrollmentStatus } from '../entities/pt-enrollment-status.enum';

/** Optional filters for listing PT enrollments (always org-scoped). */
export class ListPtEnrollmentsDto {
  @IsUUID()
  @IsOptional()
  member_id?: string;

  @IsUUID()
  @IsOptional()
  trainer_id?: string;

  @IsEnum(PTEnrollmentStatus)
  @IsOptional()
  status?: PTEnrollmentStatus;
}