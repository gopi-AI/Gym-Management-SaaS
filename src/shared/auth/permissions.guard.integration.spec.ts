/**
 * PermissionsGuard × real PostgreSQL authorization chain.
 *
 * WHY THIS EXISTS ALONGSIDE `permissions.guard.spec.ts`
 * The hermetic guard spec supplies a narrow `IdentityService` double, so it can
 * only show WHICH calls the guard makes and in what order. It cannot show that
 * the guard's two-step decision (membership first, then the organization-scoped
 * permission) produces the intended answer for a real user whose membership,
 * role and permission rows are persisted. Here the guard is the real
 * `PermissionsGuard`, the `Reflector` is the real one reading metadata off the
 * decorated handlers below, and `IdentityService` is the real service wired to
 * a real DataSource. Nothing in the authorization chain is mocked.
 *
 * SCOPE — READ THIS BEFORE CITING THE FILE
 * These are GUARD-LEVEL tests: `canActivate()` is invoked directly with a
 * hand-built `ExecutionContext`, exactly as NestJS would invoke it after the
 * JWT guard has attached `req.user`. They are NOT HTTP/NestJS request-path
 * tests: no server is booted, no routing, no serialization, no global pipes or
 * interceptors take part. Route-parameter resolution (`req.params.orgId`) and
 * header reading are exercised, request-path plumbing is not. The request path
 * itself is covered by `npm run api:gate` (restored `ten-02` expectation:
 * `Access to this organization is not allowed`).
 *
 * RUNNING IT
 *   RUN_DB_INTEGRATION=1 DB_HOST=… DB_PORT=… DB_USERNAME=… DB_PASSWORD=… \
 *     DB_DATABASE=gym_verify_p005t2 \
 *     npx jest src/shared/auth/permissions.guard.integration
 * The database must already be migrated; jest does not load `.env`. Without
 * `RUN_DB_INTEGRATION=1` the block reports as SKIPPED. Every fixture row is
 * deleted in `afterAll`.
 */
import 'reflect-metadata';
import { randomUUID } from 'crypto';
import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DataSource, In } from 'typeorm';
import { IdentityService } from '../../identity/services/identity.service';
import { IdentityUser } from '../../identity/entities/identity-users.entity';
import { IdentityRole } from '../../identity/entities/identity-roles.entity';
import { IdentityPermission } from '../../identity/entities/identity-permissions.entity';
import { IdentityUserRole } from '../../identity/entities/identity-user-roles.entity';
import { IdentityRolePermission } from '../../identity/entities/identity-role-permissions.entity';
import { IdentityUserOrganization } from '../../identity/entities/identity-user-organizations.entity';
import { Organization } from '../../tenancy/entities/organization.entity';
import { ORGANIZATION_ACCESS_DENIED_MESSAGE } from '../tenant/tenant-context.service';
import {
  PermissionsGuard,
  RequirePermissions,
  SystemWidePermissions,
} from './permissions.guard';

const RUN = process.env.RUN_DB_INTEGRATION === '1';
const describeIntegration = RUN ? describe : describe.skip;

const RESOURCE = 'p005-guard';
const READ = 'read';
const WRITE = 'write';

const READ_PERMISSION = { resource: RESOURCE, action: READ };
const WRITE_PERMISSION = { resource: RESOURCE, action: WRITE };

/** Tenant-scoped route: no organization segment, organization comes from the header. */
class TenantHeaderController {
  @RequirePermissions(READ_PERMISSION)
  listHandler(): void {
    /* fixture handler */
  }
}

/** Tenant-scoped route: organization comes from the `:orgId` route segment. */
class TenantRouteController {
  @RequirePermissions(READ_PERMISSION)
  readHandler(): void {
    /* fixture handler */
  }

  @RequirePermissions(READ_PERMISSION, WRITE_PERMISSION)
  readWriteHandler(): void {
    /* fixture handler, AND semantics */
  }
}

/** System-wide route: the approved global path, no tenant context at all. */
class SystemWideController {
  @SystemWidePermissions()
  @RequirePermissions(READ_PERMISSION)
  systemWideHandler(): void {
    /* fixture handler */
  }
}

type FixtureClass =
  | typeof TenantHeaderController
  | typeof TenantRouteController
  | typeof SystemWideController;

interface RequestShape {
  user?: { userId?: string };
  headers?: Record<string, string | undefined>;
  params?: Record<string, string | undefined>;
}

const buildContext = (
  target: FixtureClass,
  handler: string,
  request: RequestShape,
): ExecutionContext =>
  ({
    getHandler: () =>
      (target.prototype as unknown as Record<string, unknown>)[handler],
    getClass: () => target,
    switchToHttp: () => ({
      getRequest: () => ({
        user: request.user,
        headers: request.headers ?? {},
        params: request.params ?? {},
      }),
    }),
  }) as unknown as ExecutionContext;

const REQUIRED_DB_ENV = [
  'DB_HOST',
  'DB_PORT',
  'DB_USERNAME',
  'DB_PASSWORD',
  'DB_DATABASE',
] as const;

/** Production database names that must never be targeted by integration tests. */
const FORBIDDEN_DATABASES = new Set(['gym_management']);

/** Allowlist copied from `members.service.integration.spec.ts`. */
const ALLOWED_DATABASE_PATTERN =
  /^gym_(?:[a-z0-9]+_)*(?:scratch|gate|test|verify|ci)(?:_[a-z0-9]+)*$/i;

function requireDbConfig(): void {
  const missing = REQUIRED_DB_ENV.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    throw new Error(
      `[permissions.guard.integration.spec] RUN_DB_INTEGRATION=1 but required DB env vars are missing: ${missing.join(
        ', ',
      )}. Set DB_HOST, DB_PORT, DB_USERNAME, DB_PASSWORD and DB_DATABASE explicitly (no defaults).`,
    );
  }
}

function assertTestDatabase(database: string): void {
  if (FORBIDDEN_DATABASES.has(database)) {
    throw new Error(
      `[permissions.guard.integration.spec] Refusing to run integration tests against the production database '${database}'.`,
    );
  }
  if (!ALLOWED_DATABASE_PATTERN.test(database)) {
    throw new Error(
      `[permissions.guard.integration.spec] Refusing to run integration tests against database '${database}': ` +
        `it does not match the scratch/test allowlist ${ALLOWED_DATABASE_PATTERN}. Point DB_DATABASE at a dedicated scratch database (e.g. gym_verify_p005t2).`,
    );
  }
}

describeIntegration('PermissionsGuard over persisted authorization (real Postgres)', () => {
  let dataSource: DataSource;
  let service: IdentityService;
  let guard: PermissionsGuard;

  // Every row this spec writes is tracked here and deleted in `afterAll`; no
  // table is truncated and no pre-existing row is touched.
  const created = {
    userIds: [] as string[],
    roleIds: [] as string[],
    permissionIds: [] as string[],
    organizationIds: [] as string[],
  };

  beforeAll(async () => {
    requireDbConfig();
    const database = process.env.DB_DATABASE!;
    assertTestDatabase(database);

    dataSource = new DataSource({
      type: 'postgres',
      host: process.env.DB_HOST!,
      port: parseInt(process.env.DB_PORT!, 10),
      username: process.env.DB_USERNAME!,
      password: process.env.DB_PASSWORD!,
      database,
      entities: [__dirname + '/../../**/*.entity{.ts,.js}'],
      synchronize: false,
    });
    await dataSource.initialize();

    service = new IdentityService(
      dataSource.getRepository(IdentityUser),
      dataSource.getRepository(IdentityRole),
      dataSource.getRepository(IdentityPermission),
      dataSource.getRepository(IdentityUserRole),
      dataSource.getRepository(IdentityRolePermission),
      dataSource.getRepository(IdentityUserOrganization),
    );
    // Real Reflector: the guard reads @RequirePermissions/@SystemWidePermissions
    // metadata off the decorated fixture handlers above.
    guard = new PermissionsGuard(new Reflector(), service);
  });

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    const { userIds, roleIds, permissionIds, organizationIds } = created;
    if (userIds.length) {
      await dataSource
        .getRepository(IdentityUserOrganization)
        .delete({ user_id: In(userIds) });
      await dataSource
        .getRepository(IdentityUserRole)
        .delete({ user_id: In(userIds) });
    }
    if (roleIds.length) {
      await dataSource
        .getRepository(IdentityRolePermission)
        .delete({ role_id: In(roleIds) });
    }
    if (permissionIds.length) {
      await dataSource
        .getRepository(IdentityPermission)
        .delete({ id: In(permissionIds) });
    }
    if (roleIds.length) {
      await dataSource.getRepository(IdentityRole).delete({ id: In(roleIds) });
    }
    if (userIds.length) {
      await dataSource.getRepository(IdentityUser).delete({ id: In(userIds) });
    }
    if (organizationIds.length) {
      await dataSource
        .getRepository(Organization)
        .delete({ id: In(organizationIds) });
    }
    await dataSource.destroy();
  }, 30000);

  // ---------------------------------------------------------------- fixtures

  async function seedUser(tag: string): Promise<string> {
    const id = randomUUID();
    await dataSource.getRepository(IdentityUser).save({
      id,
      email: `p005-g-${tag}-${id}@authz-integration.test`,
      password_hash: 'not-a-real-hash',
      first_name: 'P005',
      last_name: tag,
      is_active: true,
      email_verified: true,
    });
    created.userIds.push(id);
    return id;
  }

  async function seedRole(tag: string, isActive = true): Promise<string> {
    const id = randomUUID();
    await dataSource.getRepository(IdentityRole).save({
      id,
      name: `p005-g-${tag}-${id.slice(0, 8)}`,
      description: `P0-05 guard fixture (${tag})`,
      is_active: isActive,
    });
    created.roleIds.push(id);
    return id;
  }

  async function seedPermission(
    resource: string,
    action: string,
    isActive = true,
  ): Promise<string> {
    const id = randomUUID();
    await dataSource.getRepository(IdentityPermission).save({
      id,
      name: `${resource}:${action}:${id.slice(0, 8)}`,
      description: 'P0-05 guard fixture',
      resource,
      action,
      is_active: isActive,
    });
    created.permissionIds.push(id);
    return id;
  }

  async function seedOrganization(tag: string, isActive = true): Promise<string> {
    const id = randomUUID();
    await dataSource.getRepository(Organization).save({
      id,
      name: `P005 guard ${tag} ${id.slice(0, 8)}`,
      timezone: 'UTC',
      locale: 'en-US',
      currency: 'USD',
      is_active: isActive,
    });
    created.organizationIds.push(id);
    return id;
  }

  async function grantGlobalRole(userId: string, roleId: string): Promise<void> {
    await dataSource
      .getRepository(IdentityUserRole)
      .save({ user_id: userId, role_id: roleId });
  }

  async function linkPermission(
    roleId: string,
    permissionId: string,
  ): Promise<void> {
    await dataSource
      .getRepository(IdentityRolePermission)
      .save({ role_id: roleId, permission_id: permissionId });
  }

  async function seedMembership(
    userId: string,
    organizationId: string,
    roleId: string | null,
    isActive = true,
  ): Promise<void> {
    await dataSource.getRepository(IdentityUserOrganization).save({
      user_id: userId,
      organization_id: organizationId,
      role_id: roleId,
      is_active: isActive,
    });
  }

  /**
   * A member of `organizationId` whose ORGANIZATION role grants the given
   * actions. No global roles are created — the tenant path must not need them.
   */
  async function seedMemberWithActions(
    tag: string,
    organizationId: string,
    actions: string[],
    isActive = true,
  ): Promise<string> {
    const userId = await seedUser(tag);
    const roleId = await seedRole(tag, isActive);
    for (const action of actions) {
      await linkPermission(roleId, await seedPermission(RESOURCE, action));
    }
    await seedMembership(userId, organizationId, roleId);
    return userId;
  }

  const asUser = (userId: string) => ({ userId });

  const missingPermission = (action: string) =>
    `Missing permission ${RESOURCE}:${action}`;

  // ------------------------------------------------------------ tenant routes

  describe('tenant-scoped route resolution', () => {
    it('authorizes a member holding the required organization permission', async () => {
      const orgId = await seedOrganization('allow');
      const userId = await seedMemberWithActions('allow', orgId, [READ]);

      const ctx = buildContext(TenantRouteController, 'readHandler', {
        user: asUser(userId),
        params: { orgId },
      });

      expect(await guard.canActivate(ctx)).toBe(true);
    });

    it('authorizes against the route :orgId, not another organization the user belongs to', async () => {
      // Member of B with the permission; the request names A in the path.
      const orgA = await seedOrganization('route-a');
      const orgB = await seedOrganization('route-b');
      const userId = await seedMemberWithActions('route-b', orgB, [READ]);

      const ctx = buildContext(TenantRouteController, 'readHandler', {
        user: asUser(userId),
        params: { orgId: orgA },
      });

      await expect(guard.canActivate(ctx)).rejects.toThrow(
        ORGANIZATION_ACCESS_DENIED_MESSAGE,
      );
    });

    it('rejects a mismatched X-Organization-Id header', async () => {
      // A permitted member of BOTH organizations: the mismatch alone must refuse.
      const orgA = await seedOrganization('mismatch-a');
      const orgB = await seedOrganization('mismatch-b');
      const userId = await seedMemberWithActions('mismatch-a', orgA, [READ]);
      await seedMembership(
        userId,
        orgB,
        await seedRole('mismatch-b'),
      );

      const ctx = buildContext(TenantRouteController, 'readHandler', {
        user: asUser(userId),
        params: { orgId: orgA },
        headers: { 'x-organization-id': orgB },
      });

      await expect(guard.canActivate(ctx)).rejects.toThrow(
        'Organization header does not match route organization',
      );
    });

    it('refuses a non-member with the tenant-access message', async () => {
      const orgId = await seedOrganization('non-member');
      const strangerId = await seedUser('non-member');

      const ctx = buildContext(TenantRouteController, 'readHandler', {
        user: asUser(strangerId),
        params: { orgId },
      });

      await expect(guard.canActivate(ctx)).rejects.toThrow(
        ORGANIZATION_ACCESS_DENIED_MESSAGE,
      );
    });

    it('refuses an inactive membership with the tenant-access message', async () => {
      const orgId = await seedOrganization('inactive-membership');
      const userId = await seedUser('inactive-membership');
      const roleId = await seedRole('inactive-membership');
      await linkPermission(roleId, await seedPermission(RESOURCE, READ));
      await seedMembership(userId, orgId, roleId, false);

      const ctx = buildContext(TenantRouteController, 'readHandler', {
        user: asUser(userId),
        params: { orgId },
      });

      await expect(guard.canActivate(ctx)).rejects.toThrow(
        ORGANIZATION_ACCESS_DENIED_MESSAGE,
      );
    });

    it('returns the permission-denial message for a member lacking the permission', async () => {
      const orgId = await seedOrganization('lacking');
      const userId = await seedMemberWithActions('lacking', orgId, [WRITE]);

      const ctx = buildContext(TenantRouteController, 'readHandler', {
        user: asUser(userId),
        params: { orgId },
      });

      await expect(guard.canActivate(ctx)).rejects.toThrow(
        missingPermission(READ),
      );
    });

    it('refuses a member of a deactivated organization with the permission-denial message', async () => {
      const orgId = await seedOrganization('deactivated', false);
      const userId = await seedMemberWithActions('deactivated', orgId, [READ]);

      const ctx = buildContext(TenantRouteController, 'readHandler', {
        user: asUser(userId),
        params: { orgId },
      });

      // Membership is intact, which is why this is not the tenant-access error;
      // it is the organization-scoped permission check that refuses.
      await expect(guard.canActivate(ctx)).rejects.toThrow(
        missingPermission(READ),
      );
    });
  });

  describe('no global fallback on tenant routes', () => {
    it('refuses when only a global role grants the permission', async () => {
      const orgId = await seedOrganization('global-only');
      const userId = await seedUser('global-only');
      const globalRole = await seedRole('global-only');
      await linkPermission(globalRole, await seedPermission(RESOURCE, READ));
      await grantGlobalRole(userId, globalRole);
      // Membership exists, but its organization role grants nothing.
      await seedMembership(userId, orgId, await seedRole('global-only-org'));

      // The global path would say yes...
      expect(await service.hasPermission(userId, RESOURCE, READ)).toBe(true);

      const ctx = buildContext(TenantRouteController, 'readHandler', {
        user: asUser(userId),
        params: { orgId },
      });

      // ...the tenant route must not.
      await expect(guard.canActivate(ctx)).rejects.toThrow(
        missingPermission(READ),
      );
    });
  });

  describe('AND semantics', () => {
    it('requires every declared permission and names the first one missing', async () => {
      const orgId = await seedOrganization('and-semantics');
      const userId = await seedMemberWithActions('and-semantics', orgId, [READ]);

      const denied = buildContext(TenantRouteController, 'readWriteHandler', {
        user: asUser(userId),
        params: { orgId },
      });
      await expect(guard.canActivate(denied)).rejects.toThrow(
        missingPermission(WRITE),
      );

      // Granting the second permission turns the same route green.
      const membership = await dataSource
        .getRepository(IdentityUserOrganization)
        .findOne({ where: { user_id: userId, organization_id: orgId } });
      await linkPermission(
        membership!.role_id!,
        await seedPermission(RESOURCE, WRITE),
      );

      const allowed = buildContext(TenantRouteController, 'readWriteHandler', {
        user: asUser(userId),
        params: { orgId },
      });
      expect(await guard.canActivate(allowed)).toBe(true);
    });
  });

  describe('tenant routes without a route organization segment', () => {
    it('requires organization context when neither the path nor the header supplies it', async () => {
      const orgId = await seedOrganization('header-absent');
      const userId = await seedMemberWithActions('header-absent', orgId, [READ]);

      const ctx = buildContext(TenantHeaderController, 'listHandler', {
        user: asUser(userId),
        params: {},
      });

      await expect(guard.canActivate(ctx)).rejects.toThrow(
        'Organization context required',
      );
    });

    it('authorizes against the X-Organization-Id header', async () => {
      const orgId = await seedOrganization('header-present');
      const userId = await seedMemberWithActions('header-present', orgId, [READ]);

      const ctx = buildContext(TenantHeaderController, 'listHandler', {
        user: asUser(userId),
        headers: { 'x-organization-id': orgId },
      });

      expect(await guard.canActivate(ctx)).toBe(true);
    });
  });

  describe('system-wide routes', () => {
    it('authorizes through the global path with no tenant organization context', async () => {
      const userId = await seedUser('system-wide');
      const globalRole = await seedRole('system-wide');
      await linkPermission(globalRole, await seedPermission(RESOURCE, READ));
      await grantGlobalRole(userId, globalRole);

      const ctx = buildContext(SystemWideController, 'systemWideHandler', {
        user: asUser(userId),
        params: {},
        headers: {},
      });

      expect(await guard.canActivate(ctx)).toBe(true);
    });

    it('denies without the global permission even when a stale organization header is present', async () => {
      const userId = await seedUser('system-wide-denied');
      const orgId = await seedOrganization('system-wide-stale');

      const ctx = buildContext(SystemWideController, 'systemWideHandler', {
        user: asUser(userId),
        headers: { 'x-organization-id': orgId },
      });

      await expect(guard.canActivate(ctx)).rejects.toThrow(
        missingPermission(READ),
      );
    });
  });
});


