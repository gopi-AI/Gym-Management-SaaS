import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * P1-03 — Provision the `membership:extend` and `membership:transfer`
 * authorities for the two new membership routes.
 *
 * Routes: `POST /v1/memberships/:id/extend` and
 * `POST /v1/memberships/:id/transfer`, both guarded by
 * `@RequirePermissions({ resource: 'membership', action: ... })`. The guard
 * fails closed, so without these rows every caller receives 403.
 *
 * The eight pre-existing `membership:*` permissions (read/create/update/pause/
 * resume/freeze/unfreeze/cancel) are still seeded only by
 * `src/scripts/bootstrap-dev.ts`. Provisioning those in a migration is a
 * separate, out-of-scope follow-up; this migration deliberately adds only the
 * two authorities the new routes require.
 *
 * Linked to the shared `owner` role, matching the loyalty, workout, diet,
 * measurement, document/consent and finance permission migrations.
 */
export const MEMBERSHIP_EXTEND_TRANSFER_PERMISSIONS = [
  { name: 'membership:extend', description: 'Extend memberships', resource: 'membership', action: 'extend' },
  { name: 'membership:transfer', description: 'Transfer memberships', resource: 'membership', action: 'transfer' },
] as const;

export const MEMBERSHIP_EXTEND_TRANSFER_ROLE_NAME = 'owner';

export class ProvisionMembershipExtendTransferPermission1792264431869
  implements MigrationInterface
{
  name = 'ProvisionMembershipExtendTransferPermission1792264431869';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const roleId = await ensureRole(queryRunner);
    for (const permission of MEMBERSHIP_EXTEND_TRANSFER_PERMISSIONS) {
      const permissionId = await ensurePermission(queryRunner, permission);
      await ensureRolePermission(queryRunner, roleId, permissionId);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const permission of MEMBERSHIP_EXTEND_TRANSFER_PERMISSIONS) {
      await queryRunner.query(
        `DELETE FROM "IDENTITY_ROLE_PERMISSIONS" rp
         USING "IDENTITY_ROLES" r, "IDENTITY_PERMISSIONS" p
         WHERE rp."role_id" = r."id"
           AND rp."permission_id" = p."id"
           AND r."name" = $1
           AND p."resource" = $2
           AND p."action" = $3`,
        [MEMBERSHIP_EXTEND_TRANSFER_ROLE_NAME, permission.resource, permission.action],
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
    [MEMBERSHIP_EXTEND_TRANSFER_ROLE_NAME],
  );
  if (existing.length > 0) {
    return existing[0].id;
  }
  const inserted: Array<{ id: string }> = await queryRunner.query(
    `INSERT INTO "IDENTITY_ROLES" ("name", "description", "is_active")
     VALUES ($1, $2, true)
     RETURNING "id"`,
    [MEMBERSHIP_EXTEND_TRANSFER_ROLE_NAME, 'Owner role'],
  );
  return inserted[0].id;
}

async function ensurePermission(
  queryRunner: QueryRunner,
  permission: { name: string; description: string; resource: string; action: string },
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
