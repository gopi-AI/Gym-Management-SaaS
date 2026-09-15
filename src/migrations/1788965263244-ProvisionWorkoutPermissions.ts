import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 2 — Provision the Workouts RBAC baseline.
 *
 * Permission names follow the §6 convention (`workout:*`).
 * Resources:
 *   - `workout:exercise-read`     → View exercise library
 *   - `workout:exercise-manage`   → Create/edit exercises
 *   - `workout:template-read`     → View workout templates
 *   - `workout:template-manage`   → Create/edit templates
 *   - `workout:assignment-read`   → View plan assignments
 *   - `workout:assignment-manage` → Assign/unassign plans
 *   - `workout:session-read`      → View workout sessions
 *   - `workout:session-manage`    → Log/edit sessions
 *
 * Linked to the shared `owner` role, matching the same pattern used by
 * document/consent, measurement, and finance permission migrations.
 */
export const WORKOUT_PERMISSIONS = [
  { name: 'workout:exercise-read',     description: 'View exercise library',              resource: 'workout', action: 'exercise-read' },
  { name: 'workout:exercise-manage',   description: 'Create/edit exercises',             resource: 'workout', action: 'exercise-manage' },
  { name: 'workout:template-read',     description: 'View workout templates',            resource: 'workout', action: 'template-read' },
  { name: 'workout:template-manage',   description: 'Create/edit templates',             resource: 'workout', action: 'template-manage' },
  { name: 'workout:assignment-read',   description: 'View plan assignments',             resource: 'workout', action: 'assignment-read' },
  { name: 'workout:assignment-manage', description: 'Assign/unassign plans',             resource: 'workout', action: 'assignment-manage' },
  { name: 'workout:session-read',      description: 'View workout sessions',             resource: 'workout', action: 'session-read' },
  { name: 'workout:session-manage',    description: 'Log/edit workout sessions',         resource: 'workout', action: 'session-manage' },
] as const;

export const WORKOUT_ROLE_NAME = 'owner';

export class ProvisionWorkoutPermissions1788965263244 implements MigrationInterface {
    name = 'ProvisionWorkoutPermissions1788965263244'

    public async up(queryRunner: QueryRunner): Promise<void> {
        const roleId = await ensureRole(queryRunner);
        for (const permission of WORKOUT_PERMISSIONS) {
            const permissionId = await ensurePermission(queryRunner, permission);
            await ensureRolePermission(queryRunner, roleId, permissionId);
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        for (const permission of WORKOUT_PERMISSIONS) {
            await queryRunner.query(
                `DELETE FROM "IDENTITY_ROLE_PERMISSIONS" rp
                 USING "IDENTITY_ROLES" r, "IDENTITY_PERMISSIONS" p
                 WHERE rp."role_id" = r."id"
                   AND rp."permission_id" = p."id"
                   AND r."name" = $1
                   AND p."resource" = $2
                   AND p."action" = $3`,
                [WORKOUT_ROLE_NAME, permission.resource, permission.action],
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
        [WORKOUT_ROLE_NAME],
    );
    if (existing.length > 0) {
        return existing[0].id;
    }
    const inserted: Array<{ id: string }> = await queryRunner.query(
        `INSERT INTO "IDENTITY_ROLES" ("name", "description", "is_active")
         VALUES ($1, $2, true)
         RETURNING "id"`,
        [WORKOUT_ROLE_NAME, 'Owner role'],
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