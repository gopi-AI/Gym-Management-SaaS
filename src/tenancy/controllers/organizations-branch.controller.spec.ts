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
 *   - IdentityService.hasPermission  (jest.fn resolving true/false)
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
      // Mirrors the real contract: returns the authorized orgId it was given.
      requireOrganizationAccess: jest.fn((orgId: string) => Promise.resolve(orgId)),
    } as unknown as TenantContextService;
    return {
      controller: new OrganizationsBranchController(branchesService, tenantContextService),
      branchesService,
      tenantContextService,
    };
  }

  function contextForHandler(
    method: OrgScopedHandler,
    reqUser: { userId: string } | undefined,
  ): ExecutionContext {
    return {
      getHandler: () => OrganizationsBranchController.prototype[method],
      getClass: () => OrganizationsBranchController,
      switchToHttp: () => ({ getRequest: () => ({ user: reqUser }) }),
    } as unknown as ExecutionContext;
  }

  /**
   * Mirrors the runtime pipeline: the global guard resolves first, and only an
   * allowed request reaches the handler body.
   */
  async function throughGuardAndHandler(
    method: OrgScopedHandler,
    deps: ReturnType<typeof buildController>,
    hasPermission: jest.Mock,
    dto?: CreateBranchDto,
  ): Promise<unknown> {
    const guard = new PermissionsGuard(
      new Reflector(),
      { hasPermission } as unknown as IdentityService,
    );
    await guard.canActivate(contextForHandler(method, { userId: 'user-1' }));
    return method === 'createBranchForOrganization'
      ? deps.controller.createBranchForOrganization(ORG_ID, dto as CreateBranchDto)
      : deps.controller.findBranchesByOrganization(ORG_ID);
  }

  it('refuses POST before the handler body when branch:create is missing', async () => {
    const deps = buildController();
    const hasPermission = jest.fn().mockResolvedValue(false);

    await expect(
      throughGuardAndHandler(
        'createBranchForOrganization',
        deps,
        hasPermission,
        { organization_id: ORG_ID, name: 'Downtown', address: '1 Main St', phone: '555' },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(hasPermission).toHaveBeenCalledWith('user-1', 'branch', 'create');
    // The tenant check and the write never ran behind a failed guard.
    expect(deps.tenantContextService.requireOrganizationAccess).not.toHaveBeenCalled();
    expect(deps.branchesService.create).not.toHaveBeenCalled();
  });

  it('refuses GET before the handler body when branch:read is missing', async () => {
    const deps = buildController();
    const hasPermission = jest.fn().mockResolvedValue(false);

    await expect(
      throughGuardAndHandler('findBranchesByOrganization', deps, hasPermission),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(hasPermission).toHaveBeenCalledWith('user-1', 'branch', 'read');
    expect(deps.tenantContextService.requireOrganizationAccess).not.toHaveBeenCalled();
    expect(deps.branchesService.findByOrganization).not.toHaveBeenCalled();
  });

  it('runs POST and still calls requireOrganizationAccess with the route orgId when permitted', async () => {
    const deps = buildController();
    const hasPermission = jest.fn().mockResolvedValue(true);
    const dto = {
      organization_id: ORG_ID,
      name: 'Downtown',
      address: '1 Main St',
      phone: '555',
    } as CreateBranchDto;

    await throughGuardAndHandler('createBranchForOrganization', deps, hasPermission, dto);

    expect(hasPermission).toHaveBeenCalledWith('user-1', 'branch', 'create');
    expect(deps.tenantContextService.requireOrganizationAccess).toHaveBeenCalledWith(ORG_ID);
    expect(deps.branchesService.create).toHaveBeenCalledWith({
      ...dto,
      organization_id: ORG_ID,
    });
  });

  it('runs GET and still calls requireOrganizationAccess with the route orgId when permitted', async () => {
    const deps = buildController();
    const hasPermission = jest.fn().mockResolvedValue(true);

    await throughGuardAndHandler('findBranchesByOrganization', deps, hasPermission);

    expect(hasPermission).toHaveBeenCalledWith('user-1', 'branch', 'read');
    expect(deps.tenantContextService.requireOrganizationAccess).toHaveBeenCalledWith(ORG_ID);
    expect(deps.branchesService.findByOrganization).toHaveBeenCalledWith(ORG_ID);
  });
});
