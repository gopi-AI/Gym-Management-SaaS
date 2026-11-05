import { CreateWorkoutDayAndPlanTemplates1793000000001 } from '../1793000000001-CreateWorkoutDayAndPlanTemplates';

describe('CreateWorkoutDayAndPlanTemplates migration', () => {
  async function runUp(): Promise<string> {
    const migration = new CreateWorkoutDayAndPlanTemplates1793000000001();
    const statements: string[] = [];
    const queryRunner = {
      query: jest.fn(async (sql: string) => {
        statements.push(sql);
      }),
    };
    await migration.up(queryRunner as never);
    expect(migration.name).toBe('CreateWorkoutDayAndPlanTemplates1793000000001');
    return statements.join('\n');
  }

  it('creates the reusable day-template tables with org-scoped indexes and FKs', async () => {
    const sql = await runUp();

    expect(sql).toContain('CREATE TABLE "WORKOUTS_WORKOUT_DAY_TEMPLATES"');
    expect(sql).toContain('CREATE TABLE "WORKOUTS_WORKOUT_DAY_TEMPLATE_EXERCISES"');
    expect(sql).toContain('IDX_WORKOUTS_DAY_TEMPLATES_ORG_NAME');
    expect(sql).toContain('IDX_WORKOUTS_DAY_TEMPLATE_EXERCISES_TEMPLATE');
    expect(sql).toContain('REFERENCES "WORKOUTS_EXERCISES"');
    expect(sql).toContain('REFERENCES "WORKOUTS_WORKOUT_DAY_TEMPLATES"');
  });

  it('creates the weekly plan template with an ordered unique day slot', async () => {
    const sql = await runUp();

    expect(sql).toContain('CREATE TABLE "WORKOUTS_WORKOUT_PLAN_TEMPLATES"');
    expect(sql).toContain('CREATE TABLE "WORKOUTS_WORKOUT_PLAN_TEMPLATE_DAYS"');
    expect(sql).toContain(
      'UQ_WORKOUTS_PLAN_TEMPLATE_DAY_ORDER',
    );
    expect(sql).toContain('UNIQUE ("plan_template_id", "day_order")');
    expect(sql).toContain('"is_rest_day" boolean NOT NULL DEFAULT false');
    expect(sql).toContain('"is_optional" boolean NOT NULL DEFAULT false');
  });

  it('down() drops the four tables', async () => {
    const migration = new CreateWorkoutDayAndPlanTemplates1793000000001();
    const statements: string[] = [];
    const queryRunner = {
      query: jest.fn(async (sql: string) => {
        statements.push(sql);
      }),
    };

    await migration.down(queryRunner as never);

    const sql = statements.join('\n');
    expect(sql).toContain('DROP TABLE IF EXISTS "WORKOUTS_WORKOUT_PLAN_TEMPLATE_DAYS"');
    expect(sql).toContain('DROP TABLE IF EXISTS "WORKOUTS_WORKOUT_PLAN_TEMPLATES"');
    expect(sql).toContain(
      'DROP TABLE IF EXISTS "WORKOUTS_WORKOUT_DAY_TEMPLATE_EXERCISES"',
    );
    expect(sql).toContain('DROP TABLE IF EXISTS "WORKOUTS_WORKOUT_DAY_TEMPLATES"');
  });
});
