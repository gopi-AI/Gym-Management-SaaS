import { ProvisionMeasurementPermissions1788965263238 } from '../1788965263238-ProvisionMeasurementPermissions';

/** Stateful stand-in for the query runner, mirroring the pattern in the repo's<br>other migration specs (e.g. `ProvisionLoyaltyPermission.spec.ts`).<br>The migration's `up()` is idempotent because each `ensure*` helper SELECTs before it<br>INSERTs; the fake keeps inserted rows so re-running `up()` is proven to be a no-op. */
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

    // INSERT checks first — the INSERT statements also contain the substring
    // `FROM "IDENTITY_PERMISSIONS"` / `FROM "IDENTITY_ROLES"`, so a SELECT-first
    // ordering would silently swallow the branch the INSERT belongs to.
    if (sql.includes('INSERT INTO "IDENTITY_ROLES"')) {
      const id = `role-${++this.seq}`;
      this.roles.push({ id, name: args[0] });
      return [{ id }];
    }
    if (sql.includes('INSERT INTO "IDENTITY_PERMISSIONS"')) {
      const [name, description, resource, action] = args;
      // Simulate the migration's SELECT-first guard: the real code SELECTs before
      // inserting, and only INSERTs when no row exists. The fake mirrors that by
      // returning the existing permission when one is already present, and letting
      // the INSERT proceed only on the first call.
      const existing = this.permissions.find(
        (p) => p.resource === resource && p.action === action,
      );
      if (!existing) {
        const id = `permission-${++this.seq}`;
        this.permissions.push({ id, name, description, resource, action, is_active: true });
        return [{ id }];
      }
      // Already present — the guard returned the existing row; no insert.
      return [];
    }
    if (sql.includes('INSERT INTO "IDENTITY_ROLE_PERMISSIONS"')) {
      const [roleId, permissionId] = args;
      // Simulate ensureRolePermission's SELECT-first guard: only insert the link when
      // the (role_id, permission_id) pair does not already exist.
      const alreadyLinked = this.rolePermissions.some(
        (rp) => rp.role_id === roleId && rp.permission_id === permissionId,
      );
      if (!alreadyLinked) {
        this.rolePermissions.push({ role_id: roleId, permission_id: permissionId });
      }
      return [];
    }
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
    if (sql.includes('FROM "IDENTITY_PERMISSIONS"')) {
      return this.permissions
        .filter((p) => p.resource === args[0] && p.action === args[1])
        .map((p) => ({ id: p.id }));
    }
    if (sql.includes('SELECT')) {
      // Any SELECT is a guard; return empty rows so the insert proceeds.
      return [];
    }
    throw new Error(`Unhandled SQL in spec: ${sql}`);
  }
}

describe('ProvisionMeasurementPermissions migration', () => {
  it('seeds measurement:create and measurement:read on the owner role on first run', async () => {
    const migration = new ProvisionMeasurementPermissions1788965263238();
    const queryRunner = new FakeRunner({ withOwnerRole: true });

    await migration.up(queryRunner as never);

    const permissionNames = queryRunner.permissions.map((p) => p.name);
    expect(permissionNames).toContain('measurement:create');
    expect(permissionNames).toContain('measurement:read');
    expect(queryRunner.rolePermissions).toHaveLength(2);
  });

  it('is idempotent on re-run: second up() does not duplicate rows', async () => {
    const migration = new ProvisionMeasurementPermissions1788965263238();
    const queryRunner = new FakeRunner({ withOwnerRole: true });

    await migration.up(queryRunner as never);

    const permissionCountAfterFirst = queryRunner.permissions.length;
    const rolePermissionCountAfterFirst = queryRunner.rolePermissions.length;

    await migration.up(queryRunner as never);

    const permissionCountAfterSecond = queryRunner.permissions.length;
    const rolePermissionCountAfterSecond = queryRunner.rolePermissions.length;

    // Row counts must not increase: second run adds nothing, so duplicates are impossible.
    expect(permissionCountAfterSecond).toBe(permissionCountAfterFirst);
    expect(rolePermissionCountAfterSecond).toBe(rolePermissionCountAfterFirst);
    expect(permissionCountAfterFirst).toBe(2);
    expect(rolePermissionCountAfterFirst).toBe(2);
  });

  it('down() removes only the measurement permissions, plus their role links', async () => {
    const migration = new ProvisionMeasurementPermissions1788965263238();
    const queryRunner = new FakeRunner({ withOwnerRole: true });

    await migration.up(queryRunner as never);
    const permissionCountBefore = queryRunner.permissions.length;
    const rolePermissionCountBefore = queryRunner.rolePermissions.length;

    await migration.down(queryRunner as never);

    expect(queryRunner.permissions.length).toBe(permissionCountBefore - 2);
    expect(queryRunner.rolePermissions.length).toBe(rolePermissionCountBefore - 2);
  });
});
