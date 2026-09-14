import { ForbiddenException, HttpException, HttpStatus } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PERMISSIONS_KEY, RequiredPermission } from '../../shared/auth/permissions.guard';
import { AuthenticatedUser } from '../../shared/auth/current-user.decorator';
import { TenantContextService } from '../../shared/tenant/tenant-context.service';
import { RetentionController } from './retention.controller';
import { AI_REQUEST_TYPE_RETENTION } from '../services/ai.service';
import { AiUsageLimitService } from '../services/ai-usage-limit.service';
import { RetentionService } from '../services/retention.service';
import { RetentionAnalysisRequestDto } from '../dto/retention-request.dto';
import { RetentionAnalysisResponseDto } from '../dto/retention-response.dto';

/**
 * Request-order and tenant-scoping tests for the retention endpoint.
 *
 * The JWT/permission guards are global (`APP_GUARD`) and covered by their own
 * specs; this spec pins the contract the controller itself owns:
 *   authorize organization → limits → business data/provider
 */
const REQUESTED_ORG = '99999999-9999-4999-8999-999999999999';
const AUTHORIZED_ORG = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';

const DTO = { period: '90d' } as RetentionAnalysisRequestDto;
const USER = { userId: USER_ID } as AuthenticatedUser;
const RESULT = { organization_id: AUTHORIZED_ORG } as RetentionAnalysisResponseDto;

describe('RetentionController', () => {
  let controller: RetentionController;
  let tenantContextService: Record<string, jest.Mock>;
  let aiUsageLimitService: Record<string, jest.Mock>;
  let retentionService: Record<string, jest.Mock>;
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
    retentionService = {
      analyze: jest.fn(async () => {
        order.push('analyze');
        return RESULT;
      }),
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [RetentionController],
      providers: [
        { provide: TenantContextService, useValue: tenantContextService },
        { provide: AiUsageLimitService, useValue: aiUsageLimitService },
        { provide: RetentionService, useValue: retentionService },
      ],
    }).compile();

    controller = moduleRef.get<RetentionController>(RetentionController);
  });

  it('still requires the ai:retention-analysis permission on the route', () => {
    const required = Reflect.getMetadata(
      PERMISSIONS_KEY,
      RetentionController.prototype.analyzeRetention,
    ) as RequiredPermission[];

    expect(required).toEqual([{ resource: 'ai', action: 'retention-analysis' }]);
  });

  it('checks limits after authorization and before reading data or calling the provider', async () => {
    await controller.analyzeRetention(REQUESTED_ORG, USER, DTO);

    expect(order).toEqual(['authorize-organization', 'limits', 'analyze']);
  });

  it('keys limits and data access on the AUTHORIZED organization, not the requested one', async () => {
    await controller.analyzeRetention(REQUESTED_ORG, USER, DTO);

    expect(aiUsageLimitService.assertRequestAllowed).toHaveBeenCalledWith({
      organizationId: AUTHORIZED_ORG,
      userId: USER_ID,
      requestType: AI_REQUEST_TYPE_RETENTION,
    });
    expect(retentionService.analyze).toHaveBeenCalledWith(AUTHORIZED_ORG, USER_ID, DTO);
    expect(JSON.stringify(aiUsageLimitService.assertRequestAllowed.mock.calls)).not.toContain(
      REQUESTED_ORG,
    );
  });

  it('rejects an organization the user is not a member of before any limit accounting', async () => {
    tenantContextService.requireOrganizationAccess.mockRejectedValue(
      new ForbiddenException('Access to this organization is not allowed'),
    );

    await expect(controller.analyzeRetention(REQUESTED_ORG, USER, DTO)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(aiUsageLimitService.assertRequestAllowed).not.toHaveBeenCalled();
    expect(retentionService.analyze).not.toHaveBeenCalled();
  });

  it('propagates a 429 limit rejection and never runs the analysis', async () => {
    const limitError = new HttpException('rate limited', HttpStatus.TOO_MANY_REQUESTS);
    aiUsageLimitService.assertRequestAllowed.mockRejectedValue(limitError);

    await expect(controller.analyzeRetention(REQUESTED_ORG, USER, DTO)).rejects.toBe(limitError);
    expect(retentionService.analyze).not.toHaveBeenCalled();
  });

  it('propagates a 503 when the limiter cannot verify the limits (fail closed)', async () => {
    aiUsageLimitService.assertRequestAllowed.mockRejectedValue(
      new HttpException('unavailable', HttpStatus.SERVICE_UNAVAILABLE),
    );

    let status: number | undefined;
    await controller.analyzeRetention(REQUESTED_ORG, USER, DTO).catch((error) => {
      status = (error as HttpException).getStatus();
    });

    expect(status).toBe(503);
    expect(retentionService.analyze).not.toHaveBeenCalled();
  });

  it('returns the analysis result for an authorized request', async () => {
    await expect(controller.analyzeRetention(REQUESTED_ORG, USER, DTO)).resolves.toBe(RESULT);
  });
});
