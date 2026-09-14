import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { RequirePermissions } from '../../shared/auth/permissions.guard';
import { TenantContextService } from '../../shared/tenant/tenant-context.service';
import { AiUsageService } from '../services/ai-usage.service';
import { AiUsageResponseDto } from '../dto/ai-usage-response.dto';

/**
 * Read-only, organization-scoped AI usage / cost summary for operators.
 *
 * Authorization is layered exactly like the analysis endpoints: the route
 * `orgId` is only a REQUESTED context, `requireOrganizationAccess` resolves the
 * AUTHORIZED organization for the authenticated principal, and `PermissionsGuard`
 * independently enforces `ai:usage-read`. The authorized id — never the
 * requested one — is propagated to the service layer, so one organization can
 * never read another organization's tokens, cost, requests or audit records.
 *
 * The route is `GET`: it has no side effects, does not call the provider and
 * does not consume budget.
 */
@Controller('v1/organizations')
export class AiUsageController {
  private readonly aiUsageService: AiUsageService;
  private readonly tenantContextService: TenantContextService;

  constructor(aiUsageService: AiUsageService, tenantContextService: TenantContextService) {
    this.aiUsageService = aiUsageService;
    this.tenantContextService = tenantContextService;
  }

  @Get(':orgId/ai/usage')
  @RequirePermissions({ resource: 'ai', action: 'usage-read' })
  async getUsage(
    @Param('orgId', new ParseUUIDPipe({ version: '4' })) orgId: string,
  ): Promise<AiUsageResponseDto> {
    const authorizedOrgId = await this.tenantContextService.requireOrganizationAccess(orgId);
    return this.aiUsageService.summarize(authorizedOrgId);
  }
}
