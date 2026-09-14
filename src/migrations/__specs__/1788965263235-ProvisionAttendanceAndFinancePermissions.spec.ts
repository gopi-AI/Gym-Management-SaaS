import { QueryRunner } from 'typeorm';
import {
  ATTENDANCE_PERMISSIONS,
  ATTENDANCE_PERMISSIONS_ROLE_NAME,
  ProvisionAttendancePermissions1788965263235,
} from '../1788965263235-ProvisionAttendancePermissions';
import {
  FINANCE_PERMISSIONS,
  FINANCE_PERMISSIONS_ROLE_NAME,
  ProvisionFinancePermissions1788965263236,
} from '../1788965263236-ProvisionFinancePermissions';

/**
 * Verification of the Phase 1 attendance + finance permission provisioning
 * migrations.
 *
 * This file lives in `src/migrations/__specs__/` on purpose: `src/migrations/*`
 * is loaded wholesale by the TypeORM CLI, while `jest` still finds this spec.
 *
 * The in-memory QueryRunner only understands the exact statements emitted by the
 * migrations, so the SELECT-then-INSERT idempotency logic and the down() cleanup
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

describe('Phase 1 attendance and finance permission migrations', () => {
  const asQueryRunner = (runner: FakeQueryRunner): QueryRunner => runner as unknown as QueryRunner;

  const attendanceMigration = () => new ProvisionAttendancePermissions1788965263235();
  const financeMigration = () => new ProvisionFinancePermissions1788965263236();

  it('declares the attendance permission triples required by the attendance controller', () => {
    expect(ATTENDANCE_PERMISSIONS.map((p) => `${p.resource}:${p.action}`)).toEqual([
      'attendance:read',
      'attendance:check-in',
      'attendance:check-out',
    ]);
    expect(ATTENDANCE_PERMISSIONS_ROLE_NAME).toBe('owner');
  });

  it('declares the finance permission triples required by the finance controllers', () => {
    expect(FINANCE_PERMISSIONS.map((p) => `${p.resource}:${p.action}`)).toEqual([
      'finance:read',
      'finance:create',
      'finance:update',
      'finance:record-payment',
    ]);
    expect(FINANCE_PERMISSIONS_ROLE_NAME).toBe('owner');
  });

  it('creates every attendance permission, the shared owner role and one association each', async () => {
    const runner = new FakeQueryRunner();

    await attendanceMigration().up(asQueryRunner(runner));

    expect(runner.roles.map((r) => r.name)).toEqual([ATTENDANCE_PERMISSIONS_ROLE_NAME]);
    expect(runner.permissions.map((p) => `${p.resource}:${p.action}`)).toEqual([
      'attendance:read',
      'attendance:check-in',
      'attendance:check-out',
    ]);
    expect(runner.rolePermissions).toHaveLength(ATTENDANCE_PERMISSIONS.length);
    expect(new Set(runner.rolePermissions.map((rp) => rp.permission_id)).size).toBe(
      ATTENDANCE_PERMISSIONS.length,
    );
  });

  it('creates every finance permission and links them to the same owner role', async () => {
    const runner = new FakeQueryRunner();

    await attendanceMigration().up(asQueryRunner(runner));
    await financeMigration().up(asQueryRunner(runner));

    // The second migration must REUSE the owner role created by the first.
    expect(runner.roles).toHaveLength(1);
    expect(runner.permissions).toHaveLength(
      ATTENDANCE_PERMISSIONS.length + FINANCE_PERMISSIONS.length,
    );
    expect(runner.rolePermissions).toHaveLength(
      ATTENDANCE_PERMISSIONS.length + FINANCE_PERMISSIONS.length,
    );
    expect(runner.permissions.filter((p) => p.resource === 'finance')).toHaveLength(4);
    expect(runner.permissions.filter((p) => p.resource === 'attendance')).toHaveLength(3);
  });

  it('is idempotent: re-running up() creates no duplicates', async () => {
    const runner = new FakeQueryRunner();

    await attendanceMigration().up(asQueryRunner(runner));
    await attendanceMigration().up(asQueryRunner(runner));
    await financeMigration().up(asQueryRunner(runner));
    await financeMigration().up(asQueryRunner(runner));

    expect(runner.roles).toHaveLength(1);
    expect(runner.permissions).toHaveLength(7);
    expect(runner.rolePermissions).toHaveLength(7);
  });

  it('down() removes only its own permissions and preserves the shared role', async () => {
    const runner = new FakeQueryRunner();
    await attendanceMigration().up(asQueryRunner(runner));
    await financeMigration().up(asQueryRunner(runner));

    await financeMigration().down(asQueryRunner(runner));

    expect(runner.permissions.map((p) => p.resource)).toEqual([
      'attendance',
      'attendance',
      'attendance',
    ]);
    // The owner role survives: it is a general RBAC role that may be in use by
    // unrelated grants.
    expect(runner.roles.map((r) => r.name)).toEqual([FINANCE_PERMISSIONS_ROLE_NAME]);
    expect(runner.rolePermissions).toHaveLength(ATTENDANCE_PERMISSIONS.length);
  });

  it('never hardcodes an identifier: every id comes from the database', async () => {
    const runner = new FakeQueryRunner();

    await attendanceMigration().up(asQueryRunner(runner));
    await financeMigration().up(asQueryRunner(runner));

    const inserts = runner.statements.filter((s) => s.sql.startsWith('INSERT'));
    // 1 role + 7 permissions + 7 associations.
    expect(inserts).toHaveLength(15);
    for (const statement of inserts) {
      const columnList = statement.sql.split('VALUES')[0];
      expect(columnList).not.toContain('"id"');
      for (const param of statement.params) {
        expect(String(param)).not.toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
        );
      }
    }
  });
});
