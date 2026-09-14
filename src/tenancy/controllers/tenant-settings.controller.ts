import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Patch,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { TenantSettingsService } from '../services/tenant-settings.service';
import { CreateTenantSettingsDto } from '../dto/create-tenant-settings.dto';
import { UpdateTenantSettingsDto } from '../dto/update-tenant-settings.dto';
import { TenantSettings } from '../entities/tenant-settings.entity';
import { TenantContextService } from '../../shared/tenant/tenant-context.service';
import { RequirePermissions } from '../../shared/auth/permissions.guard';

@Controller('v1/organizations')
export class TenantSettingsController {
  constructor(
    private readonly tenantSettingsService: TenantSettingsService,
    private readonly tenantContextService: TenantContextService,
  ) {}

  @Post(':orgId/tenant-settings')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions({ resource: 'tenant-settings', action: 'create' })
  async createTenantSettings(
    @Param('orgId', new ParseUUIDPipe({ version: '4' })) orgId: string,
    @Body() dto: CreateTenantSettingsDto,
  ): Promise<TenantSettings> {
    // The route orgId is a REQUESTED context, not proof of authorization.
    // requireOrganizationAccess validates an ACTIVE membership and only then
    // establishes the context for this request.
    const authorizedOrgId = await this.tenantContextService.requireOrganizationAccess(orgId);
    // The organization_id in the DTO (if provided) must match the authorized org.
    if (dto.organization_id && dto.organization_id !== authorizedOrgId) {
      throw new BadRequestException('Organization ID mismatch');
    }
    return this.tenantSettingsService.create(authorizedOrgId, {
      time_zone: dto.time_zone,
      locale: dto.locale,
      currency: dto.currency,
    });
  }

  @Get(':orgId/tenant-settings')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions({ resource: 'tenant-settings', action: 'read' })
  async getTenantSettings(
    @Param('orgId', new ParseUUIDPipe({ version: '4' })) orgId: string,
  ): Promise<TenantSettings | null> {
    const authorizedOrgId = await this.tenantContextService.requireOrganizationAccess(orgId);
    return this.tenantSettingsService.findOne(authorizedOrgId);
  }

  @Patch(':orgId/tenant-settings')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions({ resource: 'tenant-settings', action: 'update' })
  async updateTenantSettings(
    @Param('orgId', new ParseUUIDPipe({ version: '4' })) orgId: string,
    @Body() dto: UpdateTenantSettingsDto,
  ): Promise<TenantSettings | null> {
    const authorizedOrgId = await this.tenantContextService.requireOrganizationAccess(orgId);
    // The organization_id in the DTO (if provided) must match the authorized org.
    if (dto.organization_id && dto.organization_id !== authorizedOrgId) {
      throw new BadRequestException('Organization ID mismatch');
    }
    return this.tenantSettingsService.update(authorizedOrgId, {
      time_zone: dto.time_zone,
      locale: dto.locale,
      currency: dto.currency,
    });
  }
}