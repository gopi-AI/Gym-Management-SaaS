import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Tier 2 — Provision the `branch-settings:read` and `branch-settings:update`
 * authorities for the new branch settings API.
 *
 * Route layer: `src/tenancy/controllers/branch-settings.controller.ts` guards
 * `GET /v1/branches/:id/settings` and `PATCH /v1/branches/:id/settings` with
 * `@RequirePermissions({ resource: 'branch-settings', action: 'read' })` and
 * `@RequirePermissions({ resource: 'branch-settings', action: 'update' })`
 * respectively. The guard fails closed, so with no matching row in
 * `IDENTITY_PERMISSIONS` the route answers 403 for every caller.
 *
 * Linked to the shared `owner` role, matching the same pattern used by the
 * workout, diet, measurement, document/consent, finance, loyalty, and pt
 * permission migrations.
 */
export const BRANCH_SETTINGS_PERMISSIONS = [
  { name: 'branch-settings:read', description: 'Read effective branch settings', resource: 'branch-settings', action: 'read' },
  { name: 'branch-settings:update', description: 'Create/overwrite branch settings and write audit history', resource: 'branch-settings', action: 'update' },
] as const;

export const BRANCH_SETTINGS_ROLE_NAME = 'owner';

export class ProvisionBranchSettingsPermissions1792402551252 implements MigrationInterface {
  name = 'ProvisionBranchSettingsPermissions1792402551252';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const roleId = await ensureRole(queryRunner);
    for (const permission of BRANCH_SETTINGS_PERMISSIONS) {
      const permissionId = await ensurePermission(queryRunner, permission);
      await ensureRolePermission(queryRunner, roleId, permissionId);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const permission of BRANCH_SETTINGS_PERMISSIONS) {
      await queryRunner.query(
        `DELETE FROM "IDENTITY_ROLE_PERMISSIONS" rp
         USING "IDENTITY_ROLES" r, "IDENTITY_PERMISSIONS" p
         WHERE rp."role_id" = r."id"
           AND rp."permission_id" = p."id"
           AND r."name" = $1
           AND p."resource" = $2
           AND p."action" = $3`,
        [BRANCH_SETTINGS_ROLE_NAME, permission.resource, permission.action],
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
    [BRANCH_SETTINGS_ROLE_NAME],
  );
  if (existing.length > 0) {
    return existing[0].id;
  }
  const inserted: Array<{ id: string }> = await queryRunner.query(
    `INSERT INTO "IDENTITY_ROLES" ("name", "description", "is_active")
     VALUES ($1, $2, true)
     RETURNING "id"`,
    [BRANCH_SETTINGS_ROLE_NAME, 'Owner role'],
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
