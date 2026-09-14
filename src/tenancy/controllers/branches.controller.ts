import { Controller, Get, Post, Patch, Body, Param, ParseUUIDPipe, HttpCode, HttpStatus } from '@nestjs/common';
import { BranchesService } from '../services/branches.service';
import { CreateBranchDto } from '../dto/create-branch.dto';
import { UpdateBranchDto } from '../dto/update-branch.dto';
import { Branch } from '../entities/branch.entity';
import { RequirePermissions } from '../../shared/auth/permissions.guard';

/**
 * Tenant-scoped branch management.
 *
 * These routes operate within the authenticated user's organization context
 * (enforced by BranchesService via TenantContextService).  The @RequirePermissions
 * decorators add an additional RBAC layer so that only roles granted the
 * `branch:*` permissions may manage branches.  The global JwtAuthGuard ensures
 * the request is authenticated first.
 */
@Controller('v1/branches')
export class BranchesController {
  constructor(private readonly branchesService: BranchesService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @RequirePermissions({ resource: 'branch', action: 'read' })
  async findAll(): Promise<Branch[]> {
    return this.branchesService.findAll();
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions({ resource: 'branch', action: 'read' })
  async findOne(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<Branch | null> {
    return this.branchesService.findOne(id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions({ resource: 'branch', action: 'create' })
  async create(@Body() dto: CreateBranchDto): Promise<Branch> {
    return this.branchesService.create(dto);
  }

  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions({ resource: 'branch', action: 'update' })
  async update(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: UpdateBranchDto,
  ): Promise<Branch | null> {
    return this.branchesService.update(id, dto);
  }
}