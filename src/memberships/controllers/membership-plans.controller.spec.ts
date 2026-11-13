import { Reflector } from '@nestjs/core';
import { ForbiddenException } from '@nestjs/common';
import { MembershipPlansController } from './membership-plans.controller';
import {
  PERMISSIONS_KEY,
  PermissionsGuard,
  RequiredPermission,
} from '../../shared/auth/permissions.guard';
import { IdentityService } from '../../identity/services/identity.service';

const ORG_ID = '44444444-4444-4444-8444-444444444444';

describe('MembershipPlansController authorization metadata', () => {
  const reflector = new Reflector();

  function requiredOn(
    method: 'findAll' | 'findOne' | 'create' | 'update',
  ): RequiredPermission[] | undefined {
    return reflector.getAllAndOverride<RequiredPermission[]>(PERMISSIONS_KEY, [
      MembershipPlansController.prototype[method],
      MembershipPlansController,
    ]);
  }

  it('GET /v1/membership-plans requires membership-plan:read', () => {
    expect(requiredOn('findAll')).toEqual([{ resource: 'membership-plan', action: 'read' }]);
  });

  it('GET /v1/membership-plans/:id requires membership-plan:read', () => {
    expect(requiredOn('findOne')).toEqual([{ resource: 'membership-plan', action: 'read' }]);
  });

  it('POST /v1/membership-plans requires membership-plan:create', () => {
    expect(requiredOn('create')).toEqual([{ resource: 'membership-plan', action: 'create' }]);
  });

  it('PATCH /v1/membership-plans/:id requires membership-plan:update', () => {
    expect(requiredOn('update')).toEqual([{ resource: 'membership-plan', action: 'update' }]);
  });
});

describe('PermissionsGuard -> MembershipPlan permissions', () => {
  function buildGuard(identityService: Partial<IdentityService>): PermissionsGuard {
    return new PermissionsGuard(
      new Reflector(),
      identityService as IdentityService,
    );
  }

  function contextForHandler(
    method: 'findAll' | 'findOne' | 'create' | 'update',
    reqUser: { userId: string } | undefined,
  ): any {
    return {
      getHandler: () => MembershipPlansController.prototype[method],
      getClass: () => MembershipPlansController,
      switchToHttp: () => ({
        getRequest: () => ({
          user: reqUser,
          // These routes carry no :orgId segment, so the tenant context arrives
          // as the X-Organization-Id header exactly as it does at runtime.
          headers: { 'x-organization-id': ORG_ID },
          params: {},
        }),
      }),
    };
  }

  it('passes when hasOrganizationPermission(id, org, membership-plan, read) resolves true', async () => {
    const identityService: Partial<IdentityService> = {
      isUserInOrganization: jest.fn().mockResolvedValue(true),
      hasPermission: jest.fn().mockResolvedValue(false),
      hasOrganizationPermission: jest.fn().mockResolvedValue(true),
    };
    const guard = buildGuard(identityService);

    expect(
      await guard.canActivate(contextForHandler('findAll', { userId: 'user-1' })),
    ).toBe(true);
    expect(identityService.isUserInOrganization).toHaveBeenCalledWith('user-1', ORG_ID);
    expect(identityService.hasOrganizationPermission).toHaveBeenCalledWith(
      'user-1',
      ORG_ID,
      'membership-plan',
      'read',
    );
    // Tenant-scoped route: a global grant is not a fallback, so a `hasPermission`
    // mock that resolves false must not decide the outcome.
    expect(identityService.hasPermission).not.toHaveBeenCalled();
  });

  it('throws 403 when the user lacks the required permission', async () => {
    const identityService: Partial<IdentityService> = {
      isUserInOrganization: jest.fn().mockResolvedValue(true),
      hasPermission: jest.fn().mockResolvedValue(true),
      hasOrganizationPermission: jest.fn().mockResolvedValue(false),
    };
    const guard = buildGuard(identityService);

    await expect(
      guard.canActivate(contextForHandler('create', { userId: 'user-1' })),
    ).rejects.toBeInstanceOf(ForbiddenException);
    // The user IS a member, so the refusal is the RBAC one, not the
    // tenant-context one.
    expect(identityService.isUserInOrganization).toHaveBeenCalledWith('user-1', ORG_ID);
    expect(identityService.hasOrganizationPermission).toHaveBeenCalledWith(
      'user-1',
      ORG_ID,
      'membership-plan',
      'create',
    );
    // A global grant (`hasPermission` -> true) must not rescue the denial.
    expect(identityService.hasPermission).not.toHaveBeenCalled();
  });

  it('throws 403 when the request carries no authenticated user', async () => {
    const identityService: Partial<IdentityService> = {
      isUserInOrganization: jest.fn().mockResolvedValue(true),
      hasPermission: jest.fn().mockResolvedValue(true),
      hasOrganizationPermission: jest.fn().mockResolvedValue(true),
    };
    const guard = buildGuard(identityService);

    await expect(
      guard.canActivate(contextForHandler('findAll', undefined)),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(identityService.hasPermission).not.toHaveBeenCalled();
    expect(identityService.hasOrganizationPermission).not.toHaveBeenCalled();
    expect(identityService.isUserInOrganization).not.toHaveBeenCalled();
  });
});