import { QueryRunner } from 'typeorm';
import {
  AI_USAGE_PERMISSION,
  AI_USAGE_ROLE_NAME,
  ProvisionAiUsagePermission1788965263232,
} from '../1788965263232-ProvisionAiUsagePermission';

/**
 * Focused verification of the operator AI usage-read permission provisioning
 * migration.
 *
 * This file lives in `src/migrations/__specs__/` on purpose: `src/migrations/*`
 * is loaded wholesale by the TypeORM CLI, while `jest` still finds this spec.
 *
 * The in-memory QueryRunner only understands the exact statements emitted by
 * the migration, so the SELECT-then-INSERT idempotency logic is exercised for
 * real (a "returns canned rows" mock would not detect duplicate inserts).
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

class FakeQueryRunner {
  permissions: PermissionRow[] = [];
  roles: RoleRow[] = [];
  rolePermissions: RolePermissionRow[] = [];
  statements: Array<{ sql: string; params: unknown[] }> = [];

  private seq = 0;

  private nextId(prefix: string): string {
    this.seq += 1;
    return `${prefix}-${String(this.seq).padStart(3, '0')}`;
  }

  async query(sql: string, params: unknown[] = []): Promise<Array<Record<string, unknown>>> {
    const q = sql.replace(/\s+/g, ' ').trim();
    this.statements.push({ sql: q, params });

    if (q.startsWith('SELECT "id" FROM "IDENTITY_PERMISSIONS"')) {
      const [resource, action] = params as [string, string];
      return this.permissions
        .filter((p) => p.resource === resource && p.action === action)
        .map((p) => ({ id: p.id }));
    }

    if (q.startsWith('INSERT INTO "IDENTITY_PERMISSIONS"')) {
      const [name, description, resource, action] = params as [string, string, string, string];
      const row: PermissionRow = {
        id: this.nextId('permission'),
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
        id: this.nextId('link'),
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

describe('ProvisionAiUsagePermission1788965263232', () => {
  const asQueryRunner = (runner: FakeQueryRunner): QueryRunner =>
    runner as unknown as QueryRunner;

  const seedOwnerRole = (runner: FakeQueryRunner): void => {
    runner.roles.push({
      id: 'role-existing-owner',
      name: AI_USAGE_ROLE_NAME,
      description: 'Owner role',
      is_active: true,
    });
  };

  it('declares the operator usage permission triple', () => {
    expect(AI_USAGE_PERMISSION).toEqual({
      name: 'ai:usage-read',
      description: 'View organization AI usage and cost',
      resource: 'ai',
      action: 'usage-read',
    });
    expect(AI_USAGE_ROLE_NAME).toBe('owner');
  });

  it('creates the permission, the shared owner role and exactly one association', async () => {
    const runner = new FakeQueryRunner();
    const migration = new ProvisionAiUsagePermission1788965263232();

    await migration.up(asQueryRunner(runner));

    expect(runner.permissions).toHaveLength(1);
    expect(runner.permissions[0]).toMatchObject({
      name: 'ai:usage-read',
      resource: 'ai',
      action: 'usage-read',
      is_active: true,
    });
    expect(runner.roles).toHaveLength(1);
    expect(runner.roles[0].name).toBe('owner');
    expect(runner.rolePermissions).toHaveLength(1);
    expect(runner.rolePermissions[0]).toMatchObject({
      role_id: runner.roles[0].id,
      permission_id: runner.permissions[0].id,
    });
  });

  it('is idempotent: a second up() creates no duplicate rows', async () => {
    const runner = new FakeQueryRunner();
    const migration = new ProvisionAiUsagePermission1788965263232();

    await migration.up(asQueryRunner(runner));
    await migration.up(asQueryRunner(runner));

    expect(runner.permissions).toHaveLength(1);
    expect(runner.roles).toHaveLength(1);
    expect(runner.rolePermissions).toHaveLength(1);
  });

  it('reuses a pre-existing owner role and a pre-existing permission row', async () => {
    const runner = new FakeQueryRunner();
    seedOwnerRole(runner);
    runner.permissions.push({
      id: 'permission-existing',
      name: 'ai:usage-read',
      description: 'legacy description',
      resource: 'ai',
      action: 'usage-read',
      is_active: true,
    });
    const migration = new ProvisionAiUsagePermission1788965263232();

    await migration.up(asQueryRunner(runner));

    expect(runner.roles).toHaveLength(1);
    expect(runner.permissions).toHaveLength(1);
    expect(runner.rolePermissions).toHaveLength(1);
    expect(runner.rolePermissions[0]).toMatchObject({
      role_id: 'role-existing-owner',
      permission_id: 'permission-existing',
    });
  });

  it('down() removes only its own triple and preserves the shared role and other AI permissions', async () => {
    const runner = new FakeQueryRunner();
    seedOwnerRole(runner);
    runner.permissions.push({
      id: 'permission-retention',
      name: 'ai:retention-analysis',
      description: 'Run AI retention analysis',
      resource: 'ai',
      action: 'retention-analysis',
      is_active: true,
    });
    runner.rolePermissions.push({
      id: 'link-retention',
      role_id: 'role-existing-owner',
      permission_id: 'permission-retention',
    });
    const migration = new ProvisionAiUsagePermission1788965263232();
    await migration.up(asQueryRunner(runner));

    await migration.down(asQueryRunner(runner));

    expect(runner.permissions.map((p) => `${p.resource}:${p.action}`)).toEqual([
      'ai:retention-analysis',
    ]);
    expect(runner.roles.map((r) => r.name)).toEqual([AI_USAGE_ROLE_NAME]);
    expect(runner.rolePermissions).toHaveLength(1);
    expect(runner.rolePermissions[0].permission_id).toBe('permission-retention');
  });

  it('never hardcodes an identifier: every id is generated by the database', async () => {
    const runner = new FakeQueryRunner();
    const migration = new ProvisionAiUsagePermission1788965263232();

    await migration.up(asQueryRunner(runner));

    const inserts = runner.statements.filter((s) => s.sql.startsWith('INSERT'));
    expect(inserts).toHaveLength(3);
    for (const statement of inserts) {
      // The id column is never part of the INSERT column list; it is generated
      // by the database and only read back via RETURNING "id".
      const columnList = statement.sql.split('VALUES')[0];
      expect(columnList).not.toContain('"id"');
      for (const param of statement.params) {
        expect(String(param)).not.toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
        );
      }
    }

    const permissionInsert = runner.statements.find((s) =>
      s.sql.startsWith('INSERT INTO "IDENTITY_PERMISSIONS"'),
    );
    expect(permissionInsert?.params).toEqual([
      'ai:usage-read',
      'View organization AI usage and cost',
      'ai',
      'usage-read',
    ]);
  });
});

