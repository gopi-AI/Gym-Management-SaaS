import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 2 — Personal Training schema (Module 4 of 8).
 *
 * All tables use the `PT_` prefix from the §1 database plan:
 *   - `PT_TRAINERS`           — trainer profiles
 *   - `PT_PACKAGES`           — sellable session packages (price is NET, Q4)
 *   - `PT_PT_ENROLLMENTS`     — member ↔ package/trainer (Q1 session accounting)
 *   - `PT_PT_SESSIONS`        — trainer-led sessions (Q3: no attendance coupling)
 *   - `PT_TRAINER_COMMISSIONS`— ONE row per enrollment (Q2)
 *
 * **No `PT_WORKOUT_*` tables are created.** Per the §11 Risk 1 naming-collision
 * resolution, the `WORKOUTS_` domain owns all exercise/template/session/
 * assignment content; `PT_PT_SESSIONS.workout_session_id` is the only link, and it
 * is a nullable FK to `WORKOUTS_WORKOUT_SESSIONS` set manually by a trainer (Q27).
 *
 * No `PT_TRAINER_AVAILABILITY` / `PT_TRAINER_BOOKINGS` tables: §1 marks the
 * availability recurrence pattern as needing a business rule definition, and
 * neither entity is in this task's scope.
 */
export class CreatePtTables1788965263245 implements MigrationInterface {
    name = 'CreatePtTables1788965263245'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // PT_TRAINERS
        await queryRunner.query(`
            CREATE TABLE "PT_TRAINERS" (
                "id"                uuid NOT NULL DEFAULT gen_random_uuid(),
                "organization_id"   uuid NOT NULL,
                "branch_id"         uuid NOT NULL,
                "user_id"           uuid,
                "first_name"        character varying(255) NOT NULL,
                "last_name"         character varying(255) NOT NULL,
                "specialty"         character varying(255),
                "certification"     character varying(255),
                "hire_date"         date,
                "is_active"         boolean NOT NULL DEFAULT true,
                "created_at"        TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updated_at"        TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                CONSTRAINT "PK_pt_trainers" PRIMARY KEY ("id")
            )
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_pt_trainers_org_last_name"
            ON "PT_TRAINERS" ("organization_id", "last_name")
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_pt_trainers_org_user"
            ON "PT_TRAINERS" ("organization_id", "user_id")
        `);

        // PT_PACKAGES
        await queryRunner.query(`
            CREATE TABLE "PT_PACKAGES" (
                "id"                    uuid NOT NULL DEFAULT gen_random_uuid(),
                "organization_id"       uuid NOT NULL,
                "name"                  character varying(255) NOT NULL,
                "description"           text,
                "session_count"         integer NOT NULL,
                "price"                 numeric(10,2) NOT NULL,
                "currency"              character varying(3) NOT NULL,
                "commission_percent"    numeric(5,2),
                "valid_from"            date,
                "valid_to"              date,
                "is_active"             boolean NOT NULL DEFAULT true,
                "created_at"            TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updated_at"            TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                CONSTRAINT "PK_pt_packages" PRIMARY KEY ("id")
            )
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_pt_packages_org_name"
            ON "PT_PACKAGES" ("organization_id", "name")
        `);

        // PT_PT_ENROLLMENTS
        await queryRunner.query(`
            CREATE TABLE "PT_PT_ENROLLMENTS" (
                "id"                    uuid NOT NULL DEFAULT gen_random_uuid(),
                "organization_id"       uuid NOT NULL,
                "member_id"             uuid NOT NULL,
                "package_id"            uuid NOT NULL,
                "trainer_id"            uuid NOT NULL,
                "commission_percent"    numeric(5,2),
                "start_date"            date NOT NULL,
                "end_date"              date,
                "sessions_used"         integer NOT NULL DEFAULT 0,
                "session_count"         integer NOT NULL,
                "status"                character varying(20) NOT NULL DEFAULT 'active',
                "created_at"            TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updated_at"            TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                CONSTRAINT "PK_pt_enrollments" PRIMARY KEY ("id"),
                CONSTRAINT "CHK_pt_enrollments_sessions_used_non_negative"
                    CHECK ("sessions_used" >= 0)
            )
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_pt_enrollments_org_member_status"
            ON "PT_PT_ENROLLMENTS" ("organization_id", "member_id", "status")
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_pt_enrollments_org_trainer"
            ON "PT_PT_ENROLLMENTS" ("organization_id", "trainer_id")
        `);

        // PT_PT_SESSIONS
        await queryRunner.query(`
            CREATE TABLE "PT_PT_SESSIONS" (
                "id"                    uuid NOT NULL DEFAULT gen_random_uuid(),
                "organization_id"       uuid NOT NULL,
                "branch_id"             uuid NOT NULL,
                "member_id"             uuid NOT NULL,
                "trainer_id"            uuid NOT NULL,
                "enrollment_id"         uuid NOT NULL,
                "scheduled_start"       TIMESTAMP WITH TIME ZONE NOT NULL,
                "scheduled_end"         TIMESTAMP WITH TIME ZONE NOT NULL,
                "actual_start"          TIMESTAMP WITH TIME ZONE,
                "actual_end"            TIMESTAMP WITH TIME ZONE,
                "status"                character varying(20) NOT NULL DEFAULT 'scheduled',
                "notes"                 text,
                "workout_session_id"    uuid,
                "created_at"            TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updated_at"            TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                CONSTRAINT "PK_pt_sessions" PRIMARY KEY ("id")
            )
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_pt_sessions_org_enrollment"
            ON "PT_PT_SESSIONS" ("organization_id", "enrollment_id")
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_pt_sessions_org_trainer_start"
            ON "PT_PT_SESSIONS" ("organization_id", "trainer_id", "scheduled_start")
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_pt_sessions_org_member_start"
            ON "PT_PT_SESSIONS" ("organization_id", "member_id", "scheduled_start")
        `);

        // PT_TRAINER_COMMISSIONS — one row per enrollment (Q2)
        await queryRunner.query(`
            CREATE TABLE "PT_TRAINER_COMMISSIONS" (
                "id"                    uuid NOT NULL DEFAULT gen_random_uuid(),
                "organization_id"       uuid NOT NULL,
                "pt_enrollment_id"      uuid NOT NULL,
                "trainer_id"            uuid NOT NULL,
                "amount"                numeric(10,2) NOT NULL,
                "currency"              character varying(3) NOT NULL,
                "status"                character varying(20) NOT NULL DEFAULT 'earned',
                "earned_at"             TIMESTAMP WITH TIME ZONE NOT NULL,
                "created_at"            TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updated_at"            TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                CONSTRAINT "PK_pt_trainer_commissions" PRIMARY KEY ("id")
            )
        `);
        // One row per enrollment — DB backstop for the §12 Q2 invariant.
        await queryRunner.query(`
            CREATE UNIQUE INDEX "UQ_pt_commission_enrollment"
            ON "PT_TRAINER_COMMISSIONS" ("pt_enrollment_id")
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_pt_commissions_org_trainer_status"
            ON "PT_TRAINER_COMMISSIONS" ("organization_id", "trainer_id", "status")
        `);
        // Foreign keys (referential integrity is enforced in the database, as in
        // the attendance/membership/workout schema migrations).
        await queryRunner.query(`
            ALTER TABLE "PT_TRAINERS"
            ADD CONSTRAINT "FK_pt_trainers_organization"
            FOREIGN KEY ("organization_id") REFERENCES "TENANCY_ORGANIZATIONS"("id")
            ON DELETE NO ACTION ON UPDATE NO ACTION
        `);
        await queryRunner.query(`
            ALTER TABLE "PT_TRAINERS"
            ADD CONSTRAINT "FK_pt_trainers_branch"
            FOREIGN KEY ("branch_id") REFERENCES "TENANCY_BRANCHES"("id")
            ON DELETE NO ACTION ON UPDATE NO ACTION
        `);
        await queryRunner.query(`
            ALTER TABLE "PT_TRAINERS"
            ADD CONSTRAINT "FK_pt_trainers_user"
            FOREIGN KEY ("user_id") REFERENCES "IDENTITY_USERS"("id")
            ON DELETE SET NULL ON UPDATE NO ACTION
        `);
        await queryRunner.query(`
            ALTER TABLE "PT_PACKAGES"
            ADD CONSTRAINT "FK_pt_packages_organization"
            FOREIGN KEY ("organization_id") REFERENCES "TENANCY_ORGANIZATIONS"("id")
            ON DELETE NO ACTION ON UPDATE NO ACTION
        `);
        await queryRunner.query(`
            ALTER TABLE "PT_PT_ENROLLMENTS"
            ADD CONSTRAINT "FK_pt_enrollments_organization"
            FOREIGN KEY ("organization_id") REFERENCES "TENANCY_ORGANIZATIONS"("id")
            ON DELETE NO ACTION ON UPDATE NO ACTION
        `);
        await queryRunner.query(`
            ALTER TABLE "PT_PT_ENROLLMENTS"
            ADD CONSTRAINT "FK_pt_enrollments_member"
            FOREIGN KEY ("member_id") REFERENCES "MEMBERS_MEMBERS"("id")
            ON DELETE NO ACTION ON UPDATE NO ACTION
        `);
        await queryRunner.query(`
            ALTER TABLE "PT_PT_ENROLLMENTS"
            ADD CONSTRAINT "FK_pt_enrollments_package"
            FOREIGN KEY ("package_id") REFERENCES "PT_PACKAGES"("id")
            ON DELETE NO ACTION ON UPDATE NO ACTION
        `);
        await queryRunner.query(`
            ALTER TABLE "PT_PT_ENROLLMENTS"
            ADD CONSTRAINT "FK_pt_enrollments_trainer"
            FOREIGN KEY ("trainer_id") REFERENCES "PT_TRAINERS"("id")
            ON DELETE NO ACTION ON UPDATE NO ACTION
        `);
        await queryRunner.query(`
            ALTER TABLE "PT_PT_SESSIONS"
            ADD CONSTRAINT "FK_pt_sessions_organization"
            FOREIGN KEY ("organization_id") REFERENCES "TENANCY_ORGANIZATIONS"("id")
            ON DELETE NO ACTION ON UPDATE NO ACTION
        `);
        await queryRunner.query(`
            ALTER TABLE "PT_PT_SESSIONS"
            ADD CONSTRAINT "FK_pt_sessions_branch"
            FOREIGN KEY ("branch_id") REFERENCES "TENANCY_BRANCHES"("id")
            ON DELETE NO ACTION ON UPDATE NO ACTION
        `);
        await queryRunner.query(`
            ALTER TABLE "PT_PT_SESSIONS"
            ADD CONSTRAINT "FK_pt_sessions_member"
            FOREIGN KEY ("member_id") REFERENCES "MEMBERS_MEMBERS"("id")
            ON DELETE NO ACTION ON UPDATE NO ACTION
        `);
        await queryRunner.query(`
            ALTER TABLE "PT_PT_SESSIONS"
            ADD CONSTRAINT "FK_pt_sessions_trainer"
            FOREIGN KEY ("trainer_id") REFERENCES "PT_TRAINERS"("id")
            ON DELETE NO ACTION ON UPDATE NO ACTION
        `);
        await queryRunner.query(`
            ALTER TABLE "PT_PT_SESSIONS"
            ADD CONSTRAINT "FK_pt_sessions_enrollment"
            FOREIGN KEY ("enrollment_id") REFERENCES "PT_PT_ENROLLMENTS"("id")
            ON DELETE NO ACTION ON UPDATE NO ACTION
        `);
        // The ONLY link to the Workouts domain: a nullable FK set manually (Q27).
        await queryRunner.query(`
            ALTER TABLE "PT_PT_SESSIONS"
            ADD CONSTRAINT "FK_pt_sessions_workout_session"
            FOREIGN KEY ("workout_session_id") REFERENCES "WORKOUTS_WORKOUT_SESSIONS"("id")
            ON DELETE SET NULL ON UPDATE NO ACTION
        `);
        await queryRunner.query(`
            ALTER TABLE "PT_TRAINER_COMMISSIONS"
            ADD CONSTRAINT "FK_pt_commissions_organization"
            FOREIGN KEY ("organization_id") REFERENCES "TENANCY_ORGANIZATIONS"("id")
            ON DELETE NO ACTION ON UPDATE NO ACTION
        `);
        // NO ACTION (never CASCADE): the commission row is the payout audit trail
        // and §1 requires that it is never deleted, even if a Phase 3 flow removes
        // an enrollment.
        await queryRunner.query(`
            ALTER TABLE "PT_TRAINER_COMMISSIONS"
            ADD CONSTRAINT "FK_pt_commissions_enrollment"
            FOREIGN KEY ("pt_enrollment_id") REFERENCES "PT_PT_ENROLLMENTS"("id")
            ON DELETE NO ACTION ON UPDATE NO ACTION
        `);
        await queryRunner.query(`
            ALTER TABLE "PT_TRAINER_COMMISSIONS"
            ADD CONSTRAINT "FK_pt_commissions_trainer"
            FOREIGN KEY ("trainer_id") REFERENCES "PT_TRAINERS"("id")
            ON DELETE NO ACTION ON UPDATE NO ACTION
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // Children first: commissions reference enrollments and trainers;
        // sessions reference enrollments, trainers, branches and members.
        await queryRunner.query(`DROP TABLE IF EXISTS "PT_TRAINER_COMMISSIONS"`);
        await queryRunner.query(`DROP TABLE IF EXISTS "PT_PT_SESSIONS"`);
        await queryRunner.query(`DROP TABLE IF EXISTS "PT_PT_ENROLLMENTS"`);
        await queryRunner.query(`DROP TABLE IF EXISTS "PT_PACKAGES"`);
        await queryRunner.query(`DROP TABLE IF EXISTS "PT_TRAINERS"`);
    }
}