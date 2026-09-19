import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Phase 3 / P3-02 — Provision the `finance:refund` and `finance:credit-note`
 * permissions.
 *
 * §2 recommends a distinct `finance:refund` action, and the codebase already
 * splits finance write actions this way (`finance:record-payment`). Issuing money
 * back to a member is a materially different authority from recording a payment:
 * a front-desk role that may take money must not automatically be able to send it
 * back out, and reducing an invoice without moving money is a third authority
 * again. Neither is folded into `finance:create` or `finance:update`.
 *
 * This is the `finance:refund` / `finance:credit-note` item of §12.3
 * ("Documentation and permission prerequisites (must precede code)").
 *
 * It follows `ProvisionFinanceAdminPermission1788965263254` exactly: the same
 * SELECT-then-INSERT idempotency (the RBAC tables have no unique constraints
 * beyond their primary keys), the same shared `owner` role, and no hardcoded
 * development UUID. It reuses the existing authorization system; it introduces no
 * second one.
 *
 * Loader safety: the helpers below are module-level and deliberately NOT exported.
 * Only an EXPORTED function under `src/migrations/` is picked up by
 * `DirectoryExportedClassesLoader` and pushed onto the migration list, which would
 * abort `migration:run` / `migration:revert` for every migration. The `export
 * const` array is inert for the same reason. `migration-loader.contract.spec.ts`
 * pins that rule for the whole directory.
 */
export const REFUND_CREDIT_NOTE_PERMISSIONS = [
  {
    name: 'finance:refund',
    description: 'Issue refunds against payments',
    resource: 'finance',
    action: 'refund',
  },
  {
    name: 'finance:credit-note',
    description: 'Issue credit notes against invoices',
    resource: 'finance',
    action: 'credit-note',
  },
] as const;

/** Role intended to hold these finance authorities (matches bootstrap-dev.ts). */
export const REFUND_CREDIT_NOTE_PERMISSIONS_ROLE_NAME = 'owner';

export class ProvisionRefundAndCreditNotePermissions1788965263257 implements MigrationInterface {
    name = 'ProvisionRefundAndCreditNotePermissions1788965263257'

    public async up(queryRunner: QueryRunner): Promise<void> {
        const roleId = await ensureOwnerRole(queryRunner);
        for (const permission of REFUND_CREDIT_NOTE_PERMISSIONS) {
            const permissionId = await ensurePermission(queryRunner, permission);
            await ensureRolePermission(queryRunner, roleId, permissionId);
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // Remove ONLY what this migration created: the role associations and the
        // permission rows. The shared `owner` role is preserved because it may
        // predate this migration and be in use by unrelated grants.
        for (const permission of REFUND_CREDIT_NOTE_PERMISSIONS) {
            await queryRunner.query(
                `DELETE FROM "IDENTITY_ROLE_PERMISSIONS" rp
                 USING "IDENTITY_ROLES" r, "IDENTITY_PERMISSIONS" p
                 WHERE rp."role_id" = r."id"
                   AND rp."permission_id" = p."id"
                   AND r."name" = $1
                   AND p."resource" = $2
                   AND p."action" = $3`,
                [REFUND_CREDIT_NOTE_PERMISSIONS_ROLE_NAME, permission.resource, permission.action],
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
        [REFUND_CREDIT_NOTE_PERMISSIONS_ROLE_NAME],
    );
    if (existing.length > 0) {
        return existing[0].id;
    }

    const inserted: Array<{ id: string }> = await queryRunner.query(
        `INSERT INTO "IDENTITY_ROLES" ("name", "description", "is_active")
         VALUES ($1, $2, true)
         RETURNING "id"`,
        [REFUND_CREDIT_NOTE_PERMISSIONS_ROLE_NAME, 'Owner role'],
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
