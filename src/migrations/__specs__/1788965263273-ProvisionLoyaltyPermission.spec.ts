import * as fs from 'fs';
import * as path from 'path';
import { ProvisionLoyaltyPermission1788965263273 } from '../1788965263273-ProvisionLoyaltyPermission';

/**
 * A stateful stand-in for the query runner, rather than a call recorder.
 *
 * The migration's `up()` is idempotent because each `ensure*` helper SELECTs
 * before it INSERTs. A fake that returns canned rows cannot show that: it would
 * report the same "one insert" whether or not the SELECT guard worked. This fake
 * keeps the rows, so calling `up()` twice and finding one permission and one
 * link is evidence the guard actually held.
 */
class FakeRunner {
  readonly calls: Array<{ sql: string; parameters?: unknown[] }> = [];
  readonly roles: Array<{ id: string; name: string }> = [];
  readonly permissions: Array<{
    id: string;
    name: string;
    description: string;
    resource: string;
    action: string;
    is_active: boolean;
  }> = [];
  readonly rolePermissions: Array<{ role_id: string; permission_id: string }> = [];
  private seq = 0;

  constructor({ withOwnerRole = true }: { withOwnerRole?: boolean } = {}) {
    if (withOwnerRole) {
      this.roles.push({ id: 'role-owner', name: 'owner' });
    }
  }

  async query(sql: string, parameters?: unknown[]): Promise<unknown> {
    this.calls.push({ sql, parameters });
    const args = (parameters ?? []) as string[];

    // The DELETE checks must come first: `DELETE FROM "IDENTITY_ROLE_PERMISSIONS"`
    // contains the substring `FROM "IDENTITY_ROLE_PERMISSIONS"`, so a SELECT-first
    // ordering silently swallows the unlink and reports a false idempotency pass.
    if (sql.includes('DELETE FROM "IDENTITY_ROLE_PERMISSIONS"')) {
      const [roleName, resource, action] = args;
      const roleIds = this.roles.filter((r) => r.name === roleName).map((r) => r.id);
      const permissionIds = this.permissions
        .filter((p) => p.resource === resource && p.action === action)
        .map((p) => p.id);
      for (let i = this.rolePermissions.length - 1; i >= 0; i -= 1) {
        const rp = this.rolePermissions[i];
        if (roleIds.includes(rp.role_id) && permissionIds.includes(rp.permission_id)) {
          this.rolePermissions.splice(i, 1);
        }
      }
      return [];
    }
    if (sql.includes('DELETE FROM "IDENTITY_PERMISSIONS"')) {
      const [resource, action] = args;
      for (let i = this.permissions.length - 1; i >= 0; i -= 1) {
        const p = this.permissions[i];
        if (p.resource === resource && p.action === action) {
          this.permissions.splice(i, 1);
        }
      }
      return [];
    }
    if (sql.includes('FROM "IDENTITY_ROLES"')) {
      return this.roles.filter((r) => r.name === args[0]).map((r) => ({ id: r.id }));
    }
    if (sql.includes('INSERT INTO "IDENTITY_ROLES"')) {
      const id = `role-${++this.seq}`;
      this.roles.push({ id, name: args[0] });
      return [{ id }];
    }
    if (sql.includes('FROM "IDENTITY_PERMISSIONS"')) {
      return this.permissions
        .filter((p) => p.resource === args[0] && p.action === args[1])
        .map((p) => ({ id: p.id }));
    }
    if (sql.includes('INSERT INTO "IDENTITY_PERMISSIONS"')) {
      const [name, description, resource, action] = args;
      const id = `permission-${++this.seq}`;
      this.permissions.push({ id, name, description, resource, action, is_active: true });
      return [{ id }];
    }
    if (sql.includes('FROM "IDENTITY_ROLE_PERMISSIONS"')) {
      const [roleId, permissionId] = args;
      return this.rolePermissions
        .filter((rp) => rp.role_id === roleId && rp.permission_id === permissionId)
        .map((_, index) => ({ id: `role-permission-${index}` }));
    }
    if (sql.includes('INSERT INTO "IDENTITY_ROLE_PERMISSIONS"')) {
      const [role_id, permission_id] = args;
      this.rolePermissions.push({ role_id, permission_id });
      return [];
    }
    throw new Error(`FakeRunner: unhandled SQL: ${sql}`);
  }
}

describe('ProvisionLoyaltyPermission migration', () => {
  it('provisions the exact loyalty:read authority the route decorator requires', async () => {
    const runner = new FakeRunner();
    await new ProvisionLoyaltyPermission1788965263273().up(runner as never);

    // The decorator is `{ resource: 'loyalty', action: 'read' }`; `hasPermission`
    // matches on exactly those two columns plus `is_active`.
    expect(runner.permissions).toEqual([
      {
        id: expect.any(String),
        name: 'loyalty:read',
        description: 'View loyalty account and point transactions',
        resource: 'loyalty',
        action: 'read',
        is_active: true,
      },
    ]);

    const insert = runner.calls.find((call) =>
      call.sql.includes('INSERT INTO "IDENTITY_PERMISSIONS"'),
    );
    expect(insert?.parameters).toEqual([
      'loyalty:read',
      'View loyalty account and point transactions',
      'loyalty',
      'read',
    ]);

    // Granted to the same single role the workout and diet baselines use.
    expect(runner.roles.map((r) => r.name)).toEqual(['owner']);
    expect(runner.rolePermissions).toEqual([
      { role_id: 'role-owner', permission_id: runner.permissions[0].id },
    ]);
  });

  it('is idempotent: a second up() adds no duplicate permission or link', async () => {
    const runner = new FakeRunner();
    const migration = new ProvisionLoyaltyPermission1788965263273();

    await migration.up(runner as never);
    await migration.up(runner as never);

    expect(runner.permissions).toHaveLength(1);
    expect(runner.rolePermissions).toHaveLength(1);
    expect(
      runner.calls.filter((call) => call.sql.includes('INSERT INTO "IDENTITY_PERMISSIONS"')),
    ).toHaveLength(1);
    expect(
      runner.calls.filter((call) =>
        call.sql.includes('INSERT INTO "IDENTITY_ROLE_PERMISSIONS"'),
      ),
    ).toHaveLength(1);
    expect(runner.roles).toHaveLength(1);
  });

  it('creates the owner role when it is absent and links the permission to it', async () => {
    const runner = new FakeRunner({ withOwnerRole: false });
    await new ProvisionLoyaltyPermission1788965263273().up(runner as never);

    expect(runner.roles).toEqual([{ id: expect.any(String), name: 'owner' }]);
    expect(runner.rolePermissions).toEqual([
      { role_id: runner.roles[0].id, permission_id: runner.permissions[0].id },
    ]);
  });

  it('down() removes the link and then the permission', async () => {
    const runner = new FakeRunner();
    const migration = new ProvisionLoyaltyPermission1788965263273();

    await migration.up(runner as never);
    expect(runner.permissions).toHaveLength(1);

    await migration.down(runner as never);

    expect(runner.rolePermissions).toEqual([]);
    expect(runner.permissions).toEqual([]);

    const unlink = runner.calls.find((call) =>
      call.sql.includes('DELETE FROM "IDENTITY_ROLE_PERMISSIONS"'),
    );
    expect(unlink?.parameters).toEqual(['owner', 'loyalty', 'read']);
    const remove = runner.calls.find((call) =>
      call.sql.includes('DELETE FROM "IDENTITY_PERMISSIONS"'),
    );
    expect(remove?.parameters).toEqual(['loyalty', 'read']);
  });

  it('is registered as a concrete migration class, never as a top-level function export', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '..', '1788965263273-ProvisionLoyaltyPermission.ts'),
      'utf8',
    );
    expect(source).toMatch(/export class ProvisionLoyaltyPermission1788965263273/);
    expect(source).not.toMatch(/^export function /m);
    expect(source.match(/^\s*export\s+class\s+\w+/gm) ?? []).toHaveLength(1);
  });
});
