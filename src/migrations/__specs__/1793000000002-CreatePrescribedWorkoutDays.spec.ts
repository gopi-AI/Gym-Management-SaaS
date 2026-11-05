import { CreatePrescribedWorkoutDays1793000000002 } from '../1793000000002-CreatePrescribedWorkoutDays';

describe('CreatePrescribedWorkoutDays migration', () => {
  async function runUp(): Promise<string> {
    const migration = new CreatePrescribedWorkoutDays1793000000002();
    const statements: string[] = [];
    const queryRunner = {
      query: jest.fn(async (sql: string) => {
        statements.push(sql);
      }),
    };
    await migration.up(queryRunner as never);
    expect(migration.name).toBe('CreatePrescribedWorkoutDays1793000000002');
    return statements.join('\n');
  }

  it('adds assignment snapshot metadata and a source CHECK', async () => {
    const sql = await runUp();

    expect(sql).toContain('ADD COLUMN "plan_template_id" uuid');
    expect(sql).toContain('ADD COLUMN "logging_mode" varchar(20)');
    expect(sql).toContain('ADD COLUMN "snapshot_taken_at" timestamptz');
    expect(sql).toContain('ALTER COLUMN "template_id" DROP NOT NULL');
    expect(sql).toContain('CHK_WORKOUTS_ASSIGNMENT_SOURCE');
  });

  it('creates prescribed days and exercise snapshots with scoped predicates and ordering', async () => {
    const sql = await runUp();

    expect(sql).toContain('CREATE TABLE "WORKOUTS_PRESCRIBED_DAYS"');
    expect(sql).toContain('CREATE TABLE "WORKOUTS_PRESCRIBED_DAY_EXERCISES"');
    expect(sql).toContain('UQ_WORKOUTS_PRESCRIBED_DAY_ORDER');
    expect(sql).toContain('"exercise_name_snapshot" varchar(255) NOT NULL');
    expect(sql).toContain(
      'IDX_WORKOUTS_PRESCRIBED_DAYS_ORG_ASSIGNMENT_STATUS',
    );
    expect(sql).toContain('UQ_WORKOUTS_ACTIVE_PLAN_TEMPLATE_ASSIGNMENT');
  });

  it('backfills legacy assignments without inventing approvals', async () => {
    const sql = await runUp();

    expect(sql).toContain('INSERT INTO "WORKOUTS_PRESCRIBED_DAYS"');
    expect(sql).toContain('COALESCE("day_of_week", 0)');
    expect(sql).toContain("'pending'");
    expect(sql).toContain('INSERT INTO "WORKOUTS_PRESCRIBED_DAY_EXERCISES"');
    expect(sql).toContain('JOIN "WORKOUTS_EXERCISES" e');
    expect(sql).not.toContain("'approved'");
  });

  it('down() removes the snapshot tables and assignment columns', async () => {
    const migration = new CreatePrescribedWorkoutDays1793000000002();
    const statements: string[] = [];
    const queryRunner = {
      query: jest.fn(async (sql: string) => {
        statements.push(sql);
      }),
    };

    await migration.down(queryRunner as never);

    const sql = statements.join('\n');
    expect(sql).toContain('DROP TABLE IF EXISTS "WORKOUTS_PRESCRIBED_DAY_EXERCISES"');
    expect(sql).toContain('DROP TABLE IF EXISTS "WORKOUTS_PRESCRIBED_DAYS"');
    expect(sql).toContain('DROP CONSTRAINT IF EXISTS "CHK_WORKOUTS_ASSIGNMENT_SOURCE"');
    expect(sql).toContain('ALTER COLUMN "template_id" SET NOT NULL');
    expect(sql).toContain('DROP COLUMN "plan_template_id"');
  });
});
