import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 2 — Provision the Personal Training RBAC baseline.
 *
 * Permission names are taken verbatim from the §1 RBAC table (`pt:*`):
 *   - `pt:read`             → View PT enrollments, sessions, trainers
 *   - `pt:create`           → Create PT packages, enrollments
 *   - `pt:update`           → Update enrollments, reschedule sessions
 *   - `pt:delete`           → Cancel enrollments, remove trainers
 *   - `pt:session-check-in` → Mark session as completed (staff-facing)
 *   - `pt:commission-read`  → View trainer commissions
 *
 * Same purpose and shape as `ProvisionWorkoutPermissions`: permissions are rows,
 * so a database provisioned from migrations alone would hold none of them and
 * every PT-guarded route would answer 403. No new RBAC system and no new
 * mechanism — plain `IDENTITY_PERMISSIONS` rows linked to the shared `owner`
 * role, idempotent via SELECT-then-INSERT.
 *
 * The `pt:update` action is also the guard for booking/linking a session
 * (lifecycle operations are "reschedule sessions" in §1's mapping) and
 * `pt:session-check-in` guards completion — the only transitions this module
 * implements.
 */
export const PT_PERMISSIONS = [
  { name: 'pt:read',             description: 'View PT enrollments, sessions, trainers', resource: 'pt', action: 'read' },
  { name: 'pt:create',           description: 'Create PT packages, enrollments',         resource: 'pt', action: 'create' },
  { name: 'pt:update',           description: 'Update enrollments, reschedule sessions', resource: 'pt', action: 'update' },
  { name: 'pt:delete',           description: 'Cancel enrollments, remove trainers',     resource: 'pt', action: 'delete' },
  { name: 'pt:session-check-in', description: 'Mark session as completed (staff-facing)', resource: 'pt', action: 'session-check-in' },
  { name: 'pt:commission-read',  description: 'View trainer commissions',                resource: 'pt', action: 'commission-read' },
] as const;

export const PT_PERMISSIONS_ROLE_NAME = 'owner';

export class ProvisionPtPermissions1788965263246 implements MigrationInterface {
    name = 'ProvisionPtPermissions1788965263246'

    public async up(queryRunner: QueryRunner): Promise<void> {
        const roleId = await ensureRole(queryRunner);
        for (const permission of PT_PERMISSIONS) {
            const permissionId = await ensurePermission(queryRunner, permission);
            await ensureRolePermission(queryRunner, roleId, permissionId);
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        for (const permission of PT_PERMISSIONS) {
            await queryRunner.query(
                `DELETE FROM "IDENTITY_ROLE_PERMISSIONS" rp
                 USING "IDENTITY_ROLES" r, "IDENTITY_PERMISSIONS" p
                 WHERE rp."role_id" = r."id"
                   AND rp."permission_id" = p."id"
                   AND r."name" = $1
                   AND p."resource" = $2
                   AND p."action" = $3`,
                [PT_PERMISSIONS_ROLE_NAME, permission.resource, permission.action],
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
        [PT_PERMISSIONS_ROLE_NAME],
    );
    if (existing.length > 0) {
        return existing[0].id;
    }
    const inserted: Array<{ id: string }> = await queryRunner.query(
        `INSERT INTO "IDENTITY_ROLES" ("name", "description", "is_active")
         VALUES ($1, $2, true)
         RETURNING "id"`,
        [PT_PERMISSIONS_ROLE_NAME, 'Owner role'],
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