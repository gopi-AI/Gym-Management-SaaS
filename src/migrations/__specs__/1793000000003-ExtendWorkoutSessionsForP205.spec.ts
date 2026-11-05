import { ExtendWorkoutSessionsForP2051793000000003 } from '../1793000000003-ExtendWorkoutSessionsForP205';

describe('ExtendWorkoutSessionsForP205 migration', () => {
  async function runUp(): Promise<string> {
    const migration = new ExtendWorkoutSessionsForP2051793000000003();
    const statements: string[] = [];
    const queryRunner = {
      query: jest.fn(async (sql: string) => {
        statements.push(sql);
      }),
    };
    await migration.up(queryRunner as never);
    expect(migration.name).toBe(
      'ExtendWorkoutSessionsForP2051793000000003',
    );
    return statements.join('\n');
  }

  it('adds the session lifecycle, linkage and soft-delete columns', async () => {
    const sql = await runUp();

    expect(sql).toContain('ADD COLUMN "prescribed_day_id" uuid');
    expect(sql).toContain('ADD COLUMN "status" varchar(20) NOT NULL DEFAULT');
    expect(sql).toContain('ADD COLUMN "deleted_at" timestamptz');
    expect(sql).toContain('ADD COLUMN "deleted_by" uuid');
    expect(sql).toContain('ADD COLUMN "created_by" uuid');
    expect(sql).toContain('FK_WORKOUTS_SESSIONS_PRESCRIBED_DAY');
  });

  it('backfills pre-lifecycle rows as finished (never deletes history)', async () => {
    const sql = await runUp();

    expect(sql).toContain("SET \"status\" = 'finished'");
    expect(sql).not.toContain('DELETE FROM');
    expect(sql).not.toContain('DROP TABLE');
  });

  it('adds the member report columns to session exercises', async () => {
    const sql = await runUp();

    expect(sql).toContain(
      'ALTER TABLE "WORKOUTS_WORKOUT_SESSION_EXERCISES"',
    );
    expect(sql).toContain('ADD COLUMN "prescribed_day_exercise_id" uuid');
    expect(sql).toContain('ADD COLUMN "completed" boolean');
    expect(sql).toContain('FK_WORKOUTS_SESSION_EXERCISES_PRESCRIBED');
  });

  it('down() removes the lifecycle columns and FKs', async () => {
    const migration = new ExtendWorkoutSessionsForP2051793000000003();
    const statements: string[] = [];
    const queryRunner = {
      query: jest.fn(async (sql: string) => {
        statements.push(sql);
      }),
    };

    await migration.down(queryRunner as never);

    const sql = statements.join('\n');
    expect(sql).toContain(
      'DROP CONSTRAINT IF EXISTS "FK_WORKOUTS_SESSIONS_PRESCRIBED_DAY"',
    );
    expect(sql).toContain('DROP COLUMN "status"');
    expect(sql).toContain('DROP COLUMN "prescribed_day_id"');
    expect(sql).toContain('DROP COLUMN "completed"');
  });
});
