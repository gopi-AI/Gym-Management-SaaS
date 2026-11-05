import { AddExerciseMedia1793000000000 } from '../1793000000000-AddExerciseMedia';

describe('AddExerciseMedia migration', () => {
  it('adds the optional media columns without touching existing rows', async () => {
    const migration = new AddExerciseMedia1793000000000();
    const statements: string[] = [];
    const queryRunner = {
      query: jest.fn(async (sql: string) => {
        statements.push(sql);
      }),
    };

    await migration.up(queryRunner as never);

    expect(migration.name).toBe('AddExerciseMedia1793000000000');
    const sql = statements.join('\n');
    expect(sql).toContain('ALTER TABLE "WORKOUTS_EXERCISES"');
    expect(sql).toContain('"image_key" varchar(1024)');
    expect(sql).toContain('"image_mime_type" varchar(100)');
    expect(sql).toContain('"gif_key" varchar(1024)');
    expect(sql).toContain('"gif_mime_type" varchar(100)');
    expect(sql).toContain('"video_url" varchar(2048)');
    expect(sql).not.toContain('UPDATE');
    expect(sql).not.toContain('DELETE');
  });

  it('down() drops every added column', async () => {
    const migration = new AddExerciseMedia1793000000000();
    const statements: string[] = [];
    const queryRunner = {
      query: jest.fn(async (sql: string) => {
        statements.push(sql);
      }),
    };

    await migration.down(queryRunner as never);

    const sql = statements.join('\n');
    expect(sql).toContain('DROP COLUMN "video_url"');
    expect(sql).toContain('DROP COLUMN "gif_mime_type"');
    expect(sql).toContain('DROP COLUMN "gif_key"');
    expect(sql).toContain('DROP COLUMN "image_mime_type"');
    expect(sql).toContain('DROP COLUMN "image_key"');
  });
});
