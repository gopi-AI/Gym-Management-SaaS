import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateConsentLogTable1788965263240 implements MigrationInterface {
    name = 'CreateConsentLogTable1788965263240'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TABLE "MEMBERS_MEMBER_CONSENTS" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "organization_id" uuid NOT NULL,
                "member_id" uuid NOT NULL,
                "consent_type" character varying(50) NOT NULL,
                "is_given" boolean NOT NULL,
                "given_at" TIMESTAMP WITH TIME ZONE NOT NULL,
                "revoked_at" TIMESTAMP WITH TIME ZONE,
                "revocation_reason" text,
                "expires_at" TIMESTAMP WITH TIME ZONE,
                "document_id" uuid,
                "version" int,
                "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                CONSTRAINT "PK_member_consents" PRIMARY KEY ("id")
            )
        `);

        await queryRunner.query(`
            CREATE INDEX "IDX_consents_org_member_type_created"
            ON "MEMBERS_MEMBER_CONSENTS" ("organization_id", "member_id", "consent_type", "created_at")
        `);

        await queryRunner.query(`
            CREATE INDEX "IDX_consents_member_id"
            ON "MEMBERS_MEMBER_CONSENTS" ("member_id")
        `);

        await queryRunner.query(`
            ALTER TABLE "MEMBERS_MEMBER_CONSENTS"
            ADD CONSTRAINT "FK_consents_member_id"
            FOREIGN KEY ("member_id")
            REFERENCES "MEMBERS_MEMBERS"("id")
            ON DELETE CASCADE
        `);

        await queryRunner.query(`
            ALTER TABLE "MEMBERS_MEMBER_CONSENTS"
            ADD CONSTRAINT "FK_consents_document_id"
            FOREIGN KEY ("document_id")
            REFERENCES "MEMBERS_MEMBER_DOCUMENTS"("id")
            ON DELETE SET NULL
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "MEMBERS_MEMBER_CONSENTS" DROP CONSTRAINT "FK_consents_document_id"`);
        await queryRunner.query(`ALTER TABLE "MEMBERS_MEMBER_CONSENTS" DROP CONSTRAINT "FK_consents_member_id"`);
        await queryRunner.query(`DROP INDEX "IDX_consents_org_member_type_created"`);
        await queryRunner.query(`DROP INDEX "IDX_consents_member_id"`);
        await queryRunner.query(`DROP TABLE "MEMBERS_MEMBER_CONSENTS"`);
    }
}