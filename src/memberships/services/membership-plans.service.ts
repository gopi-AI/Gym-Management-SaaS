import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { MembershipPlan } from '../entities/membership-plan.entity';
import { CreateMembershipPlanDto } from '../dto/create-membership-plan.dto';
import { UpdateMembershipPlanDto } from '../dto/update-membership-plan.dto';
import { QueryMembershipPlanDto } from '../dto/query-membership-plan.dto';
import { TenantContextService } from '../../shared/tenant/tenant-context.service';

@Injectable()
export class MembershipPlansService {
  constructor(
    @InjectRepository(MembershipPlan)
    private readonly planRepository: Repository<MembershipPlan>,
    private readonly tenantContextService: TenantContextService,
  ) {}

  /**
   * Resolve the authorized organization ID from the tenant context.
   * Follows the same pattern as BranchesService.resolveAuthorizedOrg().
   */
  private async resolveAuthorizedOrg(): Promise<string> {
    const currentOrgId = await this.tenantContextService.getCurrentOrganizationId();
    if (currentOrgId) {
      return currentOrgId;
    }
    const requestedOrgId =
      await this.tenantContextService.getRequestedOrganizationId();
    if (!requestedOrgId) {
      throw new ForbiddenException('Organization context required');
    }
    return this.tenantContextService.requireOrganizationAccess(requestedOrgId);
  }

  async findAll(
    query: QueryMembershipPlanDto,
  ): Promise<{ data: MembershipPlan[]; total: number; page: number; limit: number }> {
    const organizationId = await this.resolveAuthorizedOrg();
    const page = query.page || 1;
    const limit = query.limit || 20;
    const skip = (page - 1) * limit;

    const where: any = {
      organization_id: organizationId,
      deleted_at: IsNull(),
    };
    if (query.is_active !== undefined) {
      where.is_active = query.is_active;
    }

    const [data, total] = await this.planRepository.findAndCount({
      where,
      order: { name: 'ASC' },
      take: limit,
      skip,
    });

    return { data, total, page, limit };
  }

  async findOne(id: string): Promise<MembershipPlan> {
    const organizationId = await this.resolveAuthorizedOrg();
    const plan = await this.planRepository.findOne({
      where: { id, organization_id: organizationId, deleted_at: IsNull() } as any,
    });
    if (!plan) {
      throw new NotFoundException('Membership plan not found');
    }
    return plan;
  }

  async create(dto: CreateMembershipPlanDto): Promise<MembershipPlan> {
    const organizationId = await this.resolveAuthorizedOrg();
    const plan = this.planRepository.create({
      ...dto,
      organization_id: organizationId,
      is_active: true,
    } as any);
    const saved = await this.planRepository.save(plan);
    return Array.isArray(saved) ? saved[0] : saved;
  }

  async update(id: string, dto: UpdateMembershipPlanDto): Promise<MembershipPlan> {
    const organizationId = await this.resolveAuthorizedOrg();
    const plan = await this.planRepository.findOne({
      where: { id, organization_id: organizationId, deleted_at: IsNull() } as any,
    });
    if (!plan) {
      throw new NotFoundException('Membership plan not found');
    }

    await this.planRepository.update(
      { id, organization_id: organizationId },
      dto as any,
    );

    return this.findOne(id);
  }
}