import { Reflector } from '@nestjs/core';
import { ForbiddenException } from '@nestjs/common';
import { MembershipPlansController } from './membership-plans.controller';
import {
  PERMISSIONS_KEY,
  PermissionsGuard,
  RequiredPermission,
} from '../../shared/auth/permissions.guard';
import { IdentityService } from '../../identity/services/identity.service';

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
      switchToHttp: () => ({ getRequest: () => ({ user: reqUser }) }),
    };
  }

  it('passes when hasPermission(id, membership-plan, read) resolves true', async () => {
    const identityService: Partial<IdentityService> = {
      hasPermission: jest.fn().mockResolvedValue(true),
    };
    const guard = buildGuard(identityService);

    expect(
      await guard.canActivate(contextForHandler('findAll', { userId: 'user-1' })),
    ).toBe(true);
    expect(identityService.hasPermission).toHaveBeenCalledWith(
      'user-1',
      'membership-plan',
      'read',
    );
  });

  it('throws 403 when the user lacks the required permission', async () => {
    const identityService: Partial<IdentityService> = {
      hasPermission: jest.fn().mockResolvedValue(false),
    };
    const guard = buildGuard(identityService);

    await expect(
      guard.canActivate(contextForHandler('create', { userId: 'user-1' })),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(identityService.hasPermission).toHaveBeenCalledWith(
      'user-1',
      'membership-plan',
      'create',
    );
  });

  it('throws 403 when the request carries no authenticated user', async () => {
    const identityService: Partial<IdentityService> = {
      hasPermission: jest.fn().mockResolvedValue(true),
    };
    const guard = buildGuard(identityService);

    await expect(
      guard.canActivate(contextForHandler('findAll', undefined)),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(identityService.hasPermission).not.toHaveBeenCalled();
  });
});