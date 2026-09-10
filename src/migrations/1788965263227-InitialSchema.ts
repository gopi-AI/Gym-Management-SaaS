import { MigrationInterface, QueryRunner } from "typeorm";

export class InitialSchema1788965263227 implements MigrationInterface {
    name = 'InitialSchema1788965263227'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE SCHEMA IF NOT EXISTS "shared"`);
        await queryRunner.query(`CREATE TABLE "TENANCY_TENANT_SETTINGS" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "organization_id" uuid NOT NULL, "time_zone" character varying(100) NOT NULL, "locale" character varying(50) NOT NULL, "currency" character varying(3) NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "is_active" boolean NOT NULL DEFAULT true, CONSTRAINT "PK_ef189a96772fbcb01ce9f524689" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "TENANCY_ORGANIZATIONS" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying(255) NOT NULL, "timezone" character varying(50) NOT NULL, "locale" character varying(50) NOT NULL, "currency" character varying(3) NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "is_active" boolean NOT NULL DEFAULT true, CONSTRAINT "PK_b18bd4ff22abe14915f842b2336" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_71287c17503bd4e319dd185198" ON "TENANCY_ORGANIZATIONS" ("name") `);
        await queryRunner.query(`CREATE INDEX "IDX_734d2bbcba20b82f66b159c38b" ON "TENANCY_ORGANIZATIONS" ("is_active") `);
        await queryRunner.query(`CREATE TABLE "TENANCY_BRANCHES" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "organization_id" uuid NOT NULL, "name" character varying(255) NOT NULL, "address" character varying(500) NOT NULL, "phone" character varying(50) NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "is_active" boolean NOT NULL DEFAULT true, CONSTRAINT "PK_bdafdfad343652e34285188c42c" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_8e0acdbba389a6c10fcadd4a1f" ON "TENANCY_BRANCHES" ("name") `);
        await queryRunner.query(`CREATE INDEX "IDX_09d17ce95903c09550d4f6c9d8" ON "TENANCY_BRANCHES" ("is_active") `);
        await queryRunner.query(`CREATE TABLE "shared"."outbox" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "eventType" character varying(100) NOT NULL, "payload" text NOT NULL, "correlationId" character varying(255) NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "processed" boolean NOT NULL DEFAULT false, "attempts" integer NOT NULL DEFAULT '0', "lockedAt" TIMESTAMP, "lockedBy" character varying(100), CONSTRAINT "PK_340ab539f309f03bdaa14aa7649" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "shared"."inbox" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "correlationId" character varying(255) NOT NULL, "eventType" character varying(100) NOT NULL, "payload" text NOT NULL, "receivedAt" TIMESTAMP NOT NULL DEFAULT now(), "handled" boolean NOT NULL DEFAULT false, CONSTRAINT "UQ_16c738a86c71b31fab5aa367ae7" UNIQUE ("correlationId"), CONSTRAINT "PK_ab7abc299fab4bb4f965549c819" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "MEMBERS_MEMBER_IDENTIFIERS" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "member_id" uuid NOT NULL, "identifier_type" character varying(50) NOT NULL, "identifier_value" character varying(255) NOT NULL, "is_primary" boolean NOT NULL DEFAULT false, "memberId" uuid, CONSTRAINT "PK_98edc4428b41278bd33dbe4fbbf" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "MEMBERS_MEMBER_PROFILES" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "member_id" uuid NOT NULL, "height" character varying(20), "weight" character varying(20), "body_fat" character varying(20), "medical_conditions" text, "allergies" text, "emergency_contact_name" character varying(255), "emergency_contact_phone" character varying(255), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "memberId" uuid, CONSTRAINT "PK_26d64b542400c24dd0ed148c961" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "MEMBERS_MEMBERS" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "organization_id" uuid NOT NULL, "branch_id" uuid NOT NULL, "global_uuid" uuid NOT NULL, "local_id" integer NOT NULL, "first_name" character varying(255) NOT NULL, "last_name" character varying(255) NOT NULL, "middle_name" character varying(255), "preferred_name" character varying(255), "date_of_birth" date, "gender" character varying(50), "phone" character varying(255), "email" character varying(255), "address_line1" character varying(500), "address_line2" character varying(500), "city" character varying(255), "state" character varying(255), "postal_code" character varying(50), "country" character varying(255), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "is_active" boolean NOT NULL DEFAULT true, CONSTRAINT "PK_3eba9d5cc17b939f2f7a2d861f7" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_bdea480a79fb6d23787d354bc5" ON "MEMBERS_MEMBERS" ("global_uuid") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_63fc5ffffaa664a193e4be8242" ON "MEMBERS_MEMBERS" ("organization_id", "local_id") `);
        await queryRunner.query(`CREATE TABLE "MEMBERS_LOCAL_ID_COUNTERS" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "organization_id" uuid NOT NULL, "last_local_id" integer NOT NULL DEFAULT '0', CONSTRAINT "PK_59fc910df78fedd3e3b96fb5f25" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_df4350fcf4ad78e1a23d9e386e" ON "MEMBERS_LOCAL_ID_COUNTERS" ("organization_id") `);
        await queryRunner.query(`CREATE TABLE "IDENTITY_USERS" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "email" character varying(255) NOT NULL, "password_hash" character varying(255) NOT NULL, "first_name" character varying(255) NOT NULL, "last_name" character varying(255) NOT NULL, "phone" character varying(255), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "is_active" boolean NOT NULL DEFAULT true, "email_verified" boolean NOT NULL DEFAULT false, "is_mfa_enabled" boolean NOT NULL DEFAULT false, CONSTRAINT "PK_5b0db5ab78aca60c44a8e7eb93a" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "IDENTITY_PERMISSIONS" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying(100) NOT NULL, "description" character varying(255) NOT NULL, "resource" character varying(50) NOT NULL, "action" character varying(50) NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "is_active" boolean NOT NULL DEFAULT true, CONSTRAINT "PK_bc71d8701d432bdafc47c3c86c0" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "IDENTITY_ROLE_PERMISSIONS" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "role_id" uuid NOT NULL, "permission_id" uuid NOT NULL, CONSTRAINT "PK_85e0de9810d6a7003fb5787ff88" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "IDENTITY_ROLES" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying(50) NOT NULL, "description" character varying(255) NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "is_active" boolean NOT NULL DEFAULT true, CONSTRAINT "PK_e11f7908134aee7c55ae987ea54" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "IDENTITY_USER_ROLES" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "user_id" uuid NOT NULL, "role_id" uuid NOT NULL, CONSTRAINT "PK_b599f9dc0993c0844531181a634" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "IDENTITY_USER_ORGANIZATIONS" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "user_id" uuid NOT NULL, "organization_id" uuid NOT NULL, "role_id" uuid, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "is_active" boolean NOT NULL DEFAULT true, CONSTRAINT "UQ_0b49357136163bbe37c68015512" UNIQUE ("user_id", "organization_id"), CONSTRAINT "PK_90df1a7476ae1a885749256dddf" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_8ca9bb13ada839c1f4355f82b6" ON "IDENTITY_USER_ORGANIZATIONS" ("user_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_6ced60bd3a15e0b0d9a0c1d251" ON "IDENTITY_USER_ORGANIZATIONS" ("organization_id") `);
        await queryRunner.query(`CREATE TABLE "IDENTITY_MFA_SECRETS" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "user_id" uuid NOT NULL, "secret" character varying(255) NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_e62210940608210d29a58151736" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "IDENTITY_AUTH_TOKENS" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "user_id" uuid NOT NULL, "token_type" character varying(50) NOT NULL, "token_value" character varying(500) NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL, CONSTRAINT "PK_965c6538f5e92e63f0ad5eef462" PRIMARY KEY ("id"))`);
        await queryRunner.query(`ALTER TABLE "MEMBERS_MEMBER_IDENTIFIERS" ADD CONSTRAINT "FK_63fc8930f4b231a5fc31d599f83" FOREIGN KEY ("memberId") REFERENCES "MEMBERS_MEMBERS"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "MEMBERS_MEMBER_PROFILES" ADD CONSTRAINT "FK_8c8bd26bdfffac9b44cbd1e56d6" FOREIGN KEY ("memberId") REFERENCES "MEMBERS_MEMBERS"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "IDENTITY_ROLE_PERMISSIONS" ADD CONSTRAINT "FK_a39adbe0cc1e4b8cb066df2fc87" FOREIGN KEY ("role_id") REFERENCES "IDENTITY_ROLES"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "IDENTITY_ROLE_PERMISSIONS" ADD CONSTRAINT "FK_ed77b99b7e1a0e9e545c00fe800" FOREIGN KEY ("permission_id") REFERENCES "IDENTITY_PERMISSIONS"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "IDENTITY_USER_ROLES" ADD CONSTRAINT "FK_88b31f5f5f09bed7cee0ea85658" FOREIGN KEY ("role_id") REFERENCES "IDENTITY_ROLES"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "IDENTITY_USER_ORGANIZATIONS" ADD CONSTRAINT "FK_8ca9bb13ada839c1f4355f82b67" FOREIGN KEY ("user_id") REFERENCES "IDENTITY_USERS"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "IDENTITY_USER_ORGANIZATIONS" ADD CONSTRAINT "FK_6ced60bd3a15e0b0d9a0c1d2515" FOREIGN KEY ("organization_id") REFERENCES "TENANCY_ORGANIZATIONS"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "IDENTITY_USER_ORGANIZATIONS" ADD CONSTRAINT "FK_c950a5d1c1cbce432d0f1dba2ff" FOREIGN KEY ("role_id") REFERENCES "IDENTITY_ROLES"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "IDENTITY_USER_ORGANIZATIONS" DROP CONSTRAINT "FK_c950a5d1c1cbce432d0f1dba2ff"`);
        await queryRunner.query(`ALTER TABLE "IDENTITY_USER_ORGANIZATIONS" DROP CONSTRAINT "FK_6ced60bd3a15e0b0d9a0c1d2515"`);
        await queryRunner.query(`ALTER TABLE "IDENTITY_USER_ORGANIZATIONS" DROP CONSTRAINT "FK_8ca9bb13ada839c1f4355f82b67"`);
        await queryRunner.query(`ALTER TABLE "IDENTITY_USER_ROLES" DROP CONSTRAINT "FK_88b31f5f5f09bed7cee0ea85658"`);
        await queryRunner.query(`ALTER TABLE "IDENTITY_ROLE_PERMISSIONS" DROP CONSTRAINT "FK_ed77b99b7e1a0e9e545c00fe800"`);
        await queryRunner.query(`ALTER TABLE "IDENTITY_ROLE_PERMISSIONS" DROP CONSTRAINT "FK_a39adbe0cc1e4b8cb066df2fc87"`);
        await queryRunner.query(`ALTER TABLE "MEMBERS_MEMBER_PROFILES" DROP CONSTRAINT "FK_8c8bd26bdfffac9b44cbd1e56d6"`);
        await queryRunner.query(`ALTER TABLE "MEMBERS_MEMBER_IDENTIFIERS" DROP CONSTRAINT "FK_63fc8930f4b231a5fc31d599f83"`);
        await queryRunner.query(`DROP TABLE "IDENTITY_AUTH_TOKENS"`);
        await queryRunner.query(`DROP TABLE "IDENTITY_MFA_SECRETS"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_6ced60bd3a15e0b0d9a0c1d251"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_8ca9bb13ada839c1f4355f82b6"`);
        await queryRunner.query(`DROP TABLE "IDENTITY_USER_ORGANIZATIONS"`);
        await queryRunner.query(`DROP TABLE "IDENTITY_USER_ROLES"`);
        await queryRunner.query(`DROP TABLE "IDENTITY_ROLES"`);
        await queryRunner.query(`DROP TABLE "IDENTITY_ROLE_PERMISSIONS"`);
        await queryRunner.query(`DROP TABLE "IDENTITY_PERMISSIONS"`);
        await queryRunner.query(`DROP TABLE "IDENTITY_USERS"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_df4350fcf4ad78e1a23d9e386e"`);
        await queryRunner.query(`DROP TABLE "MEMBERS_LOCAL_ID_COUNTERS"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_63fc5ffffaa664a193e4be8242"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_bdea480a79fb6d23787d354bc5"`);
        await queryRunner.query(`DROP TABLE "MEMBERS_MEMBERS"`);
        await queryRunner.query(`DROP TABLE "MEMBERS_MEMBER_PROFILES"`);
        await queryRunner.query(`DROP TABLE "MEMBERS_MEMBER_IDENTIFIERS"`);
        await queryRunner.query(`DROP TABLE "shared"."inbox"`);
        await queryRunner.query(`DROP TABLE "shared"."outbox"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_09d17ce95903c09550d4f6c9d8"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_8e0acdbba389a6c10fcadd4a1f"`);
        await queryRunner.query(`DROP TABLE "TENANCY_BRANCHES"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_734d2bbcba20b82f66b159c38b"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_71287c17503bd4e319dd185198"`);
        await queryRunner.query(`DROP TABLE "TENANCY_ORGANIZATIONS"`);
        await queryRunner.query(`DROP TABLE "TENANCY_TENANT_SETTINGS"`);
    }

}
