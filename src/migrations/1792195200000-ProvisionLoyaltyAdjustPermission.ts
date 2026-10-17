import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * P2-08 — Provision the `loyalty:adjust` authority for the manual adjustment
 * route.
 *
 * Route layer: `src/loyalty/controllers/points.controller.ts` guards
 * `POST /v1/members/:memberId/points/adjust` with
 * `@RequirePermissions({ resource: 'loyalty', action: 'adjust' })`. The guard
 * fails closed, so with no matching row in `IDENTITY_PERMISSIONS` the route
 * answers 403 for every caller.
 *
 * This is a separate, narrower authority from `loyalty:read` (provisioned by
 * `ProvisionLoyaltyPermission1788965263273`): reading a member's points is not
 * permission to move them. Linked to the same shared `owner` role, matching
 * the same pattern used by every other permission-baseline migration.
 */
export const LOYALTY_ADJUST_PERMISSIONS = [
  {
    name: 'loyalty:adjust',
    description: 'Manually adjust a member loyalty point balance',
    resource: 'loyalty',
    action: 'adjust',
  },
] as const;

export const LOYALTY_ADJUST_ROLE_NAME = 'owner';

export class ProvisionLoyaltyAdjustPermission1792195200000
  implements MigrationInterface
{
  name = 'ProvisionLoyaltyAdjustPermission1792195200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const roleId = await ensureRole(queryRunner);
    for (const permission of LOYALTY_ADJUST_PERMISSIONS) {
      const permissionId = await ensurePermission(queryRunner, permission);
      await ensureRolePermission(queryRunner, roleId, permissionId);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const permission of LOYALTY_ADJUST_PERMISSIONS) {
      await queryRunner.query(
        `DELETE FROM "IDENTITY_ROLE_PERMISSIONS" rp
         USING "IDENTITY_ROLES" r, "IDENTITY_PERMISSIONS" p
         WHERE rp."role_id" = r."id"
           AND rp."permission_id" = p."id"
           AND r."name" = $1
           AND p."resource" = $2
           AND p."action" = $3`,
        [LOYALTY_ADJUST_ROLE_NAME, permission.resource, permission.action],
      );
      await queryRunner.query(
        `DELETE FROM "IDENTITY_PERMISSIONS" WHERE "resource" = $1 AND "action" = $2`,
        [permission.resource, permission.action],
      );
    }
  }
}

async function ensureRole(queryRunner: QueryRunner): Promise<string> {
  const existing: Array<{ id: string }> = await queryRunner.query(
    `SELECT "id" FROM "IDENTITY_ROLES"
     WHERE "name" = $1
     ORDER BY "created_at" ASC, "id" ASC`,
    [LOYALTY_ADJUST_ROLE_NAME],
  );
  if (existing.length > 0) {
    return existing[0].id;
  }
  const inserted: Array<{ id: string }> = await queryRunner.query(
    `INSERT INTO "IDENTITY_ROLES" ("name", "description", "is_active")
     VALUES ($1, $2, true)
     RETURNING "id"`,
    [LOYALTY_ADJUST_ROLE_NAME, 'Owner role'],
  );
  return inserted[0].id;
}

async function ensurePermission(
  queryRunner: QueryRunner,
  permission: {
    name: string;
    description: string;
    resource: string;
    action: string;
  },
): Promise<string> {
  const existing: Array<{ id: string }> = await queryRunner.query(
    `SELECT "id" FROM "IDENTITY_PERMISSIONS"
     WHERE "resource" = $1 AND "action" = $2
     ORDER BY "created_at" ASC, "id" ASC`,
    [permission.resource, permission.action],
  );
  if (existing.length > 0) {
    return existing[0].id;
  }
  const inserted: Array<{ id: string }> = await queryRunner.query(
    `INSERT INTO "IDENTITY_PERMISSIONS" ("name", "description", "resource", "action", "is_active")
     VALUES ($1, $2, $3, $4, true)
     RETURNING "id"`,
    [permission.name, permission.description, permission.resource, permission.action],
  );
  return inserted[0].id;
}

async function ensureRolePermission(
  queryRunner: QueryRunner,
  roleId: string,
  permissionId: string,
): Promise<void> {
  const existing: Array<{ id: string }> = await queryRunner.query(
    `SELECT "id" FROM "IDENTITY_ROLE_PERMISSIONS"
     WHERE "role_id" = $1 AND "permission_id" = $2
     ORDER BY "id" ASC
     LIMIT 1`,
    [roleId, permissionId],
  );
  if (existing.length > 0) {
    return;
  }
  await queryRunner.query(
    `INSERT INTO "IDENTITY_ROLE_PERMISSIONS" ("role_id", "permission_id")
     VALUES ($1, $2)`,
    [roleId, permissionId],
  );
}
