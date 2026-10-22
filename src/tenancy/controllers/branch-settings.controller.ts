import {
  Controller,
  Get,
  Patch,
  Param,
  Body,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { BranchSettingsService, EffectiveSettings, UpdateBranchSettingsDto } from '../services/branch-settings.service';
import { TenantContextService } from '../../shared/tenant/tenant-context.service';
import { RequirePermissions } from '../../shared/auth/permissions.guard';
import { CurrentUser, AuthenticatedUser } from '../../shared/auth/current-user.decorator';

/**
 * GET  /v1/branches/:id/settings
 *   — effective merged settings (branch override wins, else org, else null)
 *
 * PATCH /v1/branches/:id/settings
 *   — upsert + audit. Creates the BranchSettings row on first call if none
 *     exists. Omitted fields are left untouched (PATCH, not PUT).
 *
 * All three fields optional. `null` explicitly means "clear this override back
 * to inherited".
 */
@Controller('v1/branches')
export class BranchSettingsController {
  constructor(
    private readonly branchSettingsService: BranchSettingsService,
    private readonly tenantContextService: TenantContextService,
  ) {}

  @Get(':id/settings')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions({ resource: 'branch-settings', action: 'read' })
  async getBranchSettings(
    @Param('id', new ParseUUIDPipe({ version: '4' })) branchId: string,
  ): Promise<{
    effective: EffectiveSettings;
    overrides: { time_zone: boolean; locale: boolean; currency: boolean };
  }> {
    const authorizedOrgId = await this.tenantContextService.requireOrganizationAccess(
      branchId,
    );
    // org-wide reports (branchId null) have no branch override, so pass null
    // and let getEffective fall through to the org tenant settings.
    const merged = await this.branchSettingsService.getEffective(authorizedOrgId, null);
    return {
      effective: merged.effective,
      overrides: merged.overrides,
    };
  }

  @Patch(':id/settings')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions({ resource: 'branch-settings', action: 'update' })
  async updateBranchSettings(
    @Param('id', new ParseUUIDPipe({ version: '4' })) branchId: string,
    @Body() dto: UpdateBranchSettingsDto,
    @CurrentUser() user: AuthenticatedUser | null,
  ): Promise<{
    effective: EffectiveSettings;
    overrides: { time_zone: boolean; locale: boolean; currency: boolean };
  }> {
    const authorizedOrgId = await this.tenantContextService.requireOrganizationAccess(
      branchId,
    );
    // @CurrentUser() is the canonical user source (changed_by nullable uuid).
    // Fall back to null when no user is attached so the audit row still writes.
    const changedBy = user?.userId ?? null;
    const merged = await this.branchSettingsService.update(
      authorizedOrgId,
      branchId,
      dto,
      changedBy,
    );
    return {
      effective: merged.effective,
      overrides: merged.overrides,
    };
  }
}
