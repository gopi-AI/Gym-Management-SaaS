import { QueryRunner, Repository } from 'typeorm';
import {
  AI_PLAN_PERFORMANCE_PERMISSION,
  AI_PLAN_PERFORMANCE_ROLE_NAME,
  ProvisionAiPlanPerformancePermission1788965263231,
} from '../1788965263231-ProvisionAiPlanPerformancePermission';
import {
  AI_RETENTION_PERMISSION,
  ProvisionAiRetentionPermission1788965263230,
} from '../1788965263230-ProvisionAiRetentionPermission';
import { IdentityService } from '../../identity/services/identity.service';
import { IdentityUser } from '../../identity/entities/identity-users.entity';
import { IdentityRole } from '../../identity/entities/identity-roles.entity';
import { IdentityPermission } from '../../identity/entities/identity-permissions.entity';
import { IdentityUserRole } from '../../identity/entities/identity-user-roles.entity';
import { IdentityRolePermission } from '../../identity/entities/identity-role-permissions.entity';
import { IdentityUserOrganization } from '../../identity/entities/identity-user-organizations.entity';

/**
 * Focused verification of the AI plan-performance permission provisioning
 * migration (the second AI use case).
 *
 * This file lives in `src/migrations/__specs__/` on purpose: `src/migrations/*`
 * is loaded wholesale by the TypeORM CLI, while `jest` still finds this spec.
 *
 * The in-memory QueryRunner only understands the exact statements emitted by
 * the migration, so the SELECT-then-INSERT idempotency logic is exercised for
 * real (unlike a "returns canned rows" mock, which would not detect duplicate
 * inserts).
 */

interface PermissionRow {
  id: string;
  name: string;
  description: string;
  resource: string;
  action: string;
  is_active: boolean;
}

interface RoleRow {
  id: string;
  name: string;
  description: string;
  is_active: boolean;
}

interface RolePermissionRow {
  id: string;
  role_id: string;
  permission_id: string;
}

interface UserRoleRow {
  user_id: string;
  role_id: string;
}

class FakeQueryRunner {
  permissions: PermissionRow[] = [];
  roles: RoleRow[] = [];
  rolePermissions: RolePermissionRow[] = [];
  userRoles: UserRoleRow[] = [];

  private seq = 0;

  private nextId(prefix: string): string {
    this.seq += 1;
    return `${prefix}-${String(this.seq).padStart(3, '0')}`;
  }

  async query(sql: string, params: unknown[] = []): Promise<Array<Record<string, unknown>>> {
    const q = sql.replace(/\s+/g, ' ').trim();

    if (q.startsWith('SELECT "id" FROM "IDENTITY_PERMISSIONS"')) {
      const [resource, action] = params as [string, string];
      return this.permissions
        .filter((p) => p.resource === resource && p.action === action)
        .map((p) => ({ id: p.id }));
    }

    if (q.startsWith('INSERT INTO "IDENTITY_PERMISSIONS"')) {
      const [name, description, resource, action] = params as [string, string, string, string];
      const row: PermissionRow = {
        id: this.nextId('perm'),
        name,
        description,
        resource,
        action,
        is_active: true,
      };
      this.permissions.push(row);
      return [{ id: row.id }];
    }

    if (q.startsWith('SELECT "id" FROM "IDENTITY_ROLES"')) {
      const [name] = params as [string];
      return this.roles.filter((r) => r.name === name).map((r) => ({ id: r.id }));
    }

    if (q.startsWith('INSERT INTO "IDENTITY_ROLES"')) {
      const [name, description] = params as [string, string];
      const row: RoleRow = { id: this.nextId('role'), name, description, is_active: true };
      this.roles.push(row);
      return [{ id: row.id }];
    }

    if (q.startsWith('SELECT "id" FROM "IDENTITY_ROLE_PERMISSIONS"')) {
      const [roleId, permissionId] = params as [string, string];
      return this.rolePermissions
        .filter((rp) => rp.role_id === roleId && rp.permission_id === permissionId)
        .map((rp) => ({ id: rp.id }));
    }

    if (q.startsWith('INSERT INTO "IDENTITY_ROLE_PERMISSIONS"')) {
      const [roleId, permissionId] = params as [string, string];
      const row: RolePermissionRow = {
        id: this.nextId('rp'),
        role_id: roleId,
        permission_id: permissionId,
      };
      this.rolePermissions.push(row);
      return [{ id: row.id }];
    }

    if (q.startsWith('DELETE FROM "IDENTITY_ROLE_PERMISSIONS"')) {
      const [roleName, resource, action] = params as [string, string, string];
      const roleIds = this.roles.filter((r) => r.name === roleName).map((r) => r.id);
      const permissionIds = this.permissions
        .filter((p) => p.resource === resource && p.action === action)
        .map((p) => p.id);
      this.rolePermissions = this.rolePermissions.filter(
        (rp) => !(roleIds.includes(rp.role_id) && permissionIds.includes(rp.permission_id)),
      );
      return [];
    }

    if (q.startsWith('DELETE FROM "IDENTITY_PERMISSIONS"')) {
      const [resource, action] = params as [string, string];
      this.permissions = this.permissions.filter(
        (p) => !(p.resource === resource && p.action === action),
      );
      return [];
    }

    throw new Error(`FakeQueryRunner received an unexpected statement: ${q}`);
  }
}

function asQueryRunner(fake: FakeQueryRunner): QueryRunner {
  return fake as unknown as QueryRunner;
}

function inValues(operator: unknown): string[] {
  const value = (operator as { value?: unknown } | null | undefined)?.value;
  return Array.isArray(value) ? (value as string[]) : [];
}

const findPermission = (db: FakeQueryRunner, resource: string, action: string) =>
  db.permissions.find((p) => p.resource === resource && p.action === action);

describe('ProvisionAiPlanPerformancePermission1788965263231', () => {
  let migration: ProvisionAiPlanPerformancePermission1788965263231;
  let db: FakeQueryRunner;

  beforeEach(() => {
    migration = new ProvisionAiPlanPerformancePermission1788965263231();
    db = new FakeQueryRunner();
  });

  it('provisions the permission, the intended role and their association on a fresh database', async () => {
    await migration.up(asQueryRunner(db));

    const permission = findPermission(db, 'ai', 'plan-performance');
    expect(permission).toMatchObject({
      name: 'ai:plan-performance',
      resource: 'ai',
      action: 'plan-performance',
      is_active: true,
    });

    const role = db.roles.find((r) => r.name === AI_PLAN_PERFORMANCE_ROLE_NAME);
    expect(role).toBeDefined();
    expect(
      db.rolePermissions.some(
        (rp) => rp.role_id === role?.id && rp.permission_id === permission?.id,
      ),
    ).toBe(true);
  });

  it('is idempotent when re-run', async () => {
    await migration.up(asQueryRunner(db));
    const permissionCount = db.permissions.length;
    const roleCount = db.roles.length;
    const linkCount = db.rolePermissions.length;

    await migration.up(asQueryRunner(db));

    expect(db.permissions).toHaveLength(permissionCount);
    expect(db.roles).toHaveLength(roleCount);
    expect(db.rolePermissions).toHaveLength(linkCount);
  });

  it('reuses an existing owner role instead of creating a second one', async () => {
    db.roles.push({ id: 'role-existing', name: 'owner', description: 'Owner', is_active: true });

    await migration.up(asQueryRunner(db));

    expect(db.roles.filter((r) => r.name === AI_PLAN_PERFORMANCE_ROLE_NAME)).toHaveLength(1);
    expect(
      db.rolePermissions.some(
        (rp) =>
          rp.role_id === 'role-existing' &&
          rp.permission_id === findPermission(db, 'ai', 'plan-performance')?.id,
      ),
    ).toBe(true);
  });

  it('leaves unrelated roles, permissions and associations untouched', async () => {
    db.permissions.push({
      id: 'perm-unrelated',
      name: 'membership:read',
      description: 'Read memberships',
      resource: 'membership',
      action: 'read',
      is_active: true,
    });
    db.rolePermissions.push({
      id: 'rp-unrelated',
      role_id: 'role-unrelated',
      permission_id: 'perm-unrelated',
    });

    await migration.up(asQueryRunner(db));

    expect(db.permissions.map((p) => p.id)).toContain('perm-unrelated');
    expect(db.rolePermissions.map((rp) => rp.id)).toContain('rp-unrelated');
  });

  it('removes only its own rows on down() and preserves the shared role', async () => {
    await migration.up(asQueryRunner(db));
    const roleId = db.roles.find((r) => r.name === AI_PLAN_PERFORMANCE_ROLE_NAME)?.id;

    await migration.down(asQueryRunner(db));

    expect(findPermission(db, 'ai', 'plan-performance')).toBeUndefined();
    expect(db.roles.some((r) => r.id === roleId)).toBe(true);
  });

  it('does not disturb the retention-analysis permission when both migrations run', async () => {
    const retention = new ProvisionAiRetentionPermission1788965263230();
    await retention.up(asQueryRunner(db));
    await migration.up(asQueryRunner(db));

    await migration.down(asQueryRunner(db));

    const retentionPermission = findPermission(db, 'ai', 'retention-analysis');
    expect(retentionPermission).toMatchObject({ name: AI_RETENTION_PERMISSION.name });
    expect(db.rolePermissions.some((rp) => rp.permission_id === retentionPermission?.id)).toBe(true);
  });

  describe('RBAC compatibility with the existing IdentityService.hasPermission()', () => {
    function buildIdentityService(store: FakeQueryRunner): IdentityService {
      const userRoleRepository = {
        find: jest.fn(async (options: { where: { user_id: string } }) =>
          store.userRoles.filter((ur) => ur.user_id === options.where.user_id),
        ),
      };

      const rolePermissionRepository = {
        find: jest.fn(async (options: { where: { role_id: unknown } }) => {
          const roleIds = inValues(options.where.role_id);
          return store.rolePermissions.filter((rp) => roleIds.includes(rp.role_id));
        }),
      };

      const permissionRepository = {
        findOne: jest.fn(
          async (options: {
            where: { id: unknown; resource: string; action: string; is_active: boolean };
          }) => {
            const ids = inValues(options.where.id);
            return (
              store.permissions.find(
                (p) =>
                  ids.includes(p.id) &&
                  p.resource === options.where.resource &&
                  p.action === options.where.action &&
                  p.is_active === options.where.is_active,
              ) ?? null
            );
          },
        ),
      };

      return new IdentityService(
        {} as Repository<IdentityUser>,
        {} as Repository<IdentityRole>,
        permissionRepository as unknown as Repository<IdentityPermission>,
        userRoleRepository as unknown as Repository<IdentityUserRole>,
        rolePermissionRepository as unknown as Repository<IdentityRolePermission>,
        {} as Repository<IdentityUserOrganization>,
      );
    }

    it('grants ai:plan-performance only to a user holding the intended role', async () => {
      await migration.up(asQueryRunner(db));

      db.roles.push({
        id: 'role-restricted',
        name: 'viewer',
        description: 'Read-only',
        is_active: true,
      });
      db.userRoles.push({ user_id: 'user-owner', role_id: db.roles[0].id });
      db.userRoles.push({ user_id: 'user-restricted', role_id: 'role-restricted' });

      const identityService = buildIdentityService(db);

      await expect(
        identityService.hasPermission('user-owner', 'ai', 'plan-performance'),
      ).resolves.toBe(true);

      await expect(
        identityService.hasPermission('user-restricted', 'ai', 'plan-performance'),
      ).resolves.toBe(false);

      // The new permission does not imply any other AI capability.
      await expect(
        identityService.hasPermission('user-owner', 'ai', 'retention-analysis'),
      ).resolves.toBe(false);
      await expect(
        identityService.hasPermission('user-owner', 'organization', 'read'),
      ).resolves.toBe(false);
    });
  });
});
