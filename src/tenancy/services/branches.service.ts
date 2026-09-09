import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Branch } from '../entities/branch.entity';
import { CreateBranchDto } from '../dto/create-branch.dto';
import { UpdateBranchDto } from '../dto/update-branch.dto';
import { OrganizationsService } from './organizations.service';
import { TenantContextService } from '../../shared/tenant/tenant-context.service';

@Injectable()
export class BranchesService {
  constructor(
    @InjectRepository(Branch)
    private readonly branchRepository: Repository<Branch>,
    private readonly organizationsService: OrganizationsService,
    private readonly tenantContextService: TenantContextService,
  ) {}

  /**
   * Determine the organization for the current request:
   *   1. If an org context was already authorized, use it.
   *   2. Otherwise use the requested org (route/header), which is still
   *      validated against ACTIVE membership before being accepted.
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

  async findAll(): Promise<Branch[]> {
    const orgId = await this.resolveAuthorizedOrg();
    return this.branchRepository.find({
      where: { organization_id: orgId, is_active: true },
      order: { name: 'ASC' },
    });
  }

  async findByOrganization(organizationId: string): Promise<Branch[]> {
    const orgId =
      await this.tenantContextService.requireOrganizationAccess(organizationId);
    return this.branchRepository.find({
      where: { organization_id: orgId, is_active: true },
      order: { name: 'ASC' },
    });
  }

  async findOne(id: string): Promise<Branch | null> {
    const orgId = await this.resolveAuthorizedOrg();
    return this.branchRepository.findOne({
      where: { id, organization_id: orgId, is_active: true },
    });
  }

  async create(dto: CreateBranchDto): Promise<Branch> {
    // The client-supplied organization_id is only a REQUESTED context. Validate
    // membership; the branch is created under the AUTHORIZED org only.
    const orgId =
      await this.tenantContextService.requireOrganizationAccess(dto.organization_id);

    // Validate organization exists
    await this.organizationsService.findOne(orgId);

    const branch = this.branchRepository.create({
      ...dto,
      organization_id: orgId,
      is_active: dto.is_active ?? true,
    });
    return this.branchRepository.save(branch);
  }

  async update(id: string, dto: UpdateBranchDto): Promise<Branch | null> {
    const orgId = await this.resolveAuthorizedOrg();

    // Ownership check BEFORE update: the target branch must belong to the
    // authorized organization. Never update by id alone.
    const branch = await this.branchRepository.findOne({
      where: { id, organization_id: orgId, is_active: true },
    });
    if (!branch) {
      throw new NotFoundException('Branch not found');
    }

    // An organization move is not permitted via this flow.
    if (dto.organization_id && dto.organization_id !== orgId) {
      throw new BadRequestException('Cannot change branch organization');
    }

    const { organization_id: _ignored, ...updates } = dto;
    await this.branchRepository.update(
      { id, organization_id: orgId },
      updates,
    );
    return this.findOne(id);
  }

  async remove(id: string): Promise<void> {
    const orgId = await this.resolveAuthorizedOrg();
    const result = await this.branchRepository.update(
      { id, organization_id: orgId, is_active: true },
      { is_active: false },
    );
    if (result.affected === 0) {
      throw new NotFoundException('Branch not found');
    }
  }
}