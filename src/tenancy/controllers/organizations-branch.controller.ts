import { Controller, Get, Post, Param, ParseUUIDPipe, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { BranchesService } from '../services/branches.service';
import { CreateBranchDto } from '../dto/create-branch.dto';
import { Branch } from '../entities/branch.entity';
import { TenantContextService } from '../../shared/tenant/tenant-context.service';

@Controller('v1/organizations')
export class OrganizationsBranchController {
  constructor(
    private readonly branchesService: BranchesService,
    private readonly tenantContextService: TenantContextService,
  ) {}

  @Post(':orgId/branches')
  @HttpCode(HttpStatus.CREATED)
  async createBranchForOrganization(
    @Param('orgId', new ParseUUIDPipe({ version: '4' })) orgId: string,
    @Body() dto: CreateBranchDto,
  ): Promise<Branch> {
    // Route orgId is a REQUESTED context; requireOrganizationAccess validates
    // the ACTIVE membership before the branch is created in that org.
    const authorizedOrgId = await this.tenantContextService.requireOrganizationAccess(orgId);
    return this.branchesService.create({ ...dto, organization_id: authorizedOrgId });
  }

  @Get(':orgId/branches')
  @HttpCode(HttpStatus.OK)
  async findBranchesByOrganization(
    @Param('orgId', new ParseUUIDPipe({ version: '4' })) orgId: string,
  ): Promise<Branch[]> {
    const authorizedOrgId = await this.tenantContextService.requireOrganizationAccess(orgId);
    return this.branchesService.findByOrganization(authorizedOrgId);
  }
}
