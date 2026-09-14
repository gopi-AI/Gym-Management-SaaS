import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { RequirePermissions } from '../../shared/auth/permissions.guard';
import { CurrentUser, AuthenticatedUser } from '../../shared/auth/current-user.decorator';
import { TenantContextService } from '../../shared/tenant/tenant-context.service';
import { RetentionService } from '../services/retention.service';
import { AI_REQUEST_TYPE_RETENTION } from '../services/ai.service';
import { AiUsageLimitService } from '../services/ai-usage-limit.service';
import { RetentionAnalysisRequestDto } from '../dto/retention-request.dto';
import { RetentionAnalysisResponseDto } from '../dto/retention-response.dto';

/**
 * Synchronous, read-only retention analysis for one organization.
 *
 * Authorization is layered: the route `orgId` is only a REQUESTED context,
 * `requireOrganizationAccess` resolves the AUTHORIZED organization for the
 * authenticated principal, and `PermissionsGuard` independently enforces
 * `ai:retention-analysis`. The authorized id — never the requested one — is
 * propagated to the service layer.
 *
 * Request order is deliberate:
 *   authenticate → authorize organization → authorize AI permission
 *   → rate/token/cost limits → fetch scoped business data → call provider
 * so an over-limit request never reads a dataset and never spends tokens.
 */
@Controller('v1/organizations')
export class RetentionController {
  private readonly retentionService: RetentionService;
  private readonly tenantContextService: TenantContextService;
  private readonly aiUsageLimitService: AiUsageLimitService;

  constructor(
    retentionService: RetentionService,
    tenantContextService: TenantContextService,
    aiUsageLimitService: AiUsageLimitService,
  ) {
    this.retentionService = retentionService;
    this.tenantContextService = tenantContextService;
    this.aiUsageLimitService = aiUsageLimitService;
  }

  @Post(':orgId/ai/retention-analysis')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions({ resource: 'ai', action: 'retention-analysis' })
  async analyzeRetention(
    @Param('orgId', new ParseUUIDPipe({ version: '4' })) orgId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: RetentionAnalysisRequestDto,
  ): Promise<RetentionAnalysisResponseDto> {
    const authorizedOrgId = await this.tenantContextService.requireOrganizationAccess(orgId);

    // Limits are enforced on the AUTHORIZED organization, before any business
    // dataset is read and before the provider is called. Over-limit requests
    // are rejected with 429 and never reach the mock or the real provider.
    await this.aiUsageLimitService.assertRequestAllowed({
      organizationId: authorizedOrgId,
      userId: user.userId,
      requestType: AI_REQUEST_TYPE_RETENTION,
    });

    return this.retentionService.analyze(authorizedOrgId, user.userId, dto);
  }
}
