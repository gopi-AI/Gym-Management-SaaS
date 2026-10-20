import { NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { BranchSettingsController } from './branch-settings.controller';
import { BranchSettingsService } from '../services/branch-settings.service';
import { TenantContextService } from '../../shared/tenant/tenant-context.service';
import { AuthenticatedUser } from '../../shared/auth/current-user.decorator';
import { Branch } from '../entities/branch.entity';
import { BranchSettings } from '../entities/branch-settings.entity';
import { BranchSettingsHistory } from '../entities/branch-settings-history.entity';
import { TenantSettings } from '../entities/tenant-settings.entity';

/**
 * GET /v1/branches/:id/settings must return the *requested branch's* view:
 * the branch override wins, and only fields without an override fall back to
 * the organization's TenantSettings.
 *
 * Regression guard: the handler used to call getEffective(orgId, null), which
 * skips the branch lookup entirely and returns the org-level values with every
 * `overrides` flag false. The first test below fails on that behaviour.
 *
 * WHAT IS STUBBED, exactly:
 *   - TenantContextService.requireOrganizationAccess (jest.fn resolving ORG_ID)
 *   - the four TypeORM repositories (in-memory fakes that honour the `where`
 *     predicates, so an org/branch mismatch behaves like the real query)
 * WHAT IS REAL: BranchSettingsController and BranchSettingsService, so the
 * org -> branch inheritance is exercised rather than asserted against a stub.
 * DB/Redis/DI-free.
 */

const ORG_ID = '11111111-1111-4111-8111-111111111111';
const BRANCH_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_BRANCH_ID = '33333333-3333-4333-8333-333333333333';

const ORG_SETTINGS = {
  organization_id: ORG_ID,
  time_zone: 'UTC',
  locale: 'en-US',
  currency: 'USD',
};

type BranchSettingsRow = Partial<BranchSettings> & {
  branch_id: string;
  organization_id: string;
};

function build(branchRow: BranchSettingsRow | null) {
  let stored: BranchSettingsRow | null = branchRow;

  const tenantSettingsRepository = {
    findOne: jest.fn(
      async ({ where }: { where: { organization_id: string } }) =>
        where.organization_id === ORG_ID ? ORG_SETTINGS : null,
    ),
  } as unknown as Repository<TenantSettings>;

  // The `where` predicate is enforced, not ignored: a read scoped to another
  // organization returns null, exactly like the real query.
  const branchSettingsRepository = {
    findOne: jest.fn(
      async ({
        where,
      }: {
        where: { branch_id: string; organization_id: string };
      }) => {
        if (!stored) return null;
        return where.branch_id === stored.branch_id &&
          where.organization_id === stored.organization_id
          ? stored
          : null;
      },
    ),
    save: jest.fn(async (row: BranchSettingsRow) => {
      stored = { ...row };
      return stored;
    }),
  } as unknown as Repository<BranchSettings>;

  const branchRepository = {
    findOne: jest.fn(
      async ({
        where,
      }: {
        where: { id: string; organization_id: string; is_active: boolean };
      }) =>
        where.id === BRANCH_ID &&
        where.organization_id === ORG_ID &&
        where.is_active
          ? ({ id: BRANCH_ID, organization_id: ORG_ID, is_active: true } as unknown as Branch)
          : null,
    ),
  } as unknown as Repository<Branch>;

  const historyRepository = {
    save: jest.fn(async (row: unknown) => row),
  } as unknown as Repository<BranchSettingsHistory>;

  const branchSettingsService = new BranchSettingsService(
    branchRepository,
    branchSettingsRepository,
    historyRepository,
    tenantSettingsRepository,
  );

  const tenantContextService = {
    // Mirrors the real contract: the tenant check resolves the AUTHORIZED org.
    requireOrganizationAccess: jest.fn().mockResolvedValue(ORG_ID),
  } as unknown as TenantContextService;

  return {
    controller: new BranchSettingsController(
      branchSettingsService,
      tenantContextService,
    ),
    branchSettingsService,
    requireOrganizationAccess: tenantContextService.requireOrganizationAccess as jest.Mock,
    findBranchSettings: branchSettingsRepository.findOne as jest.Mock,
    findBranch: branchRepository.findOne as jest.Mock,
    saveHistory: historyRepository.save as jest.Mock,
  };
}


describe('BranchSettingsController GET /v1/branches/:id/settings', () => {
  it('returns the requested branch override instead of the organization default', async () => {
    const { controller, findBranchSettings } = build({
      branch_id: BRANCH_ID,
      organization_id: ORG_ID,
      time_zone: 'Asia/Tokyo',
    });

    const result = await controller.getBranchSettings(BRANCH_ID);

    expect(result.effective.time_zone).toBe('Asia/Tokyo');
    expect(result.overrides).toEqual({
      time_zone: true,
      locale: false,
      currency: false,
    });
    // Fields without a branch override still come from the organization.
    expect(result.effective.locale).toBe('en-US');
    expect(result.effective.currency).toBe('USD');
    // The branch lookup only runs when the controller passes the real branch id;
    // with the old `null` it never ran and `effective.time_zone` was 'UTC'.
    expect(findBranchSettings).toHaveBeenCalledWith({
      where: { branch_id: BRANCH_ID, organization_id: ORG_ID },
    });
  });

  it('inherits the organization settings when the branch has no overrides', async () => {
    const { controller } = build(null);

    const result = await controller.getBranchSettings(BRANCH_ID);

    expect(result.effective).toEqual({
      time_zone: 'UTC',
      locale: 'en-US',
      currency: 'USD',
    });
    expect(result.overrides).toEqual({
      time_zone: false,
      locale: false,
      currency: false,
    });
  });

  it('keeps the organization authorization check ahead of the settings read', async () => {
    const { controller, branchSettingsService, requireOrganizationAccess } = build(null);
    const getEffective = jest.spyOn(branchSettingsService, 'getEffective');

    await controller.getBranchSettings(BRANCH_ID);

    expect(requireOrganizationAccess).toHaveBeenCalledTimes(1);
    expect(getEffective).toHaveBeenCalledTimes(1);
    expect(requireOrganizationAccess.mock.invocationCallOrder[0]).toBeLessThan(
      getEffective.mock.invocationCallOrder[0],
    );
  });
});

describe('BranchSettingsController PATCH /v1/branches/:id/settings ownership', () => {
  const user = { userId: 'user-1' } as AuthenticatedUser;

  it('looks the branch up scoped to the authorized organization and audits the write', async () => {
    const { controller, findBranch, saveHistory } = build(null);

    const result = await controller.updateBranchSettings(
      BRANCH_ID,
      { time_zone: 'Asia/Tokyo' },
      user,
    );

    expect(findBranch).toHaveBeenCalledWith({
      where: { id: BRANCH_ID, organization_id: ORG_ID, is_active: true },
    });
    expect(result.effective.time_zone).toBe('Asia/Tokyo');
    expect(saveHistory).toHaveBeenCalledTimes(1);
  });

  it('refuses a branch the authorized organization does not own', async () => {
    const { controller, findBranch, saveHistory } = build(null);

    await expect(
      controller.updateBranchSettings(OTHER_BRANCH_ID, { time_zone: 'Asia/Tokyo' }, user),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(findBranch).toHaveBeenCalledWith({
      where: { id: OTHER_BRANCH_ID, organization_id: ORG_ID, is_active: true },
    });
    expect(saveHistory).not.toHaveBeenCalled();
  });
});
