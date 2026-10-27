import { ForbiddenException, NotFoundException, ValidationPipe } from '@nestjs/common';
import { Repository } from 'typeorm';
import { BranchSettingsController } from './branch-settings.controller';
import { BranchSettingsService, UpdateBranchSettingsDto } from '../services/branch-settings.service';
import { BranchesService } from '../services/branches.service';
import { OrganizationsService } from '../services/organizations.service';
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
 *   - TenantContextService (one jest.fn per method; `requireOrganizationAccess`
 *     REJECTS every org the test does not list as a membership, so it cannot be
 *     satisfied by whatever argument it happens to be handed)
 *   - the four TypeORM repositories (in-memory fakes that honour the `where`
 *     predicates, so an org/branch mismatch behaves like the real query)
 * WHAT IS REAL: BranchSettingsController, BranchSettingsService **and
 * BranchesService** — the organization a caller is authorized for is resolved
 * by the production code path (`resolveAuthorizedOrg`), not asserted against a
 * stub that would echo back the branch id it was given. That stub hid the
 * defect this spec now pins: the handler passed the path's branch id to
 * `requireOrganizationAccess` and answered 403 for every legitimate caller
 * while this spec stayed green, because `mockResolvedValue(ORG_ID)` ignored
 * its argument.
 * DB/Redis/DI-free.
 */

const ORG_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_ORG_ID = '66666666-6666-4666-8666-666666666666';
const BRANCH_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_BRANCH_ID = '33333333-3333-4333-8333-333333333333';
const INACTIVE_BRANCH_ID = '55555555-5555-4555-8555-555555555555';

interface BranchRow {
  id: string;
  organization_id: string;
  is_active: boolean;
}

type BranchWhere = Partial<BranchRow>;

/** The rows `branchRepository.findOne` may return, one per ownership case. */
const BRANCHES: BranchRow[] = [
  { id: BRANCH_ID, organization_id: ORG_ID, is_active: true },
  // A perfectly ordinary branch — of the OTHER tenant.
  { id: OTHER_BRANCH_ID, organization_id: OTHER_ORG_ID, is_active: true },
  { id: INACTIVE_BRANCH_ID, organization_id: ORG_ID, is_active: false },
];

/**
 * Mirrors SQL predicate semantics: every predicate PRESENT in `where` must
 * match, an omitted one does not constrain. A fake keyed only on `branch_id`
 * would keep passing even if the production query dropped `organization_id`,
 * so the tenant-isolation mutant would survive; this one kills it.
 */
function matchBranch(where: BranchWhere): BranchRow | null {
  return (
    BRANCHES.find(
      (branch) =>
        (where.id === undefined || branch.id === where.id) &&
        (where.organization_id === undefined ||
          branch.organization_id === where.organization_id) &&
        (where.is_active === undefined || branch.is_active === where.is_active),
    ) ?? null
  );
}

const ORG_SETTINGS = {
  organization_id: ORG_ID,
  time_zone: 'UTC',
  locale: 'en-US',
  currency: 'USD',
};

type BranchSettingsRow = Partial<BranchSettings> & {
  id?: string;
  branch_id: string;
  organization_id: string;
};

function build(
  branchRow: BranchSettingsRow | null,
  options: { requestedOrgId?: string | null; memberOf?: string[] } = {},
) {
  // `null` models a request that carries no organization context at all; the
  // default models the ordinary case of a membership-plus-header request.
  const requestedOrgId =
    options.requestedOrgId === undefined ? ORG_ID : options.requestedOrgId;
  const memberOf = options.memberOf ?? [ORG_ID];
  // Use a Map to track rows by (branch_id, organization_id) so the fake
  // distinguishes INSERT (no id) from UPDATE (id matches existing row).
  const rows = new Map<string, BranchSettingsRow>();
  if (branchRow) {
    const key = `${branchRow.branch_id}:${branchRow.organization_id}`;
    rows.set(key, { ...branchRow, id: branchRow.id ?? 'existing-id' });
  }

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
        const key = `${where.branch_id}:${where.organization_id}`;
        return rows.get(key) ?? null;
      },
    ),
    save: jest.fn(async (row: BranchSettingsRow) => {
      const key = `${row.branch_id}:${row.organization_id}`;
      const existing = rows.get(key);
      if (existing && row.id && row.id === existing.id) {
        // UPDATE: same id → overwrite
        const updated = { ...existing, ...row };
        rows.set(key, updated);
        return updated;
      }
      // INSERT: new row (even if row exists but id doesn't match or is missing)
      // This mimics TypeORM behavior: save() without id always inserts
      const inserted = { ...row, id: row.id ?? `new-id-${Date.now()}` };
      rows.set(key, inserted);
      return inserted;
    }),
  } as unknown as Repository<BranchSettings>;

  // Enforces the `where` predicate like the real query, including a predicate
  // the production code might DROP: `matchBranch` treats an omitted key as
  // unconstrained, exactly as SQL does, so removing `organization_id` from the
  // production lookup makes the cross-tenant test return a row instead of 404.
  const branchRepository = {
    findOne: jest.fn(async ({ where }: { where: BranchWhere }) =>
      matchBranch(where),
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
    // On the way in, nothing has authorized an org yet: `getCurrentOrganizationId`
    // is only ever set BY `requireOrganizationAccess`, which is why the first
    // branch of `resolveAuthorizedOrg` cannot short-circuit the real request.
    getCurrentOrganizationId: jest.fn().mockResolvedValue(null),
    getRequestedOrganizationId: jest.fn().mockResolvedValue(requestedOrgId),
    // Argument-sensitive by construction: only a listed membership is accepted
    // and the argument is echoed back, so a caller that passed the path's BRANCH
    // id here would be rejected with 403 instead of silently authorized.
    requireOrganizationAccess: jest.fn(async (orgId: string) => {
      if (!memberOf.includes(orgId)) {
        throw new ForbiddenException(
          'Access to this organization is not allowed',
        );
      }
      return orgId;
    }),
  } as unknown as TenantContextService;

  // The real resolver: `resolveAuthorizedOrg` runs in the spec, not as a stub.
  const branchesService = new BranchesService(
    branchRepository,
    { findOne: jest.fn() } as unknown as OrganizationsService,
    tenantContextService,
  );

  return {
    controller: new BranchSettingsController(
      branchSettingsService,
      branchesService,
    ),
    branchSettingsService,
    branchesService,
    requireOrganizationAccess: tenantContextService.requireOrganizationAccess as jest.Mock,
    getRequestedOrganizationId: tenantContextService.getRequestedOrganizationId as jest.Mock,
    findBranchSettings: branchSettingsRepository.findOne as jest.Mock,
    findBranch: branchRepository.findOne as jest.Mock,
    saveBranchSettings: branchSettingsRepository.save as jest.Mock,
    saveHistory: historyRepository.save as jest.Mock,
    // Expose rows map for assertions on row count
    getRows: () => rows,
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

describe('BranchSettingsController GET authorization (branch ID is not an organization ID)', () => {
  it('GET authorizes the resolved ORGANIZATION and never offers the branch id', async () => {
    const {
      controller,
      branchSettingsService,
      requireOrganizationAccess,
      getRequestedOrganizationId,
    } = build(null);
    const getEffective = jest.spyOn(branchSettingsService, 'getEffective');

    await controller.getBranchSettings(BRANCH_ID);

    expect(getRequestedOrganizationId).toHaveBeenCalledTimes(1);
    expect(requireOrganizationAccess).toHaveBeenCalledTimes(1);
    expect(requireOrganizationAccess).toHaveBeenCalledWith(ORG_ID);
    // The regression itself: a branch id is not an organization id.
    expect(requireOrganizationAccess).not.toHaveBeenCalledWith(BRANCH_ID);
    expect(getEffective).toHaveBeenCalledWith(ORG_ID, BRANCH_ID);
  });

  it('GET answers 403 and never reads settings when no organization is requested', async () => {
    const { controller, branchSettingsService, requireOrganizationAccess } =
      build(null, { requestedOrgId: null });
    const getEffective = jest.spyOn(branchSettingsService, 'getEffective');

    const promise = controller.getBranchSettings(BRANCH_ID);
    await expect(promise).rejects.toBeInstanceOf(ForbiddenException);
    await expect(promise).rejects.toThrow('Organization context required');

    expect(requireOrganizationAccess).not.toHaveBeenCalled();
    expect(getEffective).not.toHaveBeenCalled();
  });

  it('GET answers 403 and never reads settings when the user is not a member of the requested org', async () => {
    // A real organization — just not one this user belongs to. This is the value
    // this route used to substitute a branch id for.
    const { controller, branchSettingsService, requireOrganizationAccess } =
      build(null, { requestedOrgId: OTHER_ORG_ID });
    const getEffective = jest.spyOn(branchSettingsService, 'getEffective');

    await expect(controller.getBranchSettings(BRANCH_ID)).rejects.toThrow(
      'Access to this organization is not allowed',
    );

    expect(requireOrganizationAccess).toHaveBeenCalledWith(OTHER_ORG_ID);
    expect(getEffective).not.toHaveBeenCalled();
  });

  it('GET answers 404 for a branch owned by another organization', async () => {
    const { controller, findBranch, findBranchSettings } = build(null);

    await expect(
      controller.getBranchSettings(OTHER_BRANCH_ID),
    ).rejects.toBeInstanceOf(NotFoundException);

    // Same predicate and answer as PATCH: org-scoped, active-only.
    expect(findBranch).toHaveBeenCalledWith({
      where: { id: OTHER_BRANCH_ID, organization_id: ORG_ID, is_active: true },
    });
    expect(findBranchSettings).not.toHaveBeenCalled();
  });

  it('GET answers 404 for an inactive branch and for one that does not exist', async () => {
    const { controller } = build(null);

    await expect(
      controller.getBranchSettings(INACTIVE_BRANCH_ID),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      controller.getBranchSettings('77777777-7777-4777-8777-777777777777'),
    ).rejects.toBeInstanceOf(NotFoundException);
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
  it('PATCH authorizes the resolved ORGANIZATION and never offers the branch id', async () => {
    const { controller, branchSettingsService, requireOrganizationAccess } =
      build(null);
    const update = jest.spyOn(branchSettingsService, 'update');

    await controller.updateBranchSettings(
      BRANCH_ID,
      { locale: 'ja-JP' },
      user,
    );

    expect(requireOrganizationAccess).toHaveBeenCalledTimes(1);
    expect(requireOrganizationAccess).toHaveBeenCalledWith(ORG_ID);
    // Regression: the path id is a branch, so it must never be offered as
    // the organization to authorize.
    expect(requireOrganizationAccess).not.toHaveBeenCalledWith(BRANCH_ID);
    expect(update).toHaveBeenCalledWith(ORG_ID, BRANCH_ID, { locale: 'ja-JP' }, 'user-1');
  });

  it('PATCH answers 403 and writes nothing when there is no organization context', async () => {
    const { controller, branchSettingsService, saveBranchSettings, saveHistory } =
      build(null, { requestedOrgId: null });
    const update = jest.spyOn(branchSettingsService, 'update');

    const promise = controller.updateBranchSettings(
      BRANCH_ID,
      { locale: 'ja-JP' },
      user,
    );
    await expect(promise).rejects.toBeInstanceOf(ForbiddenException);
    await expect(promise).rejects.toThrow('Organization context required');

    // Proof the write path is unreachable, not merely unsuccessful.
    expect(update).not.toHaveBeenCalled();
    expect(saveBranchSettings).not.toHaveBeenCalled();
    expect(saveHistory).not.toHaveBeenCalled();
  });

  it('PATCH answers 404 for another tenant branch and writes nothing', async () => {
    const { controller, saveBranchSettings, saveHistory } = build(null);

    const promise = controller.updateBranchSettings(
      OTHER_BRANCH_ID,
      { locale: 'ja-JP' },
      user,
    );
    await expect(promise).rejects.toBeInstanceOf(NotFoundException);
    await expect(promise).rejects.toThrow(
      'Branch not found or not owned by organization',
    );

    expect(saveBranchSettings).not.toHaveBeenCalled();
    expect(saveHistory).not.toHaveBeenCalled();
  });

  it('PATCH answers 404 for an inactive branch of the authorized organization', async () => {
    const { controller, saveBranchSettings, saveHistory } = build(null);

    await expect(
      controller.updateBranchSettings(
        INACTIVE_BRANCH_ID,
        { locale: 'ja-JP' },
        user,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(saveBranchSettings).not.toHaveBeenCalled();
    expect(saveHistory).not.toHaveBeenCalled();
  });

});

describe('BranchSettingsController PATCH /v1/branches/:id/settings upsert semantics', () => {
  const user = { userId: 'user-1' } as AuthenticatedUser;

  it('two sequential PATCH calls to the same branch produce exactly one row (update, not insert)', async () => {
    const { controller, getRows } = build(null);

    // First PATCH - creates the row
    await controller.updateBranchSettings(BRANCH_ID, { time_zone: 'Asia/Tokyo' }, user);
    // Second PATCH - should update the same row, not insert a new one
    await controller.updateBranchSettings(BRANCH_ID, { locale: 'ja-JP' }, user);

    const rows = getRows();
    expect(rows.size).toBe(1);
    const row = rows.get(`${BRANCH_ID}:${ORG_ID}`);
    expect(row).toBeDefined();
    expect(row?.time_zone).toBe('Asia/Tokyo');
    expect(row?.locale).toBe('ja-JP');
    expect(row?.currency).toBeUndefined();
  });
});

describe('ValidationPipe integration for UpdateBranchSettingsDto (Fix 1)', () => {
  it('preserves decorated DTO properties through ValidationPipe with whitelist: true', async () => {
    const pipe = new ValidationPipe({ whitelist: true, transform: true });
    const result = await pipe.transform(
      { time_zone: 'Asia/Tokyo' },
      { type: 'body', metatype: UpdateBranchSettingsDto },
    );
    expect(result.time_zone).toBe('Asia/Tokyo');
    expect(result.locale).toBeUndefined();
    expect(result.currency).toBeUndefined();
  });

  it('allows explicit null to clear an override', async () => {
    const pipe = new ValidationPipe({ whitelist: true, transform: true });
    const result = await pipe.transform(
      { time_zone: null, locale: 'en-US' },
      { type: 'body', metatype: UpdateBranchSettingsDto },
    );
    expect(result.time_zone).toBeNull();
    expect(result.locale).toBe('en-US');
  });

  it('strips unknown properties', async () => {
    const pipe = new ValidationPipe({ whitelist: true, transform: true });
    const result = await pipe.transform(
      { time_zone: 'Asia/Tokyo', unknown_field: 'should be stripped' },
      { type: 'body', metatype: UpdateBranchSettingsDto },
    );
    expect(result.time_zone).toBe('Asia/Tokyo');
    expect((result as Record<string, unknown>).unknown_field).toBeUndefined();
  });
});

describe('BranchSettingsService getEffective overrides flags (Fix 3)', () => {
  it('reports overrides: true only for non-null fields when branch row has explicit nulls', async () => {
    const { branchSettingsService } = build({
      branch_id: BRANCH_ID,
      organization_id: ORG_ID,
      time_zone: 'Asia/Tokyo',
      locale: null,
      currency: null,
    });

    const result = await branchSettingsService.getEffective(ORG_ID, BRANCH_ID);

    expect(result.overrides).toEqual({
      time_zone: true,
      locale: false,
      currency: false,
    });
    // Effective values should still merge correctly
    expect(result.effective.time_zone).toBe('Asia/Tokyo');
    expect(result.effective.locale).toBe('en-US'); // from org settings
    expect(result.effective.currency).toBe('USD'); // from org settings
  });

  it('reports all overrides false when the branch has no settings row', async () => {
    const { branchSettingsService } = build(null);

    const result = await branchSettingsService.getEffective(ORG_ID, BRANCH_ID);

    expect(result.overrides).toEqual({
      time_zone: false,
      locale: false,
      currency: false,
    });
  });
});
