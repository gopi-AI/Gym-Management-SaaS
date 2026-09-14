import { Controller, Get, Post, Patch, Body, Param, ParseUUIDPipe, HttpCode, HttpStatus } from '@nestjs/common';
import { OrganizationsService } from '../services/organizations.service';
import { CreateOrganizationDto } from '../dto/create-organization.dto';
import { UpdateOrganizationDto } from '../dto/update-organization.dto';
import { Organization } from '../entities/organization.entity';
import { RequirePermissions } from '../../shared/auth/permissions.guard';

/**
 * System-level organization administration.
 *
 * These routes manage the global TENANCY_ORGANIZATIONS catalog and are NOT
 * tenant-scoped. They are protected by the global JwtAuthGuard (401 when
 * unauthenticated) and by @RequirePermissions, which is enforced by the global
 * PermissionsGuard via IdentityService.hasPermission() -> user roles ->
 * role permissions -> active IDENTITY_PERMISSIONS(row resource/action).
 *
 * Only roles granted the `organization` permissions below (system/admin) may
 * enumerate, read, create, or modify organizations. Ordinary authenticated
 * tenant members (no `organization:*` permission) receive 403.
 */
@Controller('v1/organizations')
export class OrganizationsController {
  constructor(private readonly organizationsService: OrganizationsService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @RequirePermissions({ resource: 'organization', action: 'read' })
  async findAll(): Promise<Organization[]> {
    return this.organizationsService.findAll();
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions({ resource: 'organization', action: 'read' })
  async findOne(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<Organization | null> {
    return this.organizationsService.findOne(id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions({ resource: 'organization', action: 'create' })
  async create(@Body() dto: CreateOrganizationDto): Promise<Organization> {
    return this.organizationsService.create(dto);
  }

  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions({ resource: 'organization', action: 'update' })
  async update(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: UpdateOrganizationDto,
  ): Promise<Organization | null> {
    return this.organizationsService.update(id, dto);
  }
}