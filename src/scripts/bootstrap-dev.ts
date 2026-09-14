import 'reflect-metadata';
import * as dotenv from 'dotenv';
import { DataSource } from 'typeorm';
import { IdentityUser } from '../identity/entities/identity-users.entity';
import { IdentityRole } from '../identity/entities/identity-roles.entity';
import { IdentityPermission } from '../identity/entities/identity-permissions.entity';
import { IdentityUserRole } from '../identity/entities/identity-user-roles.entity';
import { IdentityRolePermission } from '../identity/entities/identity-role-permissions.entity';
import { IdentityUserOrganization } from '../identity/entities/identity-user-organizations.entity';
import { Organization } from '../tenancy/entities/organization.entity';

/**
 * DEVELOPMENT-ONLY bootstrap/seed script.
 *
 * Establishes the minimum valid authorization graph so the existing
 * authenticated application can be exercised against a fresh local database:
 *
 *   user (test2@example.com)
 *     -> active organization membership (Development Gym)
 *     -> owner role (via IDENTITY_USER_ROLES)
 *     -> role permissions (via IDENTITY_ROLE_PERMISSIONS)
 *
 * This script is EXPLICITLY invoked (npm run bootstrap:dev). It is NOT wired
 * into application startup, module initialization, migrations, or any request
 * path. It does not bypass, weaken, or restructure any authentication,
 * tenant-isolation, RBAC, JWT, MFA, or Redis-blacklist logic — it only inserts
 * legitimate reference/development rows that the existing security model then
 * authorizes normally.
 *
 * Idempotency: every step looks up existing rows by stable criteria and reuses
 * them; nothing is inserted blindly and no constraint errors are relied upon.
 */

// Load environment. The script runs on the HOST (not inside the docker
// `api` container), so the database/redis hostnames must resolve to localhost.
dotenv.config({ path: ['.env.local', '.env'] });

const DB_HOST = process.env.DB_HOST === 'postgres' ? 'localhost' : process.env.DB_HOST || 'localhost';
const DB_PORT = parseInt(process.env.DB_PORT || '5432', 10);
const DB_USERNAME = process.env.DB_USERNAME || 'postgres';
const DB_PASSWORD = process.env.DB_PASSWORD || 'postgres';
const DB_DATABASE = process.env.DB_DATABASE || 'gym_management';

const DEV_USER_EMAIL = 'test2@example.com';
const DEV_ORG_NAME = 'Development Gym';
const OWNER_ROLE_NAME = 'owner';

/**
 * Canonical permissions enforced by the CURRENT implemented API. Derived from
 * the `@RequirePermissions` decorators on the existing controllers — nothing
 * more, nothing less.
 */
const PERMISSIONS: Array<{ name: string; description: string; resource: string; action: string }> = [
  { name: 'organization:read', description: 'Read organizations', resource: 'organization', action: 'read' },
  { name: 'organization:create', description: 'Create organizations', resource: 'organization', action: 'create' },
  { name: 'organization:update', description: 'Update organizations', resource: 'organization', action: 'update' },
  { name: 'branch:read', description: 'Read branches', resource: 'branch', action: 'read' },
  { name: 'branch:create', description: 'Create branches', resource: 'branch', action: 'create' },
  { name: 'branch:update', description: 'Update branches', resource: 'branch', action: 'update' },
  { name: 'tenant-settings:read', description: 'Read tenant settings', resource: 'tenant-settings', action: 'read' },
  { name: 'tenant-settings:create', description: 'Create tenant settings', resource: 'tenant-settings', action: 'create' },
  { name: 'tenant-settings:update', description: 'Update tenant settings', resource: 'tenant-settings', action: 'update' },
  { name: 'membership-plan:read', description: 'Read membership plans', resource: 'membership-plan', action: 'read' },
  { name: 'membership-plan:create', description: 'Create membership plans', resource: 'membership-plan', action: 'create' },
  { name: 'membership-plan:update', description: 'Update membership plans', resource: 'membership-plan', action: 'update' },
  { name: 'membership:read', description: 'Read memberships', resource: 'membership', action: 'read' },
  { name: 'membership:create', description: 'Create memberships', resource: 'membership', action: 'create' },
  { name: 'membership:update', description: 'Update memberships', resource: 'membership', action: 'update' },
  { name: 'membership:pause', description: 'Pause memberships', resource: 'membership', action: 'pause' },
  { name: 'membership:resume', description: 'Resume memberships', resource: 'membership', action: 'resume' },
  { name: 'membership:freeze', description: 'Freeze memberships', resource: 'membership', action: 'freeze' },
  { name: 'membership:unfreeze', description: 'Unfreeze memberships', resource: 'membership', action: 'unfreeze' },
  { name: 'membership:cancel', description: 'Cancel memberships', resource: 'membership', action: 'cancel' },
  { name: 'attendance:read', description: 'Read attendance records and access decisions', resource: 'attendance', action: 'read' },
  { name: 'attendance:check-in', description: 'Check members in', resource: 'attendance', action: 'check-in' },
  { name: 'attendance:check-out', description: 'Check members out', resource: 'attendance', action: 'check-out' },
  { name: 'finance:read', description: 'Read invoices and payments', resource: 'finance', action: 'read' },
  { name: 'finance:create', description: 'Create invoices', resource: 'finance', action: 'create' },
  { name: 'finance:update', description: 'Void invoices', resource: 'finance', action: 'update' },
  { name: 'finance:record-payment', description: 'Record payments against invoices', resource: 'finance', action: 'record-payment' },
  { name: 'ai:retention-analysis', description: 'Run AI retention analysis', resource: 'ai', action: 'retention-analysis' },
  { name: 'ai:plan-performance', description: 'Run AI membership plan performance analysis', resource: 'ai', action: 'plan-performance' },
  { name: 'ai:usage-read', description: 'View organization AI usage and cost', resource: 'ai', action: 'usage-read' },
];

async function main(): Promise<void> {
  const dataSource = new DataSource({
    type: 'postgres',
    host: DB_HOST,
    port: DB_PORT,
    username: DB_USERNAME,
    password: DB_PASSWORD,
    database: DB_DATABASE,
    entities: [
      IdentityUser,
      IdentityRole,
      IdentityPermission,
      IdentityUserRole,
      IdentityRolePermission,
      IdentityUserOrganization,
      Organization,
    ],
    synchronize: false,
  });

  await dataSource.initialize();
  console.log(`[bootstrap:dev] Connected to ${DB_HOST}:${DB_PORT}/${DB_DATABASE}`);

  try {
    const userRepo = dataSource.getRepository(IdentityUser);
    const roleRepo = dataSource.getRepository(IdentityRole);
    const permissionRepo = dataSource.getRepository(IdentityPermission);
    const userRoleRepo = dataSource.getRepository(IdentityUserRole);
    const rolePermissionRepo = dataSource.getRepository(IdentityRolePermission);
    const userOrgRepo = dataSource.getRepository(IdentityUserOrganization);
    const orgRepo = dataSource.getRepository(Organization);

    // 1. Canonical permissions (idempotent by resource+action).
    const permissionIds = new Map<string, string>();
    for (const p of PERMISSIONS) {
      let existing = await permissionRepo.findOne({
        where: { resource: p.resource, action: p.action },
      });
      if (!existing) {
        existing = await permissionRepo.save(permissionRepo.create(p));
        console.log(`[bootstrap:dev] created permission ${p.resource}:${p.action}`);
      } else {
        console.log(`[bootstrap:dev] reused permission ${p.resource}:${p.action}`);
      }
      permissionIds.set(`${p.resource}:${p.action}`, existing.id);
    }

    // 2. Canonical owner role (idempotent by name).
    let ownerRole = await roleRepo.findOne({ where: { name: OWNER_ROLE_NAME } });
    if (!ownerRole) {
      ownerRole = await roleRepo.save(
        roleRepo.create({
          name: OWNER_ROLE_NAME,
          description: 'Development owner role (bootstrap)',
          is_active: true,
        }),
      );
      console.log(`[bootstrap:dev] created role ${OWNER_ROLE_NAME}`);
    } else {
      console.log(`[bootstrap:dev] reused role ${OWNER_ROLE_NAME}`);
    }

    // 3. Role -> permission links (idempotent by role_id+permission_id).
    for (const p of PERMISSIONS) {
      const permissionId = permissionIds.get(`${p.resource}:${p.action}`)!;
      const existingLink = await rolePermissionRepo.findOne({
        where: { role_id: ownerRole.id, permission_id: permissionId },
      });
      if (!existingLink) {
        await rolePermissionRepo.save(
          rolePermissionRepo.create({ role_id: ownerRole.id, permission_id: permissionId }),
        );
        console.log(`[bootstrap:dev] linked ${OWNER_ROLE_NAME} -> ${p.resource}:${p.action}`);
      } else {
        console.log(`[bootstrap:dev] reused link ${OWNER_ROLE_NAME} -> ${p.resource}:${p.action}`);
      }
    }

    // 4. Development organization (idempotent by name).
    let devOrg = await orgRepo.findOne({ where: { name: DEV_ORG_NAME } });
    if (!devOrg) {
      devOrg = await orgRepo.save(
        orgRepo.create({
          name: DEV_ORG_NAME,
          timezone: 'UTC',
          locale: 'en-US',
          currency: 'USD',
          is_active: true,
        }),
      );
      console.log(`[bootstrap:dev] created organization ${DEV_ORG_NAME}`);
    } else {
      console.log(`[bootstrap:dev] reused organization ${DEV_ORG_NAME}`);
    }

    // 5. Development user (must already exist; do NOT create a new privileged
    //    account with a hardcoded password).
    const devUser = await userRepo.findOne({ where: { email: DEV_USER_EMAIL } });
    if (!devUser) {
      throw new Error(
        `[bootstrap:dev] user ${DEV_USER_EMAIL} not found. Register it first via POST /v1/auth/register.`,
      );
    }
    console.log(`[bootstrap:dev] using existing user ${DEV_USER_EMAIL}`);

    // 6. User -> role link (idempotent by user_id+role_id; no unique constraint
    //    exists on IDENTITY_USER_ROLES, so check explicitly).
    const existingUserRole = await userRoleRepo.findOne({
      where: { user_id: devUser.id, role_id: ownerRole.id },
    });
    if (!existingUserRole) {
      await userRoleRepo.save(
        userRoleRepo.create({ user_id: devUser.id, role_id: ownerRole.id }),
      );
      console.log(`[bootstrap:dev] linked user ${DEV_USER_EMAIL} -> role ${OWNER_ROLE_NAME}`);
    } else {
      console.log(`[bootstrap:dev] reused user-role link ${DEV_USER_EMAIL} -> ${OWNER_ROLE_NAME}`);
    }

    // 7. User -> organization membership (idempotent by unique
    //    (user_id, organization_id); reuse existing row and ensure it is active
    //    and references the owner role).
    const existingMembership = await userOrgRepo.findOne({
      where: { user_id: devUser.id, organization_id: devOrg.id },
    });
    if (!existingMembership) {
      await userOrgRepo.save(
        userOrgRepo.create({
          user_id: devUser.id,
          organization_id: devOrg.id,
          role_id: ownerRole.id,
          is_active: true,
        }),
      );
      console.log(`[bootstrap:dev] created membership ${DEV_USER_EMAIL} -> ${DEV_ORG_NAME}`);
    } else {
      // Reuse the row; reconcile role_id/is_active to the canonical state.
      if (existingMembership.role_id !== ownerRole.id || existingMembership.is_active !== true) {
        await userOrgRepo.update(existingMembership.id, {
          role_id: ownerRole.id,
          is_active: true,
        });
        console.log(`[bootstrap:dev] reconciled membership ${DEV_USER_EMAIL} -> ${DEV_ORG_NAME}`);
      } else {
        console.log(`[bootstrap:dev] reused membership ${DEV_USER_EMAIL} -> ${DEV_ORG_NAME}`);
      }
    }

    console.log('[bootstrap:dev] DONE');
  } finally {
    await dataSource.destroy();
  }
}

main().catch((err) => {
  console.error('[bootstrap:dev] FAILED:', err);
  process.exit(1);
});
