import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IdentityService } from '../../identity/services/identity.service';
import { PERMISSIONS_KEY, PermissionsGuard, RequirePermissions } from './permissions.guard';

/**
 * RBAC enforcement tests. `ai:retention-analysis` is the permission that gates
 * the AI retention endpoint, so a user without it (or an unauthenticated
 * caller) must be rejected BEFORE any limit accounting or provider call.
 */
const AI_PERMISSION = { resource: 'ai', action: 'retention-analysis' };

class SampleController {
  @RequirePermissions(AI_PERMISSION)
  sampleHandler(): void {
    /* decorated fixture */
  }
}

const buildContext = (user: unknown): ExecutionContext =>
  ({
    getHandler: () => SampleController.prototype.sampleHandler,
    getClass: () => SampleController,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  }) as unknown as ExecutionContext;

describe('PermissionsGuard', () => {
  let guard: PermissionsGuard;
  let reflector: { getAllAndOverride: jest.Mock };
  let identityService: { hasPermission: jest.Mock };

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn() };
    identityService = { hasPermission: jest.fn() };
    guard = new PermissionsGuard(
      reflector as unknown as Reflector,
      identityService as unknown as IdentityService,
    );
  });

  it('publishes the required permission through @RequirePermissions', () => {
    expect(
      Reflect.getMetadata(PERMISSIONS_KEY, SampleController.prototype.sampleHandler),
    ).toEqual([AI_PERMISSION]);
  });

  it('allows routes that declare no permission', async () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);

    await expect(guard.canActivate(buildContext({ userId: 'user-1' }))).resolves.toBe(true);
    expect(identityService.hasPermission).not.toHaveBeenCalled();
  });

  it('rejects an unauthenticated request before checking permissions', async () => {
    reflector.getAllAndOverride.mockReturnValue([AI_PERMISSION]);

    await expect(guard.canActivate(buildContext(undefined))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(identityService.hasPermission).not.toHaveBeenCalled();
  });

  it('allows a user holding ai:retention-analysis', async () => {
    reflector.getAllAndOverride.mockReturnValue([AI_PERMISSION]);
    identityService.hasPermission.mockResolvedValue(true);

    await expect(guard.canActivate(buildContext({ userId: 'user-1' }))).resolves.toBe(true);
    expect(identityService.hasPermission).toHaveBeenCalledWith(
      'user-1',
      'ai',
      'retention-analysis',
    );
  });

  it('rejects a user missing ai:retention-analysis', async () => {
    reflector.getAllAndOverride.mockReturnValue([AI_PERMISSION]);
    identityService.hasPermission.mockResolvedValue(false);

    let caught: unknown;
    await guard.canActivate(buildContext({ userId: 'user-1' })).catch((error) => {
      caught = error;
    });

    expect(caught).toBeInstanceOf(ForbiddenException);
    expect((caught as ForbiddenException).message).toBe('Missing permission ai:retention-analysis');
  });

  it('requires every declared permission, not just one', async () => {
    reflector.getAllAndOverride.mockReturnValue([
      AI_PERMISSION,
      { resource: 'organization', action: 'read' },
    ]);
    identityService.hasPermission.mockImplementation(
      async (_userId: string, resource: string) => resource === 'ai',
    );

    await expect(guard.canActivate(buildContext({ userId: 'user-1' }))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});
