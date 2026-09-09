import { Reflector } from '@nestjs/core';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { OrganizationsController } from './organizations.controller';
import {
  PERMISSIONS_KEY,
  PermissionsGuard,
  RequiredPermission,
} from '../../shared/auth/permissions.guard';
import { IdentityService } from '../../identity/services/identity.service';

/**
 * H3 — Organization Administration RBAC.
 *
 * These tests are intentionally free of DB/Redis/DI-container dependencies:
 * they assert the authorization *metadata* on every route handler exactly as
 * the global PermissionsGuard reads it (Reflect.getMetadata via Reflector),
 * and exercise the guard's canActivate() against the real
 * IdentityService.hasPermission() contract.
 *
 * NOTE: Needs a Node runtime (`npx jest`) to execute; the environment this
 * repo was audited in does NOT provide node/npm/npx.
 */
describe('OrganizationsController authorization metadata (H3)', () => {
  const reflector = new Reflector();

  function requiredOn(
    method: 'findAll' | 'findOne' | 'create' | 'update',
  ): RequiredPermission[] | undefined {
    return reflector.getAllAndOverride<RequiredPermission[]>(PERMISSIONS_KEY, [
      OrganizationsController.prototype[method],
      OrganizationsController,
    ]);
  }

  it('GET /v1/organizations requires organization:read', () => {
    expect(requiredOn('findAll')).toEqual([{ resource: 'organization', action: 'read' }]);
  });

  it('GET /v1/organizations/:id requires organization:read', () => {
    expect(requiredOn('findOne')).toEqual([{ resource: 'organization', action: 'read' }]);
  });

  it('POST /v1/organizations requires organization:create', () => {
    expect(requiredOn('create')).toEqual([{ resource: 'organization', action: 'create' }]);
  });

  it('PATCH /v1/organizations/:id requires organization:update', () => {
    expect(requiredOn('update')).toEqual([{ resource: 'organization', action: 'update' }]);
  });
});

describe('PermissionsGuard -> IdentityService.hasPermission (H3)', () => {
  function buildGuard(identityService: Partial<IdentityService>): PermissionsGuard {
    return new PermissionsGuard(
      new Reflector(),
      identityService as IdentityService,
    );
  }

  function contextForHandler(
    method: 'findAll' | 'findOne' | 'create' | 'update',
    reqUser: { userId: string } | undefined,
  ): ExecutionContext {
    return {
      getHandler: () => OrganizationsController.prototype[method],
      getClass: () => OrganizationsController,
      switchToHttp: () => ({ getRequest: () => ({ user: reqUser }) }),
    } as unknown as ExecutionContext;
  }

  it('passes when hasPermission(id, organization, read) resolves true', async () => {
    const identityService: Partial<IdentityService> = {
      hasPermission: jest.fn().mockResolvedValue(true),
    };
    const guard = buildGuard(identityService);

    expect(
      await guard.canActivate(
        contextForHandler('findOne', { userId: 'user-1' }),
      ),
    ).toBe(true);
    expect(identityService.hasPermission).toHaveBeenCalledWith(
      'user-1',
      'organization',
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
      'organization',
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