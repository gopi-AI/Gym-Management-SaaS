import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, Repository } from 'typeorm';
import { TrainerCommission } from '../entities/trainer-commission.entity';
import { ListTrainerCommissionsDto } from '../dto/list-trainer-commissions.dto';
import { TenantContextService } from '../../shared/tenant/tenant-context.service';

/**
 * READ-ONLY service for `TrainerCommission` rows (Phase 2).
 *
 * Deliberately exposes no create / update / delete:
 *
 * - The single write path is `PtEnrollmentsService.create()` (§12 Q2 — the amount
 *   is computed once, at enrollment creation, and never recalculated).
 * - §12 Q2's addendum forbids any Phase 2 transition of `status`. A write method
 *   here would be exactly the clawback API this task must not build.
 */
@Injectable()
export class TrainerCommissionsService {
  constructor(
    @InjectRepository(TrainerCommission)
    private readonly commissionRepository: Repository<TrainerCommission>,
    private readonly tenantContextService: TenantContextService,
  ) {}

  private async getOrganizationId(): Promise<string> {
    const currentOrgId =
      await this.tenantContextService.getCurrentOrganizationId();
    if (currentOrgId) {
      return currentOrgId;
    }
    const requestedOrgId =
      await this.tenantContextService.getRequestedOrganizationId();
    if (!requestedOrgId) {
      throw new NotFoundException('Organization context not found');
    }
    return this.tenantContextService.requireOrganizationAccess(requestedOrgId);
  }

  /** The single commission row for an enrollment (one row per enrollment). */
  async findByEnrollment(enrollmentId: string): Promise<TrainerCommission> {
    const organizationId = await this.getOrganizationId();
    const commission = await this.commissionRepository.findOne({
      where: {
        pt_enrollment_id: enrollmentId,
        organization_id: organizationId,
      },
    });
    if (!commission) {
      throw new NotFoundException('TrainerCommission not found');
    }
    return commission;
  }

  async findAll(
    query: ListTrainerCommissionsDto,
  ): Promise<TrainerCommission[]> {
    const organizationId = await this.getOrganizationId();
    const where: FindOptionsWhere<TrainerCommission> = {
      organization_id: organizationId,
    };
    if (query.trainer_id) where.trainer_id = query.trainer_id;
    if (query.pt_enrollment_id) where.pt_enrollment_id = query.pt_enrollment_id;
    if (query.status) where.status = query.status;

    return this.commissionRepository.find({
      where,
      order: { earned_at: 'DESC' },
    });
  }
}