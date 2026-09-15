import { IsOptional, IsUUID, IsEnum } from 'class-validator';
import { TrainerCommissionStatus } from '../entities/trainer-commission-status.enum';

/**
 * Optional filters for listing trainer commissions (always org-scoped).
 *
 * Read-only: Phase 2 exposes no way to write or transition a commission through
 * this or any other endpoint (§12 Q2 addendum).
 */
export class ListTrainerCommissionsDto {
  @IsUUID()
  @IsOptional()
  trainer_id?: string;

  @IsUUID()
  @IsOptional()
  pt_enrollment_id?: string;

  @IsEnum(TrainerCommissionStatus)
  @IsOptional()
  status?: TrainerCommissionStatus;
}