import { QueryRunner, Repository } from 'typeorm';
import {
  AI_RETENTION_PERMISSION,
  AI_RETENTION_ROLE_NAME,
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
 * F2 — focused verification of the AI retention-analysis permission
 * provisioning migration.
 *
 * This file lives in `src/migrations/__specs__/` on purpose: `src/migrations/*`
 * is loaded wholesale by the TypeORM CLI (`migrations: [__dirname +
 * '/migrations/*{.ts,.js}']`, and TypeORM's loader uses `glob.sync` per pattern
 * without `!`-negation support). Keeping specs in a subfolder keeps them out of
 * `migration:run` while `jest` (`testMatch: ['**\/*.spec.ts']`) still finds them.
 *
 * These tests use an in-memory stand-in for the three RBAC tables. The fake
 * QueryRunner only understands the exact statements emitted by the migration,
 * so the migration's SELECT-then-INSERT idempotency logic is exercised for
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

describe('ProvisionAiRetentionPermission1788965263230', () => {
  let migration: ProvisionAiRetentionPermission1788965263230;
  let db: FakeQueryRunner;

  beforeEach(() => {
    migration = new ProvisionAiRetentionPermission1788965263230();
    db = new FakeQueryRunner();
  });

  it('provisions the permission, the intended role and their association on a fresh database', async () => {
    await migration.up(asQueryRunner(db));

    expect(db.permissions).toEqual([
      expect.objectContaining({
        name: 'ai:retention-analysis',
        resource: 'ai',
        action: 'retention-analysis',
        is_active: true,
      }),
    ]);
    expect(db.roles.map((r) => r.name)).toEqual([AI_RETENTION_ROLE_NAME]);
    expect(db.rolePermissions).toHaveLength(1);
    expect(db.rolePermissions[0].role_id).toBe(db.roles[0].id);
    expect(db.rolePermissions[0].permission_id).toBe(db.permissions[0].id);
  });

  it('is idempotent: re-applying the provisioning logic creates no duplicate rows', async () => {
    await migration.up(asQueryRunner(db));
    const firstIds = {
      permission: db.permissions[0].id,
      role: db.roles[0].id,
      link: db.rolePermissions[0].id,
    };

    await migration.up(asQueryRunner(db));

    expect(db.permissions).toHaveLength(1);
    expect(db.roles).toHaveLength(1);
    expect(db.rolePermissions).toHaveLength(1);
    expect(db.permissions[0].id).toBe(firstIds.permission);
    expect(db.roles[0].id).toBe(firstIds.role);
    expect(db.rolePermissions[0].id).toBe(firstIds.link);
  });

  it('reuses the RBAC rows already created by the development bootstrap (no duplicates)', async () => {
    // Simulate a database where bootstrap-dev.ts ran first.
    db.permissions.push({
      id: 'perm-dev',
      name: 'ai:retention-analysis',
      description: 'Run AI retention analysis',
      resource: 'ai',
      action: 'retention-analysis',
      is_active: true,
    });
    db.roles.push({
      id: 'role-dev',
      name: AI_RETENTION_ROLE_NAME,
      description: 'Development owner role (bootstrap)',
      is_active: true,
    });
    db.rolePermissions.push({ id: 'rp-dev', role_id: 'role-dev', permission_id: 'perm-dev' });

    await migration.up(asQueryRunner(db));

    expect(db.permissions.map((p) => p.id)).toEqual(['perm-dev']);
    expect(db.roles.map((r) => r.id)).toEqual(['role-dev']);
    expect(db.rolePermissions.map((rp) => rp.id)).toEqual(['rp-dev']);
  });

  it('down() removes the AI permission and its association, leaving unrelated RBAC data intact', async () => {
    db.permissions.push({
      id: 'perm-unrelated',
      name: 'organization:read',
      description: 'Read organizations',
      resource: 'organization',
      action: 'read',
      is_active: true,
    });
    db.roles.push({
      id: 'role-unrelated',
      name: 'auditor',
      description: 'Unrelated role',
      is_active: true,
    });
    db.rolePermissions.push({
      id: 'rp-unrelated',
      role_id: 'role-unrelated',
      permission_id: 'perm-unrelated',
    });

    await migration.up(asQueryRunner(db));
    const aiPermissionId = db.permissions.find((p) => p.resource === 'ai')?.id;
    const ownerRoleId = db.roles.find((r) => r.name === AI_RETENTION_ROLE_NAME)?.id;

    await migration.down(asQueryRunner(db));

    expect(
      db.permissions.some(
        (p) => p.resource === AI_RETENTION_PERMISSION.resource && p.action === AI_RETENTION_PERMISSION.action,
      ),
    ).toBe(false);
    expect(db.permissions.map((p) => p.id)).toContain('perm-unrelated');
    expect(db.rolePermissions.some((rp) => rp.permission_id === aiPermissionId)).toBe(false);
    expect(db.rolePermissions.map((rp) => rp.id)).toContain('rp-unrelated');
    // The shared `owner` role is intentionally preserved by down().
    expect(db.roles.some((r) => r.id === ownerRoleId)).toBe(true);
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

    it('grants ai:retention-analysis only to a user holding the intended role', async () => {
      await migration.up(asQueryRunner(db));

      // A role unrelated to the migration, deliberately without any permission.
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
        identityService.hasPermission(
          'user-owner',
          AI_RETENTION_PERMISSION.resource,
          AI_RETENTION_PERMISSION.action,
        ),
      ).resolves.toBe(true);

      await expect(
        identityService.hasPermission(
          'user-restricted',
          AI_RETENTION_PERMISSION.resource,
          AI_RETENTION_PERMISSION.action,
        ),
      ).resolves.toBe(false);

      // The intended role is scoped to exactly this permission triple.
      await expect(identityService.hasPermission('user-owner', 'organization', 'read')).resolves.toBe(
        false,
      );
      await expect(identityService.hasPermission('user-owner', 'ai', 'other-action')).resolves.toBe(
        false,
      );
    });
  });
});
