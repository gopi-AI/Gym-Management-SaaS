import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PERMISSIONS_KEY, RequiredPermission } from '../../shared/auth/permissions.guard';
import { TenantContextService } from '../../shared/tenant/tenant-context.service';
import { AiUsageController } from './ai-usage.controller';
import { AiUsageService } from '../services/ai-usage.service';
import { AiUsageResponseDto } from '../dto/ai-usage-response.dto';

/**
 * Tenant-scoping tests for the operator AI usage endpoint.
 *
 * The JWT/permission guards are global (`APP_GUARD`) and covered by their own
 * specs; this spec pins what the controller itself owns:
 *   authorize organization → aggregate for the AUTHORIZED organization only
 */
const REQUESTED_ORG = '99999999-9999-4999-8999-999999999999';
const AUTHORIZED_ORG = '11111111-1111-4111-8111-111111111111';
const RESULT = { organization_id: AUTHORIZED_ORG } as AiUsageResponseDto;

describe('AiUsageController', () => {
  let controller: AiUsageController;
  let tenantContextService: Record<string, jest.Mock>;
  let aiUsageService: Record<string, jest.Mock>;

  beforeEach(async () => {
    tenantContextService = {
      requireOrganizationAccess: jest.fn(async () => AUTHORIZED_ORG),
    };
    aiUsageService = { summarize: jest.fn(async () => RESULT) };

    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [AiUsageController],
      providers: [
        { provide: TenantContextService, useValue: tenantContextService },
        { provide: AiUsageService, useValue: aiUsageService },
      ],
    }).compile();

    controller = moduleRef.get<AiUsageController>(AiUsageController);
  });

  it('requires the ai:usage-read permission on the route', () => {
    const required = Reflect.getMetadata(
      PERMISSIONS_KEY,
      AiUsageController.prototype.getUsage,
    ) as RequiredPermission[];

    expect(required).toEqual([{ resource: 'ai', action: 'usage-read' }]);
  });

  it('summarizes the AUTHORIZED organization, never the requested one', async () => {
    await controller.getUsage(REQUESTED_ORG);

    expect(tenantContextService.requireOrganizationAccess).toHaveBeenCalledWith(REQUESTED_ORG);
    expect(aiUsageService.summarize).toHaveBeenCalledWith(AUTHORIZED_ORG);
    expect(JSON.stringify(aiUsageService.summarize.mock.calls)).not.toContain(REQUESTED_ORG);
  });

  it('rejects an organization the user is not a member of and reads no usage at all', async () => {
    tenantContextService.requireOrganizationAccess.mockRejectedValue(
      new ForbiddenException('Access to this organization is not allowed'),
    );

    await expect(controller.getUsage(REQUESTED_ORG)).rejects.toBeInstanceOf(ForbiddenException);
    expect(aiUsageService.summarize).not.toHaveBeenCalled();
  });

  it('returns the summary for an authorized organization', async () => {
    await expect(controller.getUsage(REQUESTED_ORG)).resolves.toBe(RESULT);
  });
});
