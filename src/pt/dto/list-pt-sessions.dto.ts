import { IsOptional, IsUUID, IsEnum } from 'class-validator';
import { PTSessionStatus } from '../entities/pt-session-status.enum';

/** Optional filters for listing PT sessions (always org-scoped). */
export class ListPtSessionsDto {
  @IsUUID()
  @IsOptional()
  enrollment_id?: string;

  @IsUUID()
  @IsOptional()
  trainer_id?: string;

  @IsUUID()
  @IsOptional()
  member_id?: string;

  @IsEnum(PTSessionStatus)
  @IsOptional()
  status?: PTSessionStatus;
}