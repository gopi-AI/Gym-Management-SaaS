import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 2 — Provision the `loyalty:read` authority for the loyalty tab route.
 *
 * Route layer: `src/loyalty/controllers/loyalty-tab.controller.ts` guards
 * `GET /v1/members/:memberId/loyalty` with
 * `@RequirePermissions({ resource: 'loyalty', action: 'read' })`. The guard
 * fails closed, so with no matching row in `IDENTITY_PERMISSIONS` the route
 * answers 403 for every caller.
 *
 * This is a single coarse authority rather than the granular
 * `<resource>:<action>-read`/`-manage` set used by the workout and diet
 * baselines, because this route layer is read-only: the `POST /points/adjust`
 * write path has no service operation yet and was not shipped.
 *
 * Linked to the shared `owner` role, matching the same pattern used by the
 * workout, diet, measurement, document/consent and finance permission
 * migrations.
 */
export const LOYALTY_PERMISSIONS = [
  { name: 'loyalty:read', description: 'View loyalty account and point transactions', resource: 'loyalty', action: 'read' },
] as const;

export const LOYALTY_ROLE_NAME = 'owner';

export class ProvisionLoyaltyPermission1788965263273 implements MigrationInterface {
    name = 'ProvisionLoyaltyPermission1788965263273'

    public async up(queryRunner: QueryRunner): Promise<void> {
        const roleId = await ensureRole(queryRunner);
        for (const permission of LOYALTY_PERMISSIONS) {
            const permissionId = await ensurePermission(queryRunner, permission);
            await ensureRolePermission(queryRunner, roleId, permissionId);
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        for (const permission of LOYALTY_PERMISSIONS) {
            await queryRunner.query(
                `DELETE FROM "IDENTITY_ROLE_PERMISSIONS" rp
                 USING "IDENTITY_ROLES" r, "IDENTITY_PERMISSIONS" p
                 WHERE rp."role_id" = r."id"
                   AND rp."permission_id" = p."id"
                   AND r."name" = $1
                   AND p."resource" = $2
                   AND p."action" = $3`,
                [LOYALTY_ROLE_NAME, permission.resource, permission.action],
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
        [LOYALTY_ROLE_NAME],
    );
    if (existing.length > 0) {
        return existing[0].id;
    }
    const inserted: Array<{ id: string }> = await queryRunner.query(
        `INSERT INTO "IDENTITY_ROLES" ("name", "description", "is_active")
         VALUES ($1, $2, true)
         RETURNING "id"`,
        [LOYALTY_ROLE_NAME, 'Owner role'],
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
