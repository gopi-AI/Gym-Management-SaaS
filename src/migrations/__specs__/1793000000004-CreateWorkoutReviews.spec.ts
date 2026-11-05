import { CreateWorkoutReviews1793000000004 } from '../1793000000004-CreateWorkoutReviews';

describe('CreateWorkoutReviews migration', () => {
  async function runUp(): Promise<string> {
    const migration = new CreateWorkoutReviews1793000000004();
    const statements: string[] = [];
    const queryRunner = {
      query: jest.fn(async (sql: string) => {
        statements.push(sql);
      }),
    };
    await migration.up(queryRunner as never);
    expect(migration.name).toBe('CreateWorkoutReviews1793000000004');
    return statements.join('\n');
  }

  it('creates append-only submissions and their exercise snapshots', async () => {
    const sql = await runUp();

    expect(sql).toContain('CREATE TABLE "WORKOUTS_PLAN_DAY_SUBMISSIONS"');
    expect(sql).toContain(
      'CREATE TABLE "WORKOUTS_PLAN_DAY_SUBMISSION_EXERCISES"',
    );
    expect(sql).toContain('IDX_WORKOUTS_SUBMISSIONS_ORG_DAY');
    expect(sql).toContain('"completed" boolean');
    expect(sql).toContain('FK_WORKOUTS_SUBMISSION_EXERCISES_PRESCRIBED');
  });

  it('creates trainer day reviews linked to the reviewed submission', async () => {
    const sql = await runUp();

    expect(sql).toContain('CREATE TABLE "WORKOUTS_PLAN_DAY_REVIEWS"');
    expect(sql).toContain('"decision" varchar(30) NOT NULL');
    expect(sql).toContain('FK_WORKOUTS_PLAN_DAY_REVIEWS_SUBMISSION');
    expect(sql).toContain('ON DELETE SET NULL');
  });

  it('creates progress reviews and measurement snapshots referencing the real measurement table', async () => {
    const sql = await runUp();

    expect(sql).toContain('CREATE TABLE "WORKOUTS_PROGRESS_REVIEWS"');
    expect(sql).toContain('"approved_days" int NOT NULL');
    expect(sql).toContain('"prescribed_days" int NOT NULL');
    expect(sql).toContain('"progress_percentage" int NOT NULL');
    expect(sql).toContain('"plan_day_summary" jsonb');
    expect(sql).toContain('"attendance_summary" jsonb');
    expect(sql).toContain(
      'CREATE TABLE "WORKOUTS_PROGRESS_REVIEW_MEASUREMENTS"',
    );
    expect(sql).toContain('REFERENCES "MEMBERS_MEMBER_MEASUREMENTS"');
    expect(sql).toContain('UQ_WORKOUTS_REVIEW_MEASUREMENT');
    expect(sql).toContain('FK_WORKOUTS_ASSIGNMENT_PROGRESS_REVIEW');
  });

  it('down() drops the review tables and the assignment FK', async () => {
    const migration = new CreateWorkoutReviews1793000000004();
    const statements: string[] = [];
    const queryRunner = {
      query: jest.fn(async (sql: string) => {
        statements.push(sql);
      }),
    };

    await migration.down(queryRunner as never);

    const sql = statements.join('\n');
    expect(sql).toContain(
      'DROP CONSTRAINT IF EXISTS "FK_WORKOUTS_ASSIGNMENT_PROGRESS_REVIEW"',
    );
    expect(sql).toContain(
      'DROP TABLE IF EXISTS "WORKOUTS_PROGRESS_REVIEW_MEASUREMENTS"',
    );
    expect(sql).toContain('DROP TABLE IF EXISTS "WORKOUTS_PROGRESS_REVIEWS"');
    expect(sql).toContain('DROP TABLE IF EXISTS "WORKOUTS_PLAN_DAY_REVIEWS"');
    expect(sql).toContain(
      'DROP TABLE IF EXISTS "WORKOUTS_PLAN_DAY_SUBMISSION_EXERCISES"',
    );
    expect(sql).toContain('DROP TABLE IF EXISTS "WORKOUTS_PLAN_DAY_SUBMISSIONS"');
  });
});
