import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Phase 3 / P3-04 — Provision the `finance:admin` permission.
 *
 * Tax configuration is a compliance-sensitive action, so it is deliberately NOT
 * folded into `finance:create` (which any front-desk role may hold in order to
 * raise an invoice). `TaxRatesController` guards `POST /v1/tax-rates` with
 * `@RequirePermissions({ resource: 'finance', action: 'admin' })`; permissions are
 * rows, so a database provisioned from migrations only would hold none of them and
 * the endpoint would answer 403 for every user — including the owner.
 *
 * This is the `finance:admin` item of `docs/phase3-scoping-plan.md` §12.3
 * ("Documentation and permission prerequisites (must precede code)"). It lands
 * BEFORE the tax-calculation code, and its timestamp is lower than the tax table
 * migrations so it also precedes them in migration order.
 *
 * It follows `ProvisionFinancePermissions1788965263236` exactly: the same
 * SELECT-then-INSERT idempotency (the RBAC tables have no unique constraints
 * beyond their primary keys), the same shared `owner` role, and no hardcoded
 * development UUID. It reuses the existing authorization system; it introduces no
 * second one. It touches ONLY `finance:admin`.
 */
export const FINANCE_ADMIN_PERMISSIONS = [
  {
    name: 'finance:admin',
    description: 'Manage finance configuration (tax rates)',
    resource: 'finance',
    action: 'admin',
  },
] as const;

/** Role intended to hold finance configuration access (matches bootstrap-dev.ts). */
export const FINANCE_ADMIN_PERMISSIONS_ROLE_NAME = 'owner';

export class ProvisionFinanceAdminPermission1788965263254 implements MigrationInterface {
    name = 'ProvisionFinanceAdminPermission1788965263254'

    public async up(queryRunner: QueryRunner): Promise<void> {
        const roleId = await ensureOwnerRole(queryRunner);
        for (const permission of FINANCE_ADMIN_PERMISSIONS) {
            const permissionId = await ensurePermission(queryRunner, permission);
            await ensureRolePermission(queryRunner, roleId, permissionId);
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // Remove ONLY what this migration created: the role association and the
        // permission row. The shared `owner` role is preserved because it may
        // predate this migration and be in use by unrelated grants.
        for (const permission of FINANCE_ADMIN_PERMISSIONS) {
            await queryRunner.query(
                `DELETE FROM "IDENTITY_ROLE_PERMISSIONS" rp
                 USING "IDENTITY_ROLES" r, "IDENTITY_PERMISSIONS" p
                 WHERE rp."role_id" = r."id"
                   AND rp."permission_id" = p."id"
                   AND r."name" = $1
                   AND p."resource" = $2
                   AND p."action" = $3`,
                [FINANCE_ADMIN_PERMISSIONS_ROLE_NAME, permission.resource, permission.action],
            );

            await queryRunner.query(
                `DELETE FROM "IDENTITY_PERMISSIONS" WHERE "resource" = $1 AND "action" = $2`,
                [permission.resource, permission.action],
            );
        }
    }
}

/** Return the id of the existing permission, creating it when absent. */
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

/**
 * Return the id of the intended role, creating the shared `owner` role when the
 * database does not have it yet (production is provisioned from migrations only).
 */
async function ensureOwnerRole(queryRunner: QueryRunner): Promise<string> {
    const existing: Array<{ id: string }> = await queryRunner.query(
        `SELECT "id" FROM "IDENTITY_ROLES"
         WHERE "name" = $1
         ORDER BY "created_at" ASC, "id" ASC`,
        [FINANCE_ADMIN_PERMISSIONS_ROLE_NAME],
    );
    if (existing.length > 0) {
        return existing[0].id;
    }

    const inserted: Array<{ id: string }> = await queryRunner.query(
        `INSERT INTO "IDENTITY_ROLES" ("name", "description", "is_active")
         VALUES ($1, $2, true)
         RETURNING "id"`,
        [FINANCE_ADMIN_PERMISSIONS_ROLE_NAME, 'Owner role'],
    );
    return inserted[0].id;
}

/** Link the role to the permission unless the association already exists. */
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
