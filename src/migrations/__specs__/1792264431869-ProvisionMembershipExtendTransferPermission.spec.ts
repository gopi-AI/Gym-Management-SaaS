import * as fs from 'fs';
import * as path from 'path';
import { ProvisionMembershipExtendTransferPermission1792264431869 } from '../1792264431869-ProvisionMembershipExtendTransferPermission';

/**
 * A stateful stand-in for the query runner, rather than a call recorder.
 *
 * The migration's `up()` is idempotent because each `ensure*` helper SELECTs
 * before it INSERTs. This fake keeps the rows, so calling `up()` twice and
 * finding exactly two permissions and two links is evidence the guards held.
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

    // Delete checks must come first: the role-permission DELETE contains
    // `FROM "IDENTITY_ROLE_PERMISSIONS"`, so a SELECT-first ordering would
    // swallow the unlink and report a false idempotency pass.
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

describe('ProvisionMembershipExtendTransferPermission migration', () => {
  it('provisions the exact extend and transfer authorities the routes require', async () => {
    const runner = new FakeRunner();
    await new ProvisionMembershipExtendTransferPermission1792264431869().up(
      runner as never,
    );

    // The decorators are `{ resource: 'membership', action: 'extend' }` and
    // `{ resource: 'membership', action: 'transfer' }`; `hasPermission` matches
    // on exactly those two columns plus `is_active`.
    expect(runner.permissions).toEqual([
      {
        id: expect.any(String),
        name: 'membership:extend',
        description: 'Extend memberships',
        resource: 'membership',
        action: 'extend',
        is_active: true,
      },
      {
        id: expect.any(String),
        name: 'membership:transfer',
        description: 'Transfer memberships',
        resource: 'membership',
        action: 'transfer',
        is_active: true,
      },
    ]);

    const inserts = runner.calls.filter((call) =>
      call.sql.includes('INSERT INTO "IDENTITY_PERMISSIONS"'),
    );
    expect(inserts.map((call) => call.parameters)).toEqual([
      ['membership:extend', 'Extend memberships', 'membership', 'extend'],
      ['membership:transfer', 'Transfer memberships', 'membership', 'transfer'],
    ]);

    // Granted to the same single role the other provisioning migrations use.
    expect(runner.roles.map((r) => r.name)).toEqual(['owner']);
    expect(runner.rolePermissions).toEqual([
      { role_id: 'role-owner', permission_id: runner.permissions[0].id },
      { role_id: 'role-owner', permission_id: runner.permissions[1].id },
    ]);
  });

  it('is idempotent: a second up() adds no duplicate permission or link', async () => {
    const runner = new FakeRunner();
    const migration = new ProvisionMembershipExtendTransferPermission1792264431869();

    await migration.up(runner as never);
    await migration.up(runner as never);

    expect(runner.permissions).toHaveLength(2);
    expect(runner.rolePermissions).toHaveLength(2);
    expect(
      runner.calls.filter((call) => call.sql.includes('INSERT INTO "IDENTITY_PERMISSIONS"')),
    ).toHaveLength(2);
    expect(
      runner.calls.filter((call) =>
        call.sql.includes('INSERT INTO "IDENTITY_ROLE_PERMISSIONS"'),
      ),
    ).toHaveLength(2);
    expect(runner.roles).toHaveLength(1);
  });

  it('creates the owner role when it is absent and links both permissions to it', async () => {
    const runner = new FakeRunner({ withOwnerRole: false });
    await new ProvisionMembershipExtendTransferPermission1792264431869().up(
      runner as never,
    );

    expect(runner.roles).toEqual([{ id: expect.any(String), name: 'owner' }]);
    expect(runner.rolePermissions).toEqual([
      { role_id: runner.roles[0].id, permission_id: runner.permissions[0].id },
      { role_id: runner.roles[0].id, permission_id: runner.permissions[1].id },
    ]);
  });

  it('down() removes both links and then both permissions', async () => {
    const runner = new FakeRunner();
    const migration = new ProvisionMembershipExtendTransferPermission1792264431869();

    await migration.up(runner as never);
    expect(runner.permissions).toHaveLength(2);

    await migration.down(runner as never);

    expect(runner.rolePermissions).toEqual([]);
    expect(runner.permissions).toEqual([]);

    const unlinks = runner.calls.filter((call) =>
      call.sql.includes('DELETE FROM "IDENTITY_ROLE_PERMISSIONS"'),
    );
    expect(unlinks.map((call) => call.parameters)).toEqual([
      ['owner', 'membership', 'extend'],
      ['owner', 'membership', 'transfer'],
    ]);
    const removes = runner.calls.filter((call) =>
      call.sql.includes('DELETE FROM "IDENTITY_PERMISSIONS"'),
    );
    expect(removes.map((call) => call.parameters)).toEqual([
      ['membership', 'extend'],
      ['membership', 'transfer'],
    ]);
  });

  it('is registered as a concrete migration class, never as a top-level function export', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '..', '1792264431869-ProvisionMembershipExtendTransferPermission.ts'),
      'utf8',
    );
    expect(source).toMatch(
      /export class ProvisionMembershipExtendTransferPermission1792264431869/,
    );
    expect(source).not.toMatch(/^export function /m);
    expect(source.match(/^\s*export\s+class\s+\w+/gm) ?? []).toHaveLength(1);
  });
});
