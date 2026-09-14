import { ForbiddenException, HttpException, HttpStatus } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PERMISSIONS_KEY, RequiredPermission } from '../../shared/auth/permissions.guard';
import { AuthenticatedUser } from '../../shared/auth/current-user.decorator';
import { TenantContextService } from '../../shared/tenant/tenant-context.service';
import { PlanPerformanceController } from './plan-performance.controller';
import { AI_REQUEST_TYPE_PLAN_PERFORMANCE } from '../services/ai.service';
import { AiUsageLimitService } from '../services/ai-usage-limit.service';
import { PlanPerformanceService } from '../services/plan-performance.service';
import { PlanPerformanceRequestDto } from '../dto/plan-performance-request.dto';
import { PlanPerformanceResponseDto } from '../dto/plan-performance-response.dto';

/**
 * Request-order and tenant-scoping tests for the plan-performance endpoint.
 *
 * The JWT/permission guards are global (`APP_GUARD`) and covered by their own
 * specs; this spec pins the contract the controller itself owns:
 *   authorize organization → limits → business data/provider
 */
const REQUESTED_ORG = '99999999-9999-4999-8999-999999999999';
const AUTHORIZED_ORG = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';

const DTO = { period: '90d' } as PlanPerformanceRequestDto;
const USER = { userId: USER_ID } as AuthenticatedUser;
const RESULT = { organization_id: AUTHORIZED_ORG } as PlanPerformanceResponseDto;

describe('PlanPerformanceController', () => {
  let controller: PlanPerformanceController;
  let tenantContextService: Record<string, jest.Mock>;
  let aiUsageLimitService: Record<string, jest.Mock>;
  let planPerformanceService: Record<string, jest.Mock>;
  let order: string[];

  beforeEach(async () => {
    order = [];
    tenantContextService = {
      requireOrganizationAccess: jest.fn(async () => {
        order.push('authorize-organization');
        return AUTHORIZED_ORG;
      }),
    };
    aiUsageLimitService = {
      assertRequestAllowed: jest.fn(async () => {
        order.push('limits');
      }),
    };
    planPerformanceService = {
      analyze: jest.fn(async () => {
        order.push('analyze');
        return RESULT;
      }),
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [PlanPerformanceController],
      providers: [
        { provide: TenantContextService, useValue: tenantContextService },
        { provide: AiUsageLimitService, useValue: aiUsageLimitService },
        { provide: PlanPerformanceService, useValue: planPerformanceService },
      ],
    }).compile();

    controller = moduleRef.get<PlanPerformanceController>(PlanPerformanceController);
  });

  it('still requires the ai:plan-performance permission on the route', () => {
    const required = Reflect.getMetadata(
      PERMISSIONS_KEY,
      PlanPerformanceController.prototype.analyzePlanPerformance,
    ) as RequiredPermission[];

    expect(required).toEqual([{ resource: 'ai', action: 'plan-performance' }]);
  });

  it('checks limits after authorization and before reading data or calling the provider', async () => {
    await controller.analyzePlanPerformance(REQUESTED_ORG, USER, DTO);

    expect(order).toEqual(['authorize-organization', 'limits', 'analyze']);
  });

  it('keys limits and data access on the AUTHORIZED organization, not the requested one', async () => {
    await controller.analyzePlanPerformance(REQUESTED_ORG, USER, DTO);

    expect(aiUsageLimitService.assertRequestAllowed).toHaveBeenCalledWith({
      organizationId: AUTHORIZED_ORG,
      userId: USER_ID,
      requestType: AI_REQUEST_TYPE_PLAN_PERFORMANCE,
    });
    expect(planPerformanceService.analyze).toHaveBeenCalledWith(AUTHORIZED_ORG, USER_ID, DTO);
    expect(JSON.stringify(aiUsageLimitService.assertRequestAllowed.mock.calls)).not.toContain(
      REQUESTED_ORG,
    );
  });

  it('uses an independent rate-limit bucket from the retention use case', async () => {
    await controller.analyzePlanPerformance(REQUESTED_ORG, USER, DTO);

    expect(AI_REQUEST_TYPE_PLAN_PERFORMANCE).not.toBe('retention-analysis');
    expect(aiUsageLimitService.assertRequestAllowed.mock.calls[0][0].requestType).toBe(
      'plan-performance-analysis',
    );
  });

  it('rejects an organization the user is not a member of before any limit accounting', async () => {
    tenantContextService.requireOrganizationAccess.mockRejectedValue(
      new ForbiddenException('Access to this organization is not allowed'),
    );

    await expect(controller.analyzePlanPerformance(REQUESTED_ORG, USER, DTO)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(aiUsageLimitService.assertRequestAllowed).not.toHaveBeenCalled();
    expect(planPerformanceService.analyze).not.toHaveBeenCalled();
  });

  it('propagates a 429 limit rejection and never runs the analysis', async () => {
    const limitError = new HttpException('rate limited', HttpStatus.TOO_MANY_REQUESTS);
    aiUsageLimitService.assertRequestAllowed.mockRejectedValue(limitError);

    await expect(controller.analyzePlanPerformance(REQUESTED_ORG, USER, DTO)).rejects.toBe(
      limitError,
    );
    expect(planPerformanceService.analyze).not.toHaveBeenCalled();
  });

  it('propagates a 503 when the limiter cannot verify the limits (fail closed)', async () => {
    aiUsageLimitService.assertRequestAllowed.mockRejectedValue(
      new HttpException('unavailable', HttpStatus.SERVICE_UNAVAILABLE),
    );

    await expect(controller.analyzePlanPerformance(REQUESTED_ORG, USER, DTO)).rejects.toMatchObject({
      status: HttpStatus.SERVICE_UNAVAILABLE,
    });
    expect(planPerformanceService.analyze).not.toHaveBeenCalled();
  });
});
