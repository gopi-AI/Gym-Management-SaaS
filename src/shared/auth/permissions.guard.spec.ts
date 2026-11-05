import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IdentityService } from '../../identity/services/identity.service';
import { ORGANIZATION_ACCESS_DENIED_MESSAGE } from '../tenant/tenant-context.service';
import {
  PERMISSIONS_KEY,
  SYSTEM_WIDE_KEY,
  PermissionsGuard,
  RequirePermissions,
  SystemWidePermissions,
} from './permissions.guard';

const AI_PERMISSION = { resource: 'ai', action: 'retention-analysis' };
const BRANCH_READ = { resource: 'branch', action: 'read' };
const BRANCH_CREATE = { resource: 'branch', action: 'create' };

class SampleController {
  @RequirePermissions(AI_PERMISSION)
  sampleHandler(): void {
    /* decorated fixture */
  }
}

class TenantController {
  @RequirePermissions(BRANCH_READ)
  readHandler(): void {
    /* tenant-scoped handler */
  }

  @RequirePermissions(BRANCH_READ, BRANCH_CREATE)
  readCreateHandler(): void {
    /* tenant-scoped handler, AND semantics */
  }
}

class SystemWideController {
  @SystemWidePermissions()
  @RequirePermissions(AI_PERMISSION)
  systemWideHandler(): void {
    /* system-wide handler */
  }
}

const buildContext = (user: unknown, headers: Record<string, string | undefined> = {}): ExecutionContext =>
  ({
    getHandler: () => (SampleController.prototype as any).sampleHandler,
    getClass: () => SampleController,
    switchToHttp: () => ({ getRequest: () => ({ user, headers }) }),
  }) as unknown as ExecutionContext;

const buildTenantContext = (
  method: 'readHandler' | 'readCreateHandler',
  user: unknown,
  headers: Record<string, string | undefined> = {},
  params: Record<string, string | undefined> = {},
): ExecutionContext =>
  ({
    getHandler: () => (TenantController.prototype as any)[method],
    getClass: () => TenantController,
    switchToHttp: () => ({ getRequest: () => ({ user, headers, params }) }),
  }) as unknown as ExecutionContext;

const buildSystemWideContext = (
  user: unknown,
  headers: Record<string, string | undefined> = {},
): ExecutionContext =>
  ({
    getHandler: () => (SystemWideController.prototype as any).systemWideHandler,
    getClass: () => SystemWideController,
    switchToHttp: () => ({ getRequest: () => ({ user, headers }) }),
  }) as unknown as ExecutionContext;

describe('PermissionsGuard', () => {
  let guard: PermissionsGuard;
  let reflector: { getAllAndOverride: jest.Mock };
  let identityService: {
    hasPermission: jest.Mock;
    hasOrganizationPermission: jest.Mock;
    isUserInOrganization: jest.Mock;
  };

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn() };
    identityService = {
      hasPermission: jest.fn(),
      hasOrganizationPermission: jest.fn(),
      isUserInOrganization: jest.fn(),
    };
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

  it('publishes the system-wide marker through @SystemWidePermissions', () => {
    expect(
      Reflect.getMetadata(SYSTEM_WIDE_KEY, SystemWideController.prototype.systemWideHandler),
    ).toBe(true);
  });

  it('allows routes that declare no permission', async () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);

    await expect(guard.canActivate(buildContext({ userId: 'user-1' }))).resolves.toBe(true);
    expect(identityService.hasPermission).not.toHaveBeenCalled();
    expect(identityService.hasOrganizationPermission).not.toHaveBeenCalled();
    expect(identityService.isUserInOrganization).not.toHaveBeenCalled();
  });

  it('rejects an unauthenticated request before checking permissions', async () => {
    reflector.getAllAndOverride.mockReturnValue([AI_PERMISSION]);

    await expect(guard.canActivate(buildContext(undefined))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(identityService.hasPermission).not.toHaveBeenCalled();
    expect(identityService.hasOrganizationPermission).not.toHaveBeenCalled();
    expect(identityService.isUserInOrganization).not.toHaveBeenCalled();
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

  // ── T3: Explicit route authorization scope ──
  describe('T3 — tenant-scoped routes require organization context', () => {
    beforeEach(() => {
      reflector.getAllAndOverride.mockImplementation((key: string) => {
        if (key === SYSTEM_WIDE_KEY) return undefined;
        if (key === PERMISSIONS_KEY) return [BRANCH_READ];
        return undefined;
      });
    });

    it('allows tenant route with valid organization context and authorized membership', async () => {
      identityService.isUserInOrganization.mockResolvedValue(true);
      identityService.hasOrganizationPermission.mockResolvedValue(true);

      await expect(
        guard.canActivate(
          buildTenantContext('readHandler', { userId: 'user-1' }, { 'x-organization-id': 'org-1' }),
        ),
      ).resolves.toBe(true);

      expect(identityService.isUserInOrganization).toHaveBeenCalledWith('user-1', 'org-1');
      expect(identityService.hasOrganizationPermission).toHaveBeenCalledWith(
        'user-1',
        'org-1',
        'branch',
        'read',
      );
      // The tenant-context membership check decides BEFORE the RBAC evaluation:
      // this is what keeps the non-member refusal identical to the pre-RBAC
      // contract instead of reporting a missing permission.
      expect(identityService.isUserInOrganization.mock.invocationCallOrder[0]).toBeLessThan(
        identityService.hasOrganizationPermission.mock.invocationCallOrder[0],
      );
      expect(identityService.hasPermission).not.toHaveBeenCalled();
    });

    it('denies tenant route with no organization context', async () => {
      await expect(
        guard.canActivate(
          buildTenantContext('readHandler', { userId: 'user-1' }, {}),
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(identityService.isUserInOrganization).not.toHaveBeenCalled();
      expect(identityService.hasOrganizationPermission).not.toHaveBeenCalled();
      expect(identityService.hasPermission).not.toHaveBeenCalled();
    });

    it('denies tenant route with empty organization context', async () => {
      await expect(
        guard.canActivate(
          buildTenantContext('readHandler', { userId: 'user-1' }, { 'x-organization-id': '' }),
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(identityService.isUserInOrganization).not.toHaveBeenCalled();
      expect(identityService.hasOrganizationPermission).not.toHaveBeenCalled();
    });

    it('denies tenant route with whitespace-only organization context', async () => {
      await expect(
        guard.canActivate(
          buildTenantContext('readHandler', { userId: 'user-1' }, { 'x-organization-id': '   ' }),
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(identityService.isUserInOrganization).not.toHaveBeenCalled();
      expect(identityService.hasOrganizationPermission).not.toHaveBeenCalled();
    });

    it('denies forged organization ID without membership and never reveals permissions', async () => {
      identityService.isUserInOrganization.mockResolvedValue(false);

      let caught: unknown;
      await guard
        .canActivate(
          buildTenantContext(
            'readHandler',
            { userId: 'user-1' },
            { 'x-organization-id': 'forged-org-id' },
          ),
        )
        .catch((error) => {
          caught = error;
        });

      expect(caught).toBeInstanceOf(ForbiddenException);
      expect((caught as ForbiddenException).message).toBe(ORGANIZATION_ACCESS_DENIED_MESSAGE);
      expect(identityService.isUserInOrganization).toHaveBeenCalledWith('user-1', 'forged-org-id');
      // A non-member is refused by the tenant-context check, so the permission
      // path is never reached and cannot leak which permission is missing.
      expect(identityService.hasOrganizationPermission).not.toHaveBeenCalled();
    });

    it('denies a member who lacks the permission with the permission error', async () => {
      identityService.isUserInOrganization.mockResolvedValue(true);
      identityService.hasOrganizationPermission.mockResolvedValue(false);

      let caught: unknown;
      await guard
        .canActivate(
          buildTenantContext(
            'readHandler',
            { userId: 'user-1' },
            { 'x-organization-id': 'org-1' },
          ),
        )
        .catch((error) => {
          caught = error;
        });

      // Membership is not a substitute for RBAC: a member without the
      // permission still gets the permission-shaped refusal.
      expect(caught).toBeInstanceOf(ForbiddenException);
      expect((caught as ForbiddenException).message).toBe('Missing permission branch:read');
      expect(identityService.isUserInOrganization).toHaveBeenCalledWith('user-1', 'org-1');
      expect(identityService.hasOrganizationPermission).toHaveBeenCalledWith(
        'user-1',
        'org-1',
        'branch',
        'read',
      );
    });

    it('requires every declared permission on tenant routes (AND semantics)', async () => {
      reflector.getAllAndOverride.mockImplementation((key: string) => {
        if (key === SYSTEM_WIDE_KEY) return undefined;
        if (key === PERMISSIONS_KEY) return [BRANCH_READ, BRANCH_CREATE];
        return undefined;
      });
      identityService.isUserInOrganization.mockResolvedValue(true);
      identityService.hasOrganizationPermission.mockImplementation(
        async (_userId: string, _orgId: string, resource: string, action: string) =>
          resource === 'branch' && action === 'read',
      );

      await expect(
        guard.canActivate(
          buildTenantContext(
            'readCreateHandler',
            { userId: 'user-1' },
            { 'x-organization-id': 'org-1' },
          ),
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('allows tenant routes only when every declared permission is granted (AND semantics)', async () => {
      reflector.getAllAndOverride.mockImplementation((key: string) => {
        if (key === SYSTEM_WIDE_KEY) return undefined;
        if (key === PERMISSIONS_KEY) return [BRANCH_READ, BRANCH_CREATE];
        return undefined;
      });
      // Distinguish by resource AND action. A resource-only mock cannot tell
      // branch:read from branch:create, so it grants both and the denial case
      // below could never fail.
      identityService.isUserInOrganization.mockResolvedValue(true);
      identityService.hasOrganizationPermission.mockImplementation(
        async (_userId: string, _orgId: string, resource: string, action: string) =>
          resource === 'branch' && (action === 'read' || action === 'create'),
      );

      await expect(
        guard.canActivate(
          buildTenantContext(
            'readCreateHandler',
            { userId: 'user-1' },
            { 'x-organization-id': 'org-1' },
          ),
        ),
      ).resolves.toBe(true);

      expect(identityService.hasOrganizationPermission).toHaveBeenCalledTimes(2);
      expect(identityService.hasOrganizationPermission).toHaveBeenNthCalledWith(
        1,
        'user-1',
        'org-1',
        'branch',
        'read',
      );
      expect(identityService.hasOrganizationPermission).toHaveBeenNthCalledWith(
        2,
        'user-1',
        'org-1',
        'branch',
        'create',
      );
      expect(identityService.hasPermission).not.toHaveBeenCalled();
    });

    // ── B-1: route organization and header organization must agree ──
    describe('B-1 — route organization and header organization must agree', () => {
      it('denies when route orgId and header orgId disagree (cross-org bypass)', async () => {
        identityService.isUserInOrganization.mockResolvedValue(true);
        identityService.hasOrganizationPermission.mockResolvedValue(true);

        let caught: unknown;
        await guard
          .canActivate(
            buildTenantContext(
              'readHandler',
              { userId: 'user-1' },
              { 'x-organization-id': 'org-B' },
              { orgId: 'org-A' },
            ),
          )
          .catch((error) => {
            caught = error;
          });

        expect(caught).toBeInstanceOf(ForbiddenException);
        expect(identityService.isUserInOrganization).not.toHaveBeenCalled();
        expect(identityService.hasOrganizationPermission).not.toHaveBeenCalled();
      });

      it('uses route orgId when header is absent', async () => {
        identityService.isUserInOrganization.mockResolvedValue(true);
        identityService.hasOrganizationPermission.mockResolvedValue(true);

        await expect(
          guard.canActivate(
            buildTenantContext(
              'readHandler',
              { userId: 'user-1' },
              {},
              { orgId: 'org-A' },
            ),
          ),
        ).resolves.toBe(true);

        expect(identityService.hasOrganizationPermission).toHaveBeenCalledWith(
          'user-1',
          'org-A',
          'branch',
          'read',
        );
      });

      it('allows when route orgId and header orgId match', async () => {
        identityService.isUserInOrganization.mockResolvedValue(true);
        identityService.hasOrganizationPermission.mockResolvedValue(true);

        await expect(
          guard.canActivate(
            buildTenantContext(
              'readHandler',
              { userId: 'user-1' },
              { 'x-organization-id': 'org-A' },
              { orgId: 'org-A' },
            ),
          ),
        ).resolves.toBe(true);

        expect(identityService.hasOrganizationPermission).toHaveBeenCalledWith(
          'user-1',
          'org-A',
          'branch',
          'read',
        );
      });

      it('ignores empty header when route orgId is present', async () => {
        identityService.isUserInOrganization.mockResolvedValue(true);
        identityService.hasOrganizationPermission.mockResolvedValue(true);

        await expect(
          guard.canActivate(
            buildTenantContext(
              'readHandler',
              { userId: 'user-1' },
              { 'x-organization-id': '' },
              { orgId: 'org-A' },
            ),
          ),
        ).resolves.toBe(true);

        expect(identityService.hasOrganizationPermission).toHaveBeenCalledWith(
          'user-1',
          'org-A',
          'branch',
          'read',
        );
      });

      it('denies when route orgId is missing and header is absent', async () => {
        await expect(
          guard.canActivate(buildTenantContext('readHandler', { userId: 'user-1' }, {}, {})),
        ).rejects.toBeInstanceOf(ForbiddenException);

        expect(identityService.isUserInOrganization).not.toHaveBeenCalled();
        expect(identityService.hasOrganizationPermission).not.toHaveBeenCalled();
      });
    });
  });

  describe('T3 — system-wide routes use the global authorization path', () => {
    beforeEach(() => {
      reflector.getAllAndOverride.mockImplementation((key: string) => {
        if (key === SYSTEM_WIDE_KEY) return true;
        if (key === PERMISSIONS_KEY) return [AI_PERMISSION];
        return undefined;
      });
    });

    it('allows system-wide route without organization context', async () => {
      identityService.hasPermission.mockResolvedValue(true);

      await expect(
        guard.canActivate(buildSystemWideContext({ userId: 'user-1' }, {})),
      ).resolves.toBe(true);

      expect(identityService.hasPermission).toHaveBeenCalledWith(
        'user-1',
        'ai',
        'retention-analysis',
      );
      expect(identityService.hasOrganizationPermission).not.toHaveBeenCalled();
    });

    it('denies system-wide route when the user lacks the permission', async () => {
      identityService.hasPermission.mockResolvedValue(false);

      let caught: unknown;
      await guard
        .canActivate(buildSystemWideContext({ userId: 'user-1' }, {}))
        .catch((error) => {
          caught = error;
        });

      expect(caught).toBeInstanceOf(ForbiddenException);
      expect(identityService.hasOrganizationPermission).not.toHaveBeenCalled();
    });
  });

  // ── A-1: Route permission classification ──
  describe('A-1 — route permission classification', () => {
    beforeEach(() => {
      reflector.getAllAndOverride.mockImplementation((key: string) => {
        if (key === SYSTEM_WIDE_KEY) return undefined;
        return undefined;
      });
    });

    it('allows authenticated routes that declare no permission metadata (authenticated-no-RBAC)', async () => {
      reflector.getAllAndOverride.mockReturnValue(undefined);

      await expect(
        guard.canActivate(buildContext({ userId: 'user-1' })),
      ).resolves.toBe(true);
      expect(identityService.hasPermission).not.toHaveBeenCalled();
      expect(identityService.hasOrganizationPermission).not.toHaveBeenCalled();
    });

    it('denies unauthenticated routes that declare permission metadata', async () => {
      reflector.getAllAndOverride.mockReturnValue([AI_PERMISSION]);

      await expect(
        guard.canActivate(buildContext(undefined)),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(identityService.hasPermission).not.toHaveBeenCalled();
      expect(identityService.hasOrganizationPermission).not.toHaveBeenCalled();
    });

    it('does not treat @Public() metadata as permission metadata (no PERMISSIONS_KEY)', async () => {
      // @Public() sets IS_PUBLIC_KEY, not PERMISSIONS_KEY. The PermissionsGuard
      // reads only PERMISSIONS_KEY and SYSTEM_WIDE_KEY. A @Public() route with
      // no @RequirePermissions() yields no permission metadata and is allowed
      // by this guard (authentication is handled by JwtAuthGuard).
      reflector.getAllAndOverride.mockReturnValue(undefined);

      await expect(
        guard.canActivate(buildContext({ userId: 'user-1' })),
      ).resolves.toBe(true);
    });

    it('preserves AND semantics for multiple required permissions', async () => {
      reflector.getAllAndOverride.mockImplementation((key: string) => {
        if (key === SYSTEM_WIDE_KEY) return undefined;
        if (key === PERMISSIONS_KEY) return [AI_PERMISSION, BRANCH_READ];
        return undefined;
      });
      identityService.hasPermission.mockImplementation(
        async (_userId: string, resource: string) => resource === 'ai',
      );

      await expect(
        guard.canActivate(buildContext({ userId: 'user-1' })),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });
});
