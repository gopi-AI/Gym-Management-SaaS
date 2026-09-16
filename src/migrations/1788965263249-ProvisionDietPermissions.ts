import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 2 — Provision the Diet/Nutrition RBAC baseline.
 *
 * Permission names follow the §6 convention (`diet:*`).
 * Resources:
 *   - `diet:plan-read`     → View diet plans
 *   - `diet:plan-manage`   → Create/edit diet plans
 *   - `diet:template-read` → View meal templates
 *   - `diet:template-manage` → Create/edit meal templates
 *   - `diet:assignment-read` → View plan assignments
 *   - `diet:assignment-manage` → Assign/unassign plans
 *   - `diet:log-read`      → View nutrition logs
 *   - `diet:log-manage`    → Log/edit meals
 *
 * Linked to the shared `owner` role, matching the same pattern used by
 * workouts and other permission migrations.
 */
export const DIET_PERMISSIONS = [
  { name: 'diet:plan-read',         description: 'View diet plans',                  resource: 'diet', action: 'plan-read' },
  { name: 'diet:plan-manage',       description: 'Create/edit diet plans',           resource: 'diet', action: 'plan-manage' },
  { name: 'diet:template-read',     description: 'View meal templates',              resource: 'diet', action: 'template-read' },
  { name: 'diet:template-manage',   description: 'Create/edit meal templates',       resource: 'diet', action: 'template-manage' },
  { name: 'diet:assignment-read',   description: 'View diet plan assignments',       resource: 'diet', action: 'assignment-read' },
  { name: 'diet:assignment-manage', description: 'Assign/unassign diet plans',       resource: 'diet', action: 'assignment-manage' },
  { name: 'diet:log-read',          description: 'View nutrition logs',              resource: 'diet', action: 'log-read' },
  { name: 'diet:log-manage',        description: 'Log/edit meals',                   resource: 'diet', action: 'log-manage' },
] as const;

export const DIET_ROLE_NAME = 'owner';

export class ProvisionDietPermissions1788965263249 implements MigrationInterface {
    name = 'ProvisionDietPermissions1788965263249'

    public async up(queryRunner: QueryRunner): Promise<void> {
        const roleId = await ensureRole(queryRunner);
        for (const permission of DIET_PERMISSIONS) {
            const permissionId = await ensurePermission(queryRunner, permission);
            await ensureRolePermission(queryRunner, roleId, permissionId);
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        for (const permission of DIET_PERMISSIONS) {
            await queryRunner.query(
                `DELETE FROM "IDENTITY_ROLE_PERMISSIONS" rp
                 USING "IDENTITY_ROLES" r, "IDENTITY_PERMISSIONS" p
                 WHERE rp."role_id" = r."id"
                   AND rp."permission_id" = p."id"
                   AND r."name" = $1
                   AND p."resource" = $2
                   AND p."action" = $3`,
                [DIET_ROLE_NAME, permission.resource, permission.action],
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
        [DIET_ROLE_NAME],
    );
    if (existing.length > 0) {
        return existing[0].id;
    }
    const inserted: Array<{ id: string }> = await queryRunner.query(
        `INSERT INTO "IDENTITY_ROLES" ("name", "description", "is_active")
         VALUES ($1, $2, true)
         RETURNING "id"`,
        [DIET_ROLE_NAME, 'Owner role'],
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