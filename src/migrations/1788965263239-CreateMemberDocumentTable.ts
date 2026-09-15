import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateMemberDocumentTable1788965263239 implements MigrationInterface {
    name = 'CreateMemberDocumentTable1788965263239'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TABLE "MEMBERS_MEMBER_DOCUMENTS" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "organization_id" uuid NOT NULL,
                "member_id" uuid NOT NULL,
                "document_type" character varying(50) NOT NULL,
                "file_name" character varying(500) NOT NULL,
                "s3_key" character varying(2000) NOT NULL,
                "mime_type" character varying(100),
                "file_size_bytes" int,
                "uploaded_by" uuid NOT NULL,
                "is_active" boolean NOT NULL DEFAULT true,
                "uploaded_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                CONSTRAINT "PK_member_documents" PRIMARY KEY ("id")
            )
        `);

        await queryRunner.query(`
            CREATE INDEX "IDX_documents_org_member"
            ON "MEMBERS_MEMBER_DOCUMENTS" ("organization_id", "member_id")
        `);

        await queryRunner.query(`
            CREATE INDEX "IDX_documents_member_id"
            ON "MEMBERS_MEMBER_DOCUMENTS" ("member_id")
        `);

        await queryRunner.query(`
            ALTER TABLE "MEMBERS_MEMBER_DOCUMENTS"
            ADD CONSTRAINT "FK_documents_member_id"
            FOREIGN KEY ("member_id")
            REFERENCES "MEMBERS_MEMBERS"("id")
            ON DELETE CASCADE
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "MEMBERS_MEMBER_DOCUMENTS" DROP CONSTRAINT "FK_documents_member_id"`);
        await queryRunner.query(`DROP INDEX "IDX_documents_org_member"`);
        await queryRunner.query(`DROP INDEX "IDX_documents_member_id"`);
        await queryRunner.query(`DROP TABLE "MEMBERS_MEMBER_DOCUMENTS"`);
    }
}