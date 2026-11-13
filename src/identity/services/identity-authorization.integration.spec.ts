/**
 * Durable authorization coverage for IdentityService — real Postgres.
 *
 * WHY THIS EXISTS ALONGSIDE `identity.service.spec.ts`
 * The hermetic spec drives `hasPermission()` and `hasOrganizationPermission()`
 * through hand-built repository doubles, so all it can show is that the service
 * ASKS the right questions. The rules under test here are properties of the
 * persisted rows — an inactive role, an inactive permission, a DEACTIVATED
 * organization, a membership with a null role — and the only way to show the
 * service honours them is to write those rows and read the answer back from a
 * real database. Nothing below mocks a repository, EntityManager or
 * DataSource: the entities are the ones the application maps, and every
 * fixture row is deleted again in `afterAll`.
 *
 * WHAT IT DOES NOT COVER
 * The `membership.organization` guard is unreachable through persisted data:
 * `IDENTITY_USER_ORGANIZATIONS.organization_id` has a foreign key to
 * `TENANCY_ORGANIZATIONS`, so a membership whose organization row is missing
 * cannot exist. That constraint is asserted here (so the reasoning is checked
 * rather than assumed); the missing-relation branch itself stays covered by the
 * hermetic spec. The durable case that matters for authorization — a membership
 * in a DEACTIVATED organization — is covered here.
 *
 * RUNNING IT
 *   RUN_DB_INTEGRATION=1 DB_HOST=… DB_PORT=… DB_USERNAME=… DB_PASSWORD=… \
 *     DB_DATABASE=gym_verify_p005t2 \
 *     npx jest src/identity/services/identity-authorization.integration
 * The database must already be migrated, and jest does not load `.env`. Without
 * `RUN_DB_INTEGRATION=1` the whole block reports as SKIPPED.
 */
import 'reflect-metadata';
import { randomUUID } from 'crypto';
import { DataSource, In } from 'typeorm';
import { IdentityService } from './identity.service';
import { IdentityUser } from '../entities/identity-users.entity';
import { IdentityRole } from '../entities/identity-roles.entity';
import { IdentityPermission } from '../entities/identity-permissions.entity';
import { IdentityUserRole } from '../entities/identity-user-roles.entity';
import { IdentityRolePermission } from '../entities/identity-role-permissions.entity';
import { IdentityUserOrganization } from '../entities/identity-user-organizations.entity';
import { Organization } from '../../tenancy/entities/organization.entity';

const RUN = process.env.RUN_DB_INTEGRATION === '1';
const describeIntegration = RUN ? describe : describe.skip;

/** Fixture permission coordinates, unique so seeded application rows cannot interfere. */
const RESOURCE = 'p005-probe';
const READ = 'read';
const WRITE = 'write';
const OTHER_RESOURCE = 'p005-other-probe';

const REQUIRED_DB_ENV = [
  'DB_HOST',
  'DB_PORT',
  'DB_USERNAME',
  'DB_PASSWORD',
  'DB_DATABASE',
] as const;

/** Production database names that must never be targeted by integration tests. */
const FORBIDDEN_DATABASES = new Set(['gym_management']);

/**
 * Allowlist copied from `members.service.integration.spec.ts`: only an
 * explicitly named scratch/test database may be targeted, so a typo cannot
 * reach a real database.
 */
const ALLOWED_DATABASE_PATTERN =
  /^gym_(?:[a-z0-9]+_)*(?:scratch|gate|test|verify|ci)(?:_[a-z0-9]+)*$/i;

function requireDbConfig(): void {
  const missing = REQUIRED_DB_ENV.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    throw new Error(
      `[identity-authorization.integration.spec] RUN_DB_INTEGRATION=1 but required DB env vars are missing: ${missing.join(
        ', ',
      )}. Set DB_HOST, DB_PORT, DB_USERNAME, DB_PASSWORD and DB_DATABASE explicitly (no defaults).`,
    );
  }
}

function assertTestDatabase(database: string): void {
  if (FORBIDDEN_DATABASES.has(database)) {
    throw new Error(
      `[identity-authorization.integration.spec] Refusing to run integration tests against the production database '${database}'.`,
    );
  }
  if (!ALLOWED_DATABASE_PATTERN.test(database)) {
    throw new Error(
      `[identity-authorization.integration.spec] Refusing to run integration tests against database '${database}': ` +
        `it does not match the scratch/test allowlist ${ALLOWED_DATABASE_PATTERN}. Point DB_DATABASE at a dedicated scratch database (e.g. gym_verify_p005t2).`,
    );
  }
}

describeIntegration('IdentityService authorization (real Postgres)', () => {
  let dataSource: DataSource;
  let service: IdentityService;

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
      // Same glob as `src/data-source.ts`, so this spec cannot drift from the
      // entities the application actually maps.
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
      email: `p005-${tag}-${id}@authz-integration.test`,
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
      name: `p005-${tag}-${id.slice(0, 8)}`,
      description: `P0-05 integration fixture (${tag})`,
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
      description: 'P0-05 integration fixture',
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
      name: `P005 ${tag} ${id.slice(0, 8)}`,
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

  /** Second read: what the database actually stores, independent of the service. */
  async function readMembershipRow(
    userId: string,
    organizationId: string,
  ): Promise<IdentityUserOrganization | null> {
    return dataSource
      .getRepository(IdentityUserOrganization)
      .findOne({ where: { user_id: userId, organization_id: organizationId } });
  }

  async function readOrganization(id: string): Promise<Organization | null> {
    return dataSource.getRepository(Organization).findOne({ where: { id } });
  }

  // ------------------------------------------------- hasPermission (global)

  describe('hasPermission() against persisted global roles', () => {
    it('allows when an active role grants an active permission', async () => {
      const userId = await seedUser('global-allow');
      const roleId = await seedRole('global-allow');
      const permissionId = await seedPermission(RESOURCE, READ);
      await grantGlobalRole(userId, roleId);
      await linkPermission(roleId, permissionId);

      expect(await service.hasPermission(userId, RESOURCE, READ)).toBe(true);
    });

    it('denies when the only granting role is inactive', async () => {
      const userId = await seedUser('global-inactive-role');
      const roleId = await seedRole('global-inactive-role', false);
      const permissionId = await seedPermission(RESOURCE, READ);
      await grantGlobalRole(userId, roleId);
      await linkPermission(roleId, permissionId);

      // The row really is persisted and really is inactive.
      const storedRole = await dataSource
        .getRepository(IdentityRole)
        .findOne({ where: { id: roleId } });
      expect(storedRole?.is_active).toBe(false);

      expect(await service.hasPermission(userId, RESOURCE, READ)).toBe(false);
    });

    it('denies when the only granting permission is inactive', async () => {
      const userId = await seedUser('global-inactive-perm');
      const roleId = await seedRole('global-inactive-perm');
      const permissionId = await seedPermission(RESOURCE, READ, false);
      await grantGlobalRole(userId, roleId);
      await linkPermission(roleId, permissionId);

      const storedPermission = await dataSource
        .getRepository(IdentityPermission)
        .findOne({ where: { id: permissionId } });
      expect(storedPermission?.is_active).toBe(false);

      expect(await service.hasPermission(userId, RESOURCE, READ)).toBe(false);
    });

    it('denies when the role is active but grants no matching permission', async () => {
      const userId = await seedUser('global-missing-perm');
      const roleId = await seedRole('global-missing-perm');
      // A different permission exists and is linked — the required one does not.
      await linkPermission(roleId, await seedPermission(RESOURCE, WRITE));
      await grantGlobalRole(userId, roleId);

      expect(await service.hasPermission(userId, RESOURCE, READ)).toBe(false);
    });

    it('denies when the user has no roles at all', async () => {
      const userId = await seedUser('global-no-roles');

      expect(await service.hasPermission(userId, RESOURCE, READ)).toBe(false);
    });

    it('denies when the granting role is inactive even though another active role exists', async () => {
      const userId = await seedUser('global-mixed-roles');
      const inactiveRole = await seedRole('global-mixed-inactive', false);
      const activeRole = await seedRole('global-mixed-active');
      await grantGlobalRole(userId, inactiveRole);
      await grantGlobalRole(userId, activeRole);
      // Only the INACTIVE role carries the permission.
      await linkPermission(inactiveRole, await seedPermission(RESOURCE, READ));

      expect(await service.hasPermission(userId, RESOURCE, READ)).toBe(false);
    });

    it('matches resource and action exactly (unrelated coordinates do not authorize)', async () => {
      const userId = await seedUser('global-matching');
      const roleId = await seedRole('global-matching');
      const permissionId = await seedPermission(RESOURCE, READ);
      await grantGlobalRole(userId, roleId);
      await linkPermission(roleId, permissionId);

      expect(await service.hasPermission(userId, RESOURCE, READ)).toBe(true);
      // Same resource, different action.
      expect(await service.hasPermission(userId, RESOURCE, WRITE)).toBe(false);
      // Same action, different resource.
      expect(await service.hasPermission(userId, OTHER_RESOURCE, READ)).toBe(false);
    });
  });

  // ---------------------------------------- hasOrganizationPermission (tenant)

  describe('hasOrganizationPermission() organization activity', () => {
    it('allows when an active organization has an active membership, role and permission', async () => {
      const userId = await seedUser('org-allow');
      const orgId = await seedOrganization('org-allow');
      const roleId = await seedRole('org-allow');
      const permissionId = await seedPermission(RESOURCE, READ);
      await linkPermission(roleId, permissionId);
      await seedMembership(userId, orgId, roleId);

      expect(
        await service.hasOrganizationPermission(userId, orgId, RESOURCE, READ),
      ).toBe(true);
    });

    it('denies when the organization is deactivated', async () => {
      const userId = await seedUser('org-deactivated');
      const orgId = await seedOrganization('org-deactivated', false);
      const roleId = await seedRole('org-deactivated');
      await linkPermission(roleId, await seedPermission(RESOURCE, READ));
      await seedMembership(userId, orgId, roleId);

      const stored = await readOrganization(orgId);
      expect(stored?.is_active).toBe(false);

      expect(
        await service.hasOrganizationPermission(userId, orgId, RESOURCE, READ),
      ).toBe(false);
    });

    it('does not let an active membership, role and permission override a deactivated organization', async () => {
      // Same fixture, authorized first, then ONLY the organization is flipped —
      // everything downstream of it stays active, so a surviving `true` would
      // mean the organization state is not being read.
      const userId = await seedUser('org-flip');
      const orgId = await seedOrganization('org-flip');
      const roleId = await seedRole('org-flip');
      await linkPermission(roleId, await seedPermission(RESOURCE, READ));
      await seedMembership(userId, orgId, roleId);

      expect(
        await service.hasOrganizationPermission(userId, orgId, RESOURCE, READ),
      ).toBe(true);

      await dataSource
        .getRepository(Organization)
        .update({ id: orgId }, { is_active: false });

      const membership = await readMembershipRow(userId, orgId);
      expect(membership?.is_active).toBe(true);
      expect(membership?.role_id).toBe(roleId);
      expect(await readOrganization(orgId)).toMatchObject({ is_active: false });

      expect(
        await service.hasOrganizationPermission(userId, orgId, RESOURCE, READ),
      ).toBe(false);
    });

    it('cannot persist a membership without an organization (relation is guaranteed by the FK)', async () => {
      // The service's `membership.organization?.is_active !== true` branch is
      // defence-in-depth: with the FK in place a membership can never load
      // without its organization. Proving the constraint exists is the durable
      // half of that claim; the missing-relation branch itself is exercised by
      // the hermetic spec.
      const userId = await seedUser('org-fk');
      const orphanOrgId = randomUUID();

      await expect(
        dataSource.getRepository(IdentityUserOrganization).insert({
          user_id: userId,
          organization_id: orphanOrgId,
          role_id: null,
          is_active: true,
        }),
      ).rejects.toThrow(/foreign key|violates/i);
    });
  });

  describe('hasOrganizationPermission() membership', () => {
    it('denies when the user has no membership in the organization', async () => {
      const userId = await seedUser('member-missing');
      const orgId = await seedOrganization('member-missing');
      const roleId = await seedRole('member-missing');
      await linkPermission(roleId, await seedPermission(RESOURCE, READ));
      // Role and permission exist, but no membership row links the user to org.

      expect(
        await service.hasOrganizationPermission(userId, orgId, RESOURCE, READ),
      ).toBe(false);
    });

    it('denies when the membership is inactive', async () => {
      const userId = await seedUser('member-inactive');
      const orgId = await seedOrganization('member-inactive');
      const roleId = await seedRole('member-inactive');
      await linkPermission(roleId, await seedPermission(RESOURCE, READ));
      await seedMembership(userId, orgId, roleId, false);

      const membership = await readMembershipRow(userId, orgId);
      // Distinguishable from "missing": the row exists and is inactive.
      expect(membership).not.toBeNull();
      expect(membership?.is_active).toBe(false);

      expect(
        await service.hasOrganizationPermission(userId, orgId, RESOURCE, READ),
      ).toBe(false);
    });

    it('denies when the membership has a null role', async () => {
      const userId = await seedUser('member-null-role');
      const orgId = await seedOrganization('member-null-role');
      await seedMembership(userId, orgId, null);

      const membership = await readMembershipRow(userId, orgId);
      expect(membership).not.toBeNull();
      expect(membership?.role_id).toBeNull();

      expect(
        await service.hasOrganizationPermission(userId, orgId, RESOURCE, READ),
      ).toBe(false);
    });
  });

  describe('hasOrganizationPermission() role and permission', () => {
    it('denies when the organization role is inactive', async () => {
      const userId = await seedUser('role-inactive');
      const orgId = await seedOrganization('role-inactive');
      const roleId = await seedRole('role-inactive', false);
      await linkPermission(roleId, await seedPermission(RESOURCE, READ));
      await seedMembership(userId, orgId, roleId);

      const storedRole = await dataSource
        .getRepository(IdentityRole)
        .findOne({ where: { id: roleId } });
      expect(storedRole?.is_active).toBe(false);

      expect(
        await service.hasOrganizationPermission(userId, orgId, RESOURCE, READ),
      ).toBe(false);
    });

    it('denies when the organization role permission is inactive', async () => {
      const userId = await seedUser('perm-inactive');
      const orgId = await seedOrganization('perm-inactive');
      const roleId = await seedRole('perm-inactive');
      const permissionId = await seedPermission(RESOURCE, READ, false);
      await linkPermission(roleId, permissionId);
      await seedMembership(userId, orgId, roleId);

      const storedPermission = await dataSource
        .getRepository(IdentityPermission)
        .findOne({ where: { id: permissionId } });
      expect(storedPermission?.is_active).toBe(false);

      expect(
        await service.hasOrganizationPermission(userId, orgId, RESOURCE, READ),
      ).toBe(false);
    });

    it('denies when the organization role does not carry the required permission', async () => {
      const userId = await seedUser('perm-missing');
      const orgId = await seedOrganization('perm-missing');
      const roleId = await seedRole('perm-missing');
      // The role holds a DIFFERENT permission; the required one was never granted.
      await linkPermission(roleId, await seedPermission(RESOURCE, WRITE));
      await seedMembership(userId, orgId, roleId);

      expect(
        await service.hasOrganizationPermission(userId, orgId, RESOURCE, READ),
      ).toBe(false);
    });
  });

  describe('hasOrganizationPermission() organization isolation', () => {
    it('denies organization A when the user only belongs to organization B', async () => {
      const userId = await seedUser('iso-single');
      const orgA = await seedOrganization('iso-a');
      const orgB = await seedOrganization('iso-b');
      const roleB = await seedRole('iso-b');
      await linkPermission(roleB, await seedPermission(RESOURCE, READ));
      await seedMembership(userId, orgB, roleB);

      // Authorized in B...
      expect(
        await service.hasOrganizationPermission(userId, orgB, RESOURCE, READ),
      ).toBe(true);
      // ...and therefore refused in A, whose id the caller simply supplied.
      expect(
        await service.hasOrganizationPermission(userId, orgA, RESOURCE, READ),
      ).toBe(false);
    });

    it("never lets organization A's role authorize organization B", async () => {
      // The user is a member of both organizations, but only A's role grants the
      // permission. Asking about B must not reach A's role/permission rows.
      const userId = await seedUser('iso-both');
      const orgA = await seedOrganization('iso-both-a');
      const orgB = await seedOrganization('iso-both-b');
      const roleA = await seedRole('iso-both-a');
      await linkPermission(roleA, await seedPermission(RESOURCE, READ));
      const roleB = await seedRole('iso-both-b');
      await seedMembership(userId, orgA, roleA);
      await seedMembership(userId, orgB, roleB);

      expect(
        await service.hasOrganizationPermission(userId, orgA, RESOURCE, READ),
      ).toBe(true);
      expect(
        await service.hasOrganizationPermission(userId, orgB, RESOURCE, READ),
      ).toBe(false);
    });
  });

  describe('hasOrganizationPermission() has no global fallback', () => {
    it('denies when a global role grants the permission but the organization role does not', async () => {
      const userId = await seedUser('no-fallback-global');
      const orgId = await seedOrganization('no-fallback-global');
      const globalRole = await seedRole('no-fallback-global');
      await linkPermission(globalRole, await seedPermission(RESOURCE, READ));
      await grantGlobalRole(userId, globalRole);
      const orgRole = await seedRole('no-fallback-global-org');
      await seedMembership(userId, orgId, orgRole);

      // The global path says yes...
      expect(await service.hasPermission(userId, RESOURCE, READ)).toBe(true);
      // ...the tenant path must not borrow it.
      expect(
        await service.hasOrganizationPermission(userId, orgId, RESOURCE, READ),
      ).toBe(false);
    });

    it('allows when the organization role grants the permission and no global role does', async () => {
      const userId = await seedUser('no-fallback-org');
      const orgId = await seedOrganization('no-fallback-org');
      const orgRole = await seedRole('no-fallback-org');
      await linkPermission(orgRole, await seedPermission(RESOURCE, READ));
      await seedMembership(userId, orgId, orgRole);

      expect(await service.hasPermission(userId, RESOURCE, READ)).toBe(false);
      expect(
        await service.hasOrganizationPermission(userId, orgId, RESOURCE, READ),
      ).toBe(true);
    });
  });

  describe('isUserInOrganization() (the predicate the guard runs before RBAC)', () => {
    it('is true for an active membership and false for an inactive or absent one', async () => {
      const activeUser = await seedUser('isin-active');
      const inactiveUser = await seedUser('isin-inactive');
      const strangerUser = await seedUser('isin-absent');
      const orgId = await seedOrganization('isin');
      await seedMembership(activeUser, orgId, null, true);
      await seedMembership(inactiveUser, orgId, null, false);

      expect(await service.isUserInOrganization(activeUser, orgId)).toBe(true);
      expect(await service.isUserInOrganization(inactiveUser, orgId)).toBe(false);
      expect(await service.isUserInOrganization(strangerUser, orgId)).toBe(false);

      // The inactive membership still exists as a row: "inactive" is not "absent".
      expect(await readMembershipRow(inactiveUser, orgId)).not.toBeNull();
      expect(await readMembershipRow(strangerUser, orgId)).toBeNull();
    });
  });
});
