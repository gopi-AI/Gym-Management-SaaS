import { Reflector } from '@nestjs/core';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { OrganizationsBranchController } from './organizations-branch.controller';
import { BranchesController } from './branches.controller';
import {
  PERMISSIONS_KEY,
  PermissionsGuard,
  RequiredPermission,
} from '../../shared/auth/permissions.guard';
import { IdentityService } from '../../identity/services/identity.service';
import { BranchesService } from '../services/branches.service';
import { TenantContextService } from '../../shared/tenant/tenant-context.service';
import { ORGANIZATION_ACCESS_DENIED_MESSAGE } from '../../shared/tenant/tenant-context.service';
import { CreateBranchDto } from '../dto/create-branch.dto';
import { Branch } from '../entities/branch.entity';

/**
 * Org-scoped branch routes: RBAC metadata + guard ordering.
 *
 * These tests are DB/Redis/DI-free. They assert the authorization *metadata*
 * on the four branch handlers exactly as the global PermissionsGuard reads it
 * (Reflect.getMetadata via Reflector), and drive the real PermissionsGuard
 * through the real controller.
 *
 * WHAT IS STUBBED, exactly:
 *   - IdentityService.hasOrganizationPermission (jest.fn resolving true/false)
 *   - TenantContextService.requireOrganizationAccess (jest.fn echoing the org id)
 *   - BranchesService.create / findByOrganization (jest.fn)
 * WHAT IS REAL: PermissionsGuard, Reflector, both controllers and their
 * decorators. A stubbed requireOrganizationAccess still lets us assert it is
 * called with the route orgId — the tenant check is not skipped by RBAC.
 */

const ORG_ID = '11111111-1111-4111-8111-111111111111';

type OrgScopedHandler = 'createBranchForOrganization' | 'findBranchesByOrganization';
type SiblingHandler = keyof Pick<BranchesController, 'findAll' | 'create'>;

describe('OrganizationsBranchController authorization metadata', () => {
  const reflector = new Reflector();

  function requiredOnOrg(method: OrgScopedHandler): RequiredPermission[] | undefined {
    return reflector.getAllAndOverride<RequiredPermission[]>(PERMISSIONS_KEY, [
      OrganizationsBranchController.prototype[method],
      OrganizationsBranchController,
    ]);
  }

  function requiredOnSibling(method: SiblingHandler): RequiredPermission[] | undefined {
    return reflector.getAllAndOverride<RequiredPermission[]>(PERMISSIONS_KEY, [
      BranchesController.prototype[method],
      BranchesController,
    ]);
  }

  it('POST /v1/organizations/:orgId/branches requires branch:create', () => {
    expect(requiredOnOrg('createBranchForOrganization')).toEqual([
      { resource: 'branch', action: 'create' },
    ]);
  });

  it('GET /v1/organizations/:orgId/branches requires branch:read', () => {
    expect(requiredOnOrg('findBranchesByOrganization')).toEqual([
      { resource: 'branch', action: 'read' },
    ]);
  });

  it('the org-scoped pair requires exactly what its /v1/branches sibling requires', () => {
    expect(requiredOnOrg('createBranchForOrganization')).toEqual(
      requiredOnSibling('create'),
    );
    expect(requiredOnOrg('findBranchesByOrganization')).toEqual(
      requiredOnSibling('findAll'),
    );
  });
});

describe('PermissionsGuard -> OrganizationsBranchController (ordering)', () => {
  function buildController() {
    const branchesService = {
      create: jest.fn().mockResolvedValue({ id: 'branch-1' } as unknown as Branch),
      findByOrganization: jest.fn().mockResolvedValue([] as Branch[]),
    } as unknown as BranchesService;
    const tenantContextService = {
      requireOrganizationAccess: jest.fn().mockResolvedValue(ORG_ID),
    } as unknown as TenantContextService;
    const controller = new OrganizationsBranchController(
      branchesService,
      tenantContextService,
    );
    return { branchesService, tenantContextService, controller };
  }

  function contextForHandler(
    method: OrgScopedHandler,
    reqUser: { userId: string } | undefined,
    headers: Record<string, string | undefined> = {},
    params: Record<string, string | undefined> = {},
  ): ExecutionContext {
    return {
      getHandler: () => OrganizationsBranchController.prototype[method],
      getClass: () => OrganizationsBranchController,
      switchToHttp: () => ({ getRequest: () => ({ user: reqUser, headers, params }) }),
    } as unknown as ExecutionContext;
  }

  /** Mirrors the runtime pipeline: the global guard resolves first, and only an allowed request reaches the handler body. */
  async function throughGuardAndHandler(
    method: OrgScopedHandler,
    deps: ReturnType<typeof buildController>,
    hasOrganizationPermission: jest.Mock,
    headers: Record<string, string | undefined> = {},
    params: Record<string, string | undefined> = {},
    dto?: CreateBranchDto,
  ): Promise<unknown> {
    // Membership is granted by default: these tests exercise the RBAC decision
    // for a member, and the guard checks membership before permissions.
    const identityService = {
      hasOrganizationPermission,
      isUserInOrganization: jest.fn().mockResolvedValue(true),
    } as unknown as IdentityService;
    const guard = new PermissionsGuard(new Reflector(), identityService);
    await guard.canActivate(contextForHandler(method, { userId: 'user-1' }, headers, params));
    return method === 'createBranchForOrganization'
      ? deps.controller.createBranchForOrganization(ORG_ID, dto as CreateBranchDto)
      : deps.controller.findBranchesByOrganization(ORG_ID);
  }

  it('refuses POST before the handler body when branch:create is missing', async () => {
    const deps = buildController();
    const hasOrganizationPermission = jest.fn().mockResolvedValue(false);

    await expect(
      throughGuardAndHandler(
        'createBranchForOrganization',
        deps,
        hasOrganizationPermission,
        { 'x-organization-id': ORG_ID },
        {},
        { organization_id: ORG_ID, name: 'Downtown', address: '1 Main St', phone: '555' },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(hasOrganizationPermission).toHaveBeenCalledWith(
      'user-1',
      ORG_ID,
      'branch',
      'create',
    );
    // The tenant check and the write never ran behind a failed guard.
    expect(deps.tenantContextService.requireOrganizationAccess).not.toHaveBeenCalled();
    expect(deps.branchesService.create).not.toHaveBeenCalled();
  });

  it('refuses GET before the handler body when branch:read is missing', async () => {
    const deps = buildController();
    const hasOrganizationPermission = jest.fn().mockResolvedValue(false);

    await expect(
      throughGuardAndHandler('findBranchesByOrganization', deps, hasOrganizationPermission, {
        'x-organization-id': ORG_ID,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(hasOrganizationPermission).toHaveBeenCalledWith(
      'user-1',
      ORG_ID,
      'branch',
      'read',
    );
    expect(deps.tenantContextService.requireOrganizationAccess).not.toHaveBeenCalled();
    expect(deps.branchesService.findByOrganization).not.toHaveBeenCalled();
  });

  it('denies tenant route with no organization context', async () => {
    const deps = buildController();
    const hasOrganizationPermission = jest.fn().mockResolvedValue(true);

    await expect(
      throughGuardAndHandler('findBranchesByOrganization', deps, hasOrganizationPermission, {}),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(hasOrganizationPermission).not.toHaveBeenCalled();
    expect(deps.tenantContextService.requireOrganizationAccess).not.toHaveBeenCalled();
  });

  it('denies tenant route with empty organization context', async () => {
    const deps = buildController();
    const hasOrganizationPermission = jest.fn().mockResolvedValue(true);

    await expect(
      throughGuardAndHandler('findBranchesByOrganization', deps, hasOrganizationPermission, {
        'x-organization-id': '',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(hasOrganizationPermission).not.toHaveBeenCalled();
  });

  it('denies tenant route with whitespace-only organization context', async () => {
    const deps = buildController();
    const hasOrganizationPermission = jest.fn().mockResolvedValue(true);

    await expect(
      throughGuardAndHandler('findBranchesByOrganization', deps, hasOrganizationPermission, {
        'x-organization-id': '   ',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(hasOrganizationPermission).not.toHaveBeenCalled();
  });

  it('denies forged organization ID without membership', async () => {
    const deps = buildController();
    const hasOrganizationPermission = jest.fn().mockResolvedValue(true);
    const isUserInOrganization = jest.fn().mockResolvedValue(false);
    const guard = new PermissionsGuard(
      new Reflector(),
      { hasOrganizationPermission, isUserInOrganization } as unknown as IdentityService,
    );

    let caught: unknown;
    await guard
      .canActivate({
        getHandler: () => OrganizationsBranchController.prototype.findBranchesByOrganization,
        getClass: () => OrganizationsBranchController,
        switchToHttp: () => ({
          getRequest: () => ({
            user: { userId: 'user-1' },
            headers: { 'x-organization-id': 'forged-org-id' },
          }),
        }),
      } as unknown as ExecutionContext)
      .catch((error) => {
        caught = error;
      });

    expect(caught).toBeInstanceOf(ForbiddenException);
    // The tenant-context membership check refuses a non-member first, so the
    // permission path is never consulted for a forged organization id.
    expect((caught as ForbiddenException).message).toBe(ORGANIZATION_ACCESS_DENIED_MESSAGE);
    expect(isUserInOrganization).toHaveBeenCalledWith('user-1', 'forged-org-id');
    expect(hasOrganizationPermission).not.toHaveBeenCalled();
  });

  it('runs POST and still calls requireOrganizationAccess with the route orgId when permitted', async () => {
    const deps = buildController();
    const hasOrganizationPermission = jest.fn().mockResolvedValue(true);
    const dto = {
      organization_id: ORG_ID,
      name: 'Downtown',
      address: '1 Main St',
      phone: '555',
    } as CreateBranchDto;

    await throughGuardAndHandler(
      'createBranchForOrganization',
      deps,
      hasOrganizationPermission,
      { 'x-organization-id': ORG_ID },
      { orgId: ORG_ID },
      dto,
    );

    expect(hasOrganizationPermission).toHaveBeenCalledWith(
      'user-1',
      ORG_ID,
      'branch',
      'create',
    );
    expect(deps.tenantContextService.requireOrganizationAccess).toHaveBeenCalledWith(ORG_ID);
    expect(deps.branchesService.create).toHaveBeenCalledWith({
      ...dto,
      organization_id: ORG_ID,
    });
  });

  it('runs GET and still calls requireOrganizationAccess with the route orgId when permitted', async () => {
    const deps = buildController();
    const hasOrganizationPermission = jest.fn().mockResolvedValue(true);

    await throughGuardAndHandler(
      'findBranchesByOrganization',
      deps,
      hasOrganizationPermission,
      { 'x-organization-id': ORG_ID },
    );

    expect(hasOrganizationPermission).toHaveBeenCalledWith(
      'user-1',
      ORG_ID,
      'branch',
      'read',
    );
    expect(deps.tenantContextService.requireOrganizationAccess).toHaveBeenCalledWith(ORG_ID);
    expect(deps.branchesService.findByOrganization).toHaveBeenCalledWith(ORG_ID);
  });

  // ── B-1: route organization vs header organization mismatch ──
  describe('B-1 — cross-organization authorization bypass', () => {
    const ORG_A = '11111111-1111-4111-8111-111111111111';
    const ORG_B = '22222222-2222-4222-8222-222222222222';

    it('denies POST when header orgId (B) differs from route orgId (A), even if user has permission in B', async () => {
      // User has branch:create in org B but not org A. The mock simulates
      // that: hasOrganizationPermission returns true for org B, false for org A.
      const hasOrganizationPermission = jest.fn().mockImplementation(
        (_userId: string, orgId: string) => orgId === ORG_B,
      );
      const deps = buildController();
      const dto = {
        organization_id: ORG_A,
        name: 'Downtown',
        address: '1 Main St',
        phone: '555',
      } as CreateBranchDto;

      let caught: unknown;
      await throughGuardAndHandler(
        'createBranchForOrganization',
        deps,
        hasOrganizationPermission,
        { 'x-organization-id': ORG_B },
        { orgId: ORG_A },
        dto,
      ).catch((error) => {
        caught = error;
      });

      expect(caught).toBeInstanceOf(ForbiddenException);
      // The mismatch check short-circuits before hasOrganizationPermission:
      // the guard rejects because header (B) != route (A), so the permission
      // check is never reached. This is the B-1 fix — no cross-org bypass.
      expect(hasOrganizationPermission).not.toHaveBeenCalled();
      // The branch creation service must never be called.
      expect(deps.branchesService.create).not.toHaveBeenCalled();
      expect(deps.tenantContextService.requireOrganizationAccess).not.toHaveBeenCalled();
    });

    it('denies GET when header orgId (B) differs from route orgId (A)', async () => {
      const hasOrganizationPermission = jest.fn().mockImplementation(
        (_userId: string, orgId: string) => orgId === ORG_B,
      );
      const deps = buildController();

      let caught: unknown;
      await throughGuardAndHandler(
        'findBranchesByOrganization',
        deps,
        hasOrganizationPermission,
        { 'x-organization-id': ORG_B },
        { orgId: ORG_A },
      ).catch((error) => {
        caught = error;
      });

      expect(caught).toBeInstanceOf(ForbiddenException);
      // The mismatch check short-circuits before hasOrganizationPermission.
      expect(hasOrganizationPermission).not.toHaveBeenCalled();
      expect(deps.branchesService.findByOrganization).not.toHaveBeenCalled();
    });

    it('allows POST when header orgId and route orgId match and user is authorized', async () => {
      const hasOrganizationPermission = jest.fn().mockResolvedValue(true);
      const deps = buildController();
      const dto = {
        organization_id: ORG_A,
        name: 'Downtown',
        address: '1 Main St',
        phone: '555',
      } as CreateBranchDto;

      await throughGuardAndHandler(
        'createBranchForOrganization',
        deps,
        hasOrganizationPermission,
        { 'x-organization-id': ORG_A },
        { orgId: ORG_A },
        dto,
      );

      expect(hasOrganizationPermission).toHaveBeenCalledWith(
        'user-1',
        ORG_A,
        'branch',
        'create',
      );
      expect(deps.branchesService.create).toHaveBeenCalledWith({
        ...dto,
        organization_id: ORG_A,
      });
    });

    it('F. org-scoped create is not redirected by a conflicting body organization', async () => {
      const deps = buildController();
      const hasOrganizationPermission = jest.fn().mockResolvedValue(true);
      const bodyOrg = '22222222-2222-4222-8222-222222222222';
      const dto = {
        organization_id: bodyOrg,
        name: 'Downtown',
        address: '1 Main St',
        phone: '555',
      } as CreateBranchDto;

      const identityService = {
        hasOrganizationPermission,
        isUserInOrganization: jest.fn().mockResolvedValue(true),
      } as unknown as IdentityService;
      const guard = new PermissionsGuard(new Reflector(), identityService);
      const ctx = {
        getHandler: () => OrganizationsBranchController.prototype.createBranchForOrganization,
        getClass: () => OrganizationsBranchController,
        switchToHttp: () => ({
          getRequest: () => ({
            user: { userId: 'user-1' },
            headers: { 'x-organization-id': ORG_ID },
            params: { orgId: ORG_ID },
          }),
        }),
      } as unknown as ExecutionContext;
      await guard.canActivate(ctx);
      await deps.controller.createBranchForOrganization(ORG_ID, dto);

      // The route/authorized org (ORG_ID) is the write target, not the body org.
      expect(deps.branchesService.create).toHaveBeenCalledWith(
        expect.objectContaining({ organization_id: ORG_ID }),
      );
      expect(deps.branchesService.create).not.toHaveBeenCalledWith(
        expect.objectContaining({ organization_id: bodyOrg }),
      );
    });

    it('allows GET when header orgId and route orgId match and user is authorized', async () => {
      const hasOrganizationPermission = jest.fn().mockResolvedValue(true);
      const deps = buildController();

      await throughGuardAndHandler(
        'findBranchesByOrganization',
        deps,
        hasOrganizationPermission,
        { 'x-organization-id': ORG_A },
        { orgId: ORG_A },
      );

      expect(hasOrganizationPermission).toHaveBeenCalledWith(
        'user-1',
        ORG_A,
        'branch',
        'read',
      );
      expect(deps.branchesService.findByOrganization).toHaveBeenCalledWith(ORG_A);
    });

    it('denies POST when no organization context is provided at all', async () => {
      const hasOrganizationPermission = jest.fn().mockResolvedValue(true);
      const deps = buildController();
      const dto = {
        organization_id: ORG_A,
        name: 'Downtown',
        address: '1 Main St',
        phone: '555',
      } as CreateBranchDto;

      let caught: unknown;
      await throughGuardAndHandler(
        'createBranchForOrganization',
        deps,
        hasOrganizationPermission,
        {},
        {},
        dto,
      ).catch((error) => {
        caught = error;
      });

      expect(caught).toBeInstanceOf(ForbiddenException);
      expect(hasOrganizationPermission).not.toHaveBeenCalled();
      expect(deps.branchesService.create).not.toHaveBeenCalled();
    });

    it('denies GET when no organization context is provided at all', async () => {
      const hasOrganizationPermission = jest.fn().mockResolvedValue(true);
      const deps = buildController();

      let caught: unknown;
      await throughGuardAndHandler(
        'findBranchesByOrganization',
        deps,
        hasOrganizationPermission,
        {},
        {},
      ).catch((error) => {
        caught = error;
      });

      expect(caught).toBeInstanceOf(ForbiddenException);
      expect(hasOrganizationPermission).not.toHaveBeenCalled();
      expect(deps.branchesService.findByOrganization).not.toHaveBeenCalled();
    });
  });
});
