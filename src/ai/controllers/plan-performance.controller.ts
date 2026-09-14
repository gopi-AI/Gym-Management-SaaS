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
import { PlanPerformanceService } from '../services/plan-performance.service';
import { AI_REQUEST_TYPE_PLAN_PERFORMANCE } from '../services/ai.service';
import { AiUsageLimitService } from '../services/ai-usage-limit.service';
import { PlanPerformanceRequestDto } from '../dto/plan-performance-request.dto';
import { PlanPerformanceResponseDto } from '../dto/plan-performance-response.dto';

/**
 * Synchronous, read-only membership-plan performance analysis for one
 * organization.
 *
 * Authorization is layered: the route `orgId` is only a REQUESTED context,
 * `requireOrganizationAccess` resolves the AUTHORIZED organization for the
 * authenticated principal, and `PermissionsGuard` independently enforces
 * `ai:plan-performance`. The authorized id — never the requested one — is
 * propagated to the service layer.
 *
 * Request order is deliberate:
 *   authenticate → authorize organization → authorize AI permission
 *   → rate/token/cost limits → fetch scoped business data → call provider
 * so an over-limit request never reads a dataset and never spends tokens.
 */
@Controller('v1/organizations')
export class PlanPerformanceController {
  private readonly planPerformanceService: PlanPerformanceService;
  private readonly tenantContextService: TenantContextService;
  private readonly aiUsageLimitService: AiUsageLimitService;

  constructor(
    planPerformanceService: PlanPerformanceService,
    tenantContextService: TenantContextService,
    aiUsageLimitService: AiUsageLimitService,
  ) {
    this.planPerformanceService = planPerformanceService;
    this.tenantContextService = tenantContextService;
    this.aiUsageLimitService = aiUsageLimitService;
  }

  @Post(':orgId/ai/plan-performance')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions({ resource: 'ai', action: 'plan-performance' })
  async analyzePlanPerformance(
    @Param('orgId', new ParseUUIDPipe({ version: '4' })) orgId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: PlanPerformanceRequestDto,
  ): Promise<PlanPerformanceResponseDto> {
    const authorizedOrgId = await this.tenantContextService.requireOrganizationAccess(orgId);

    // Limits are enforced on the AUTHORIZED organization, before any business
    // dataset is read and before the provider is called. Over-limit requests
    // are rejected with 429 and never reach the mock or the real provider.
    await this.aiUsageLimitService.assertRequestAllowed({
      organizationId: authorizedOrgId,
      userId: user.userId,
      requestType: AI_REQUEST_TYPE_PLAN_PERFORMANCE,
    });

    return this.planPerformanceService.analyze(authorizedOrgId, user.userId, dto);
  }
}
