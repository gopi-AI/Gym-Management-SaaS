import { QueryRunner } from 'typeorm';
import {
  REPORT_PERMISSIONS,
  REPORT_PERMISSIONS_ROLE_NAME,
  ProvisionReportPermissions1788965263404,
} from '../1788965263404-ProvisionReportPermissions';

/**
 * Verification of the Phase 6 report permission provisioning migration.
 *
 * This file lives in `src/migrations/__specs__/` on purpose: `src/migrations/*`
 * is loaded wholesale by the TypeORM CLI, while `jest` still finds this spec.
 *
 * The in-memory QueryRunner only understands the exact statements emitted by the
 * migration, so the SELECT-then-INSERT idempotency logic and the down() cleanup
 * are exercised for real (a "returns canned rows" mock would not detect duplicate
 * inserts or an over-broad DELETE).
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

describe('Phase 6 report permission migration', () => {
  const asQueryRunner = (runner: FakeQueryRunner): QueryRunner => runner as unknown as QueryRunner;

  const migration = () => new ProvisionReportPermissions1788965263404();

  it('declares exactly the report permission triples the piece-1 routes require', () => {
    // §9.1's four CRUD/run permissions. `report:export` and `dashboard:view` are
    // deliberately absent: no route consumes them yet (P6-04 needs P6-36's bucket,
    // P6-08 does not exist).
    expect(REPORT_PERMISSIONS.map((p) => `${p.resource}:${p.action}`)).toEqual([
      'report:view',
      'report:create',
      'report:edit',
      'report:delete',
    ]);
    expect(REPORT_PERMISSIONS_ROLE_NAME).toBe('owner');
  });

  it('creates every report permission, the shared owner role and one association each', async () => {
    const runner = new FakeQueryRunner();

    await migration().up(asQueryRunner(runner));

    expect(runner.roles.map((r) => r.name)).toEqual([REPORT_PERMISSIONS_ROLE_NAME]);
    expect(runner.permissions.map((p) => `${p.resource}:${p.action}`)).toEqual([
      'report:view',
      'report:create',
      'report:edit',
      'report:delete',
    ]);
    expect(runner.permissions.every((p) => p.is_active)).toBe(true);
    expect(runner.rolePermissions).toHaveLength(REPORT_PERMISSIONS.length);
  });

  it('is idempotent: re-running up() creates no duplicates', async () => {
    const runner = new FakeQueryRunner();

    await migration().up(asQueryRunner(runner));
    await migration().up(asQueryRunner(runner));

    expect(runner.roles).toHaveLength(1);
    expect(runner.permissions).toHaveLength(REPORT_PERMISSIONS.length);
    expect(runner.rolePermissions).toHaveLength(REPORT_PERMISSIONS.length);
  });

  it('reuses an owner role that already exists rather than creating a second one', async () => {
    const runner = new FakeQueryRunner();
    runner.roles.push({
      id: 'role-existing',
      name: 'owner',
      description: 'Owner role',
      is_active: true,
    });

    await migration().up(asQueryRunner(runner));

    expect(runner.roles).toHaveLength(1);
    expect(runner.rolePermissions.every((rp) => rp.role_id === 'role-existing')).toBe(true);
  });

  it('down() removes only its own permissions and preserves the shared role', async () => {
    const runner = new FakeQueryRunner();
    await migration().up(asQueryRunner(runner));

    await migration().down(asQueryRunner(runner));

    expect(runner.permissions).toHaveLength(0);
    expect(runner.rolePermissions).toHaveLength(0);
    // The owner role survives: it is a general RBAC role that may be in use by
    // unrelated grants.
    expect(runner.roles.map((r) => r.name)).toEqual([REPORT_PERMISSIONS_ROLE_NAME]);
  });

  it('never hardcodes an identifier: every id comes from the database', async () => {
    const runner = new FakeQueryRunner();

    await migration().up(asQueryRunner(runner));

    const inserts = runner.statements.filter((s) => s.sql.startsWith('INSERT'));
    // 1 role + 4 permissions + 4 associations.
    expect(inserts).toHaveLength(9);
    for (const statement of inserts) {
      for (const param of statement.params) {
        expect(String(param)).not.toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
        );
      }
    }
  });
});
