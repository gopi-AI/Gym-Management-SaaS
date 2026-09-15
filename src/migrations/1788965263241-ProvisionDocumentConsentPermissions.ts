import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 2 — Provision the Document & Consent RBAC baseline.
 *
 * Controller routes in `ConsentsController` / `DocumentsController` are guarded with
 * `@RequirePermissions({ resource: 'member', action: ... })`. Permissions are rows, and
 * a database provisioned from migrations only would hold none of them, so every
 * document/consent endpoint would answer 403 for every user. This migration creates the
 * five permissions and links them to the shared `owner` role — the same role used by
 * the finance/measurement permission migrations and the RBAC model. It reuses the
 * existing authorization system; it introduces no second one.
 *
 * Permission names follow the §6 convention (`member:consent-*`, `member:document-*`).
 */
export const DOCUMENT_CONSENT_PERMISSIONS = [
  {
    name: 'member:consent-read',
    description: 'View member consents',
    resource: 'member',
    action: 'consent-read',
  },
  {
    name: 'member:consent-manage',
    description: 'Give/withdraw consents',
    resource: 'member',
    action: 'consent-manage',
  },
  {
    name: 'member:document-read',
    description: 'View/download documents',
    resource: 'member',
    action: 'document-read',
  },
  {
    name: 'member:document-upload',
    description: 'Upload documents',
    resource: 'member',
    action: 'document-upload',
  },
  {
    name: 'member:document-delete',
    description: 'Delete documents',
    resource: 'member',
    action: 'document-delete',
  },
] as const;

/** Role intended to hold document/consent access (matches bootstrap-dev.ts). */
export const DOCUMENT_CONSENT_ROLE_NAME = 'owner';

export class ProvisionDocumentConsentPermissions1788965263241 implements MigrationInterface {
    name = 'ProvisionDocumentConsentPermissions1788965263241'

    public async up(queryRunner: QueryRunner): Promise<void> {
        const roleId = await ensureOwnerRole(queryRunner);
        for (const permission of DOCUMENT_CONSENT_PERMISSIONS) {
            const permissionId = await ensurePermission(queryRunner, permission);
            await ensureRolePermission(queryRunner, roleId, permissionId);
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // Remove ONLY what this migration created: the role associations and the
        // permission rows. The shared `owner` role itself is preserved because it
        // may predate this migration and be in use by unrelated grants.
        for (const permission of DOCUMENT_CONSENT_PERMISSIONS) {
            await queryRunner.query(
                `DELETE FROM "IDENTITY_ROLE_PERMISSIONS" rp
                 USING "IDENTITY_ROLES" r, "IDENTITY_PERMISSIONS" p
                 WHERE rp."role_id" = r."id"
                   AND rp."permission_id" = p."id"
                   AND r."name" = $1
                   AND p."resource" = $2
                   AND p."action" = $3`,
                [DOCUMENT_CONSENT_ROLE_NAME, permission.resource, permission.action],
            );

            await queryRunner.query(
                `DELETE FROM "IDENTITY_PERMISSIONS" WHERE "resource" = $1 AND "action" = $2`,
                [permission.resource, permission.action],
            );
        }
    }
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

async function ensureOwnerRole(queryRunner: QueryRunner): Promise<string> {
    const existing: Array<{ id: string }> = await queryRunner.query(
        `SELECT "id" FROM "IDENTITY_ROLES"
         WHERE "name" = $1
         ORDER BY "created_at" ASC, "id" ASC`,
        [DOCUMENT_CONSENT_ROLE_NAME],
    );
    if (existing.length > 0) {
        return existing[0].id;
    }

    const inserted: Array<{ id: string }> = await queryRunner.query(
        `INSERT INTO "IDENTITY_ROLES" ("name", "description", "is_active")
         VALUES ($1, $2, true)
         RETURNING "id"`,
        [DOCUMENT_CONSENT_ROLE_NAME, 'Owner role'],
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