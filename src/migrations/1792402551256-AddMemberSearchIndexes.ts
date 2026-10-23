import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * P1-07 — Member search and listing indexes.
 *
 * Adds plain btree indexes on MEMBERS_MEMBERS to support the org-scoped
 * member list query and the exact-match duplicate-contact check:
 *
 *   (organization_id)        — every query filters on it; missing entirely today
 *   (organization_id, email) — ensureNoDuplicateContact() exact-match lookup
 *   (organization_id, phone) — ensureNoDuplicateContact() exact-match lookup
 *
 * All three are non-unique, non-partial btree indexes. No pg_trgm extension
 * is required: ILIKE substring search still works correctly without it, just
 * without index acceleration on the substring case.
 */
export class AddMemberSearchIndexes1792402551256 implements MigrationInterface {
    name = 'AddMemberSearchIndexes1792402551256'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `CREATE INDEX "IDX_members_members_organization_id" ON "MEMBERS_MEMBERS" ("organization_id")`,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_members_members_organization_id_email" ON "MEMBERS_MEMBERS" ("organization_id", "email")`,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_members_members_organization_id_phone" ON "MEMBERS_MEMBERS" ("organization_id", "phone")`,
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `DROP INDEX IF EXISTS "IDX_members_members_organization_id_phone"`,
        );
        await queryRunner.query(
            `DROP INDEX IF EXISTS "IDX_members_members_organization_id_email"`,
        );
        await queryRunner.query(
            `DROP INDEX IF EXISTS "IDX_members_members_organization_id"`,
        );
    }
}