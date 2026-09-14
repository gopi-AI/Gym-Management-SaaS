import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Phase 1 — Attendance schema (front-desk check-in/check-out).
 *
 * Creates the three tables that `src/attendance` actually uses:
 *   ATTENDANCE_ATTENDANCE_EVENTS      raw event (what access_decisions point at)
 *   ATTENDANCE_ATTENDANCE_RECORDS     check-in/check-out sessions
 *   ATTENDANCE_ACCESS_DECISIONS       granted/refused outcome of an event
 *
 * The device-facing tables from `docs/database-plan.md`
 * (`ATTENDANCE_DEVICE_MAPPINGS`, `ATTENDANCE_ELIGIBILITY_SNAPSHOTS`) are
 * deliberately NOT created: nothing in Phase 1 writes them (there is no
 * turnstile/reader integration yet), and empty schema that no code path can
 * populate is dead weight. They arrive with the Phase 2 edge-sync work.
 *
 * Deviations from the ERD block, each matching the entity metadata in
 * `src/attendance/entities/` (which is the source of truth for the runtime):
 *   - `branch_id` is nullable on both events and records: a branch is optional
 *     on the check-in API, and the memberships module treats it as optional too.
 *   - `device_id` / `biometric_id` are nullable: a manual front-desk event has
 *     neither.
 *   - `UQ_attendance_open_record` is a partial UNIQUE index on
 *     `(member_id) WHERE check_out_time IS NULL`: the database-level guarantee
 *     that a member cannot be checked in twice at once.
 */
export class CreateAttendanceSchema1788965263233 implements MigrationInterface {
    name = 'CreateAttendanceSchema1788965263233'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // ATTENDANCE_ATTENDANCE_EVENTS
        await queryRunner.query(`
            CREATE TABLE "ATTENDANCE_ATTENDANCE_EVENTS" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "organization_id" uuid NOT NULL,
                "branch_id" uuid,
                "device_id" uuid,
                "member_id" uuid NOT NULL,
                "event_time" TIMESTAMP WITH TIME ZONE NOT NULL,
                "event_type" character varying(50) NOT NULL,
                "biometric_id" character varying(255),
                CONSTRAINT "PK_attendance_events" PRIMARY KEY ("id")
            )
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_attendance_events_organization_id"
            ON "ATTENDANCE_ATTENDANCE_EVENTS" ("organization_id")
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_attendance_events_member_id"
            ON "ATTENDANCE_ATTENDANCE_EVENTS" ("member_id")
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_attendance_events_member_time"
            ON "ATTENDANCE_ATTENDANCE_EVENTS" ("member_id", "event_time")
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_attendance_events_org_time"
            ON "ATTENDANCE_ATTENDANCE_EVENTS" ("organization_id", "event_time")
        `);

        // ATTENDANCE_ATTENDANCE_RECORDS
        await queryRunner.query(`
            CREATE TABLE "ATTENDANCE_ATTENDANCE_RECORDS" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "organization_id" uuid NOT NULL,
                "branch_id" uuid,
                "member_id" uuid NOT NULL,
                "check_in_time" TIMESTAMP WITH TIME ZONE NOT NULL,
                "check_out_time" TIMESTAMP WITH TIME ZONE,
                "check_in_method" character varying(50) NOT NULL DEFAULT 'manual',
                "check_out_method" character varying(50),
                "checked_in_by" uuid,
                CONSTRAINT "PK_attendance_records" PRIMARY KEY ("id")
            )
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_attendance_records_organization_id"
            ON "ATTENDANCE_ATTENDANCE_RECORDS" ("organization_id")
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_attendance_records_member_id"
            ON "ATTENDANCE_ATTENDANCE_RECORDS" ("member_id")
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_attendance_member_time"
            ON "ATTENDANCE_ATTENDANCE_RECORDS" ("member_id", "check_in_time")
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_attendance_records_org_time"
            ON "ATTENDANCE_ATTENDANCE_RECORDS" ("organization_id", "check_in_time")
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_attendance_records_branch_time"
            ON "ATTENDANCE_ATTENDANCE_RECORDS" ("branch_id", "check_in_time")
        `);
        await queryRunner.query(`
            CREATE UNIQUE INDEX "UQ_attendance_open_record"
            ON "ATTENDANCE_ATTENDANCE_RECORDS" ("member_id")
            WHERE "check_out_time" IS NULL
        `);

        // ATTENDANCE_ACCESS_DECISIONS
        await queryRunner.query(`
            CREATE TABLE "ATTENDANCE_ACCESS_DECISIONS" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "attendance_event_id" uuid NOT NULL,
                "is_granted" boolean NOT NULL,
                "reason" character varying(100),
                "decided_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                CONSTRAINT "PK_attendance_access_decisions" PRIMARY KEY ("id")
            )
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_attendance_decisions_event"
            ON "ATTENDANCE_ACCESS_DECISIONS" ("attendance_event_id")
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_attendance_decisions_granted_at"
            ON "ATTENDANCE_ACCESS_DECISIONS" ("is_granted", "decided_at")
        `);

        // Foreign keys (referential integrity is enforced in the database, as in
        // the memberships schema migration).
        await queryRunner.query(`
            ALTER TABLE "ATTENDANCE_ATTENDANCE_EVENTS"
            ADD CONSTRAINT "FK_attendance_events_organization"
            FOREIGN KEY ("organization_id")
            REFERENCES "TENANCY_ORGANIZATIONS"("id")
            ON DELETE NO ACTION ON UPDATE NO ACTION
        `);
        await queryRunner.query(`
            ALTER TABLE "ATTENDANCE_ATTENDANCE_EVENTS"
            ADD CONSTRAINT "FK_attendance_events_branch"
            FOREIGN KEY ("branch_id")
            REFERENCES "TENANCY_BRANCHES"("id")
            ON DELETE NO ACTION ON UPDATE NO ACTION
        `);
        await queryRunner.query(`
            ALTER TABLE "ATTENDANCE_ATTENDANCE_EVENTS"
            ADD CONSTRAINT "FK_attendance_events_member"
            FOREIGN KEY ("member_id")
            REFERENCES "MEMBERS_MEMBERS"("id")
            ON DELETE NO ACTION ON UPDATE NO ACTION
        `);
        await queryRunner.query(`
            ALTER TABLE "ATTENDANCE_ATTENDANCE_RECORDS"
            ADD CONSTRAINT "FK_attendance_records_organization"
            FOREIGN KEY ("organization_id")
            REFERENCES "TENANCY_ORGANIZATIONS"("id")
            ON DELETE NO ACTION ON UPDATE NO ACTION
        `);
        await queryRunner.query(`
            ALTER TABLE "ATTENDANCE_ATTENDANCE_RECORDS"
            ADD CONSTRAINT "FK_attendance_records_branch"
            FOREIGN KEY ("branch_id")
            REFERENCES "TENANCY_BRANCHES"("id")
            ON DELETE NO ACTION ON UPDATE NO ACTION
        `);
        await queryRunner.query(`
            ALTER TABLE "ATTENDANCE_ATTENDANCE_RECORDS"
            ADD CONSTRAINT "FK_attendance_records_member"
            FOREIGN KEY ("member_id")
            REFERENCES "MEMBERS_MEMBERS"("id")
            ON DELETE NO ACTION ON UPDATE NO ACTION
        `);
        await queryRunner.query(`
            ALTER TABLE "ATTENDANCE_ACCESS_DECISIONS"
            ADD CONSTRAINT "FK_attendance_decisions_event"
            FOREIGN KEY ("attendance_event_id")
            REFERENCES "ATTENDANCE_ATTENDANCE_EVENTS"("id")
            ON DELETE NO ACTION ON UPDATE NO ACTION
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // Children first: decisions reference events.
        await queryRunner.query(`DROP TABLE "ATTENDANCE_ACCESS_DECISIONS"`);
        await queryRunner.query(`DROP TABLE "ATTENDANCE_ATTENDANCE_RECORDS"`);
        await queryRunner.query(`DROP TABLE "ATTENDANCE_ATTENDANCE_EVENTS"`);
    }
}
