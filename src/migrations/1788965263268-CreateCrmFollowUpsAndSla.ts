import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * P3-07 — CRM follow-ups and SLAs.
 *
 * Creates the three P3-07 tables. `CRM_SLA_POLICIES` and `CRM_SLA_BREACHES` are
 * **net-new** (§9: "Neither `CRM_SLA_POLICIES` nor `CRM_SLA_BREACHES` exists in
 * the ERD"), and `CRM_FOLLOW_UPS` is created here in full rather than altered:
 * §9 describes it as an enhancement, but the table it refers to was never created
 * — P3-06's `CreateCrmLeadManagement1788965263266` shipped `CRM_LEAD_SOURCES`,
 * `CRM_LEAD_STAGES`, `CRM_LEADS`, `CRM_LEAD_ACTIVITIES` and `CRM_CONVERSIONS`
 * only, and `grep -rn 'CRM_FOLLOW_UPS' src/` returned nothing before this
 * migration. So there is nothing to `ALTER`; the SLA fields and the
 * `organization_id` / `created_at` columns §9 requires are present from the start.
 *
 * Ordering is forced by the foreign keys: policies first, then follow-ups (which
 * reference a policy), then breaches (which reference both).
 */
export class CreateCrmFollowUpsAndSla1788965263268 implements MigrationInterface {
  name = 'CreateCrmFollowUpsAndSla1788965263268';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "CRM_SLA_POLICIES" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "organization_id" uuid NOT NULL, "name" varchar(100) NOT NULL, "applies_to" varchar(50), "first_response_hours" int NOT NULL, "follow_up_interval_hours" int NOT NULL, "escalation_after_hours" int NOT NULL, "max_follow_ups_per_period" int, "cap_period_days" int NOT NULL DEFAULT 30, "is_active" boolean NOT NULL DEFAULT true, "created_at" timestamptz NOT NULL DEFAULT now(), "updated_at" timestamptz NOT NULL DEFAULT now(), CONSTRAINT "PK_crm_sla_policies" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "CRM_FOLLOW_UPS" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "organization_id" uuid NOT NULL, "lead_id" uuid NOT NULL, "outcome" text, "follow_up_date" timestamptz NOT NULL, "due_at" timestamptz, "sla_policy_id" uuid, "sla_status" varchar(50) NOT NULL DEFAULT 'pending', "escalated_at" timestamptz, "completed_at" timestamptz, "created_at" timestamptz NOT NULL DEFAULT now(), CONSTRAINT "PK_crm_follow_ups" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "CRM_SLA_BREACHES" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "organization_id" uuid NOT NULL, "sla_policy_id" uuid NOT NULL, "lead_id" uuid NOT NULL, "follow_up_id" uuid, "breached_at" timestamptz NOT NULL, "breach_type" varchar(50) NOT NULL, "escalated_at" timestamptz, "resolved_at" timestamptz, "created_at" timestamptz NOT NULL DEFAULT now(), CONSTRAINT "PK_crm_sla_breaches" PRIMARY KEY ("id"))`,
    );

    for (const sql of [
      `CREATE INDEX "IDX_crm_sla_policies_org" ON "CRM_SLA_POLICIES" ("organization_id")`,
      `CREATE INDEX "IDX_crm_sla_policies_org_active" ON "CRM_SLA_POLICIES" ("organization_id","is_active")`,
      `CREATE INDEX "IDX_crm_follow_ups_org" ON "CRM_FOLLOW_UPS" ("organization_id")`,
      `CREATE INDEX "IDX_crm_follow_ups_org_lead" ON "CRM_FOLLOW_UPS" ("organization_id","lead_id")`,
      `CREATE INDEX "IDX_crm_follow_ups_org_sla_status" ON "CRM_FOLLOW_UPS" ("organization_id","sla_status")`,
      `CREATE INDEX "IDX_crm_sla_breaches_org" ON "CRM_SLA_BREACHES" ("organization_id")`,
      `CREATE INDEX "IDX_crm_sla_breaches_org_lead" ON "CRM_SLA_BREACHES" ("organization_id","lead_id")`,
      `CREATE INDEX "IDX_crm_sla_breaches_subject" ON "CRM_SLA_BREACHES" ("sla_policy_id","follow_up_id","breach_type")`,
    ]) {
      await queryRunner.query(sql);
    }

    for (const [table, column, referenced] of [
      ['CRM_SLA_POLICIES', 'organization_id', 'TENANCY_ORGANIZATIONS(id)'],
      ['CRM_FOLLOW_UPS', 'organization_id', 'TENANCY_ORGANIZATIONS(id)'],
      ['CRM_FOLLOW_UPS', 'lead_id', 'CRM_LEADS(id)'],
      ['CRM_FOLLOW_UPS', 'sla_policy_id', 'CRM_SLA_POLICIES(id)'],
      ['CRM_SLA_BREACHES', 'organization_id', 'TENANCY_ORGANIZATIONS(id)'],
      ['CRM_SLA_BREACHES', 'sla_policy_id', 'CRM_SLA_POLICIES(id)'],
      ['CRM_SLA_BREACHES', 'lead_id', 'CRM_LEADS(id)'],
      ['CRM_SLA_BREACHES', 'follow_up_id', 'CRM_FOLLOW_UPS(id)'],
    ]) {
      const [target, targetColumn] = referenced.split('(');
      await queryRunner.query(
        `ALTER TABLE "${table}" ADD CONSTRAINT "FK_${table}_${column}" FOREIGN KEY ("${column}") REFERENCES "${target}"("${targetColumn.replace(')', '')}")`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "CRM_SLA_BREACHES"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "CRM_FOLLOW_UPS"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "CRM_SLA_POLICIES"`);
  }
}
