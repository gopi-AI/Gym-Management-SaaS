import { Reflector } from '@nestjs/core';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { BranchesController } from './branches.controller';
import { OrganizationsBranchController } from './organizations-branch.controller';
import {
  PERMISSIONS_KEY,
  PermissionsGuard,
  RequiredPermission,
} from '../../shared/auth/permissions.guard';
import { IdentityService } from '../../identity/services/identity.service';
import { BranchesService } from '../services/branches.service';
import { CreateBranchDto } from '../dto/create-branch.dto';
import { Branch } from '../entities/branch.entity';

const ORG_ID = '11111111-1111-4111-8111-111111111111';

const COMPLETE_DTO: CreateBranchDto = {
  organization_id: ORG_ID,
  name: 'Downtown',
  address: '1 Main St',
  phone: '555',
} as CreateBranchDto;

describe('BranchesController authorization metadata', () => {
  const reflector = new Reflector();

  function requiredOnCreate(): RequiredPermission[] | undefined {
    return reflector.getAllAndOverride<RequiredPermission[]>(PERMISSIONS_KEY, [
      BranchesController.prototype.create,
      BranchesController,
    ]);
  }

  function requiredOnOrgCreate(): RequiredPermission[] | undefined {
    return reflector.getAllAndOverride<RequiredPermission[]>(PERMISSIONS_KEY, [
      OrganizationsBranchController.prototype.createBranchForOrganization,
      OrganizationsBranchController,
    ]);
  }

  it('POST /v1/branches requires branch:create', () => {
    expect(requiredOnCreate()).toEqual([
      { resource: 'branch', action: 'create' },
    ]);
  });

  it('matches the org-scoped create sibling metadata exactly', () => {
    expect(requiredOnCreate()).toEqual(requiredOnOrgCreate());
  });
});

describe('PermissionsGuard -> BranchesController (create ordering)', () => {
  function buildController() {
    const branchesService = {
      create: jest.fn().mockResolvedValue({ id: 'branch-1' } as unknown as Branch),
    } as unknown as BranchesService;
    const controller = new BranchesController(branchesService);
    return { branchesService, controller };
  }

  function contextForHandler(
    headers: Record<string, string | undefined> = {},
    params: Record<string, string | undefined> = {},
  ): ExecutionContext {
    return {
      getHandler: () => BranchesController.prototype.create,
      getClass: () => BranchesController,
      switchToHttp: () => ({
        getRequest: () => ({
          user: { userId: 'user-1' },
          headers,
          params,
        }),
      }),
    } as unknown as ExecutionContext;
  }

  /** Mirrors the runtime pipeline: the global guard resolves first, and only an allowed request reaches the handler body. */
  async function throughGuardAndHandler(
    deps: ReturnType<typeof buildController>,
    hasOrganizationPermission: jest.Mock,
    isMember: boolean,
    headers: Record<string, string | undefined> = {},
    params: Record<string, string | undefined> = {},
    dto: CreateBranchDto = COMPLETE_DTO,
  ): Promise<unknown> {
    const identityService = {
      hasOrganizationPermission,
      isUserInOrganization: jest.fn().mockResolvedValue(isMember),
    } as unknown as IdentityService;
    const guard = new PermissionsGuard(new Reflector(), identityService);
    await guard.canActivate(contextForHandler(headers, params));
    return deps.controller.create(dto);
  }

  it('delegates to the service when the authorized org is present and the permission is granted', async () => {
    const deps = buildController();
    const hasOrganizationPermission = jest.fn().mockResolvedValue(true);

    await throughGuardAndHandler(
      deps,
      hasOrganizationPermission,
      true,
      { 'x-organization-id': ORG_ID },
      {},
      COMPLETE_DTO,
    );

    expect(hasOrganizationPermission).toHaveBeenCalledWith(
      'user-1',
      ORG_ID,
      'branch',
      'create',
    );
    expect(deps.branchesService.create).toHaveBeenCalledWith(COMPLETE_DTO);
  });

  it('refuses create before the handler body when branch:create is missing', async () => {
    const deps = buildController();
    const hasOrganizationPermission = jest.fn().mockResolvedValue(false);

    await expect(
      throughGuardAndHandler(
        deps,
        hasOrganizationPermission,
        true,
        { 'x-organization-id': ORG_ID },
        {},
        COMPLETE_DTO,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(hasOrganizationPermission).toHaveBeenCalledWith(
      'user-1',
      ORG_ID,
      'branch',
      'create',
    );
    // The write never ran behind a failed guard.
    expect(deps.branchesService.create).not.toHaveBeenCalled();
  });

  it('denies create with no organization context', async () => {
    const deps = buildController();
    const hasOrganizationPermission = jest.fn().mockResolvedValue(true);

    await expect(
      throughGuardAndHandler(deps, hasOrganizationPermission, true, {}, {}),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(hasOrganizationPermission).not.toHaveBeenCalled();
    expect(deps.branchesService.create).not.toHaveBeenCalled();
  });

  it('denies create when the user is not a member of the selected organization', async () => {
    const deps = buildController();
    const hasOrganizationPermission = jest.fn().mockResolvedValue(true);

    await expect(
      throughGuardAndHandler(
        deps,
        hasOrganizationPermission,
        false,
        { 'x-organization-id': ORG_ID },
        {},
        COMPLETE_DTO,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(hasOrganizationPermission).not.toHaveBeenCalled();
    expect(deps.branchesService.create).not.toHaveBeenCalled();
  });

  it('denies create when the selected organization is inactive (no permission granted)', async () => {
    const deps = buildController();
    const hasOrganizationPermission = jest.fn().mockResolvedValue(false);

    await expect(
      throughGuardAndHandler(
        deps,
        hasOrganizationPermission,
        true,
        { 'x-organization-id': ORG_ID },
        {},
        COMPLETE_DTO,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(hasOrganizationPermission).toHaveBeenCalledWith(
      'user-1',
      ORG_ID,
      'branch',
      'create',
    );
    expect(deps.branchesService.create).not.toHaveBeenCalled();
  });
});
