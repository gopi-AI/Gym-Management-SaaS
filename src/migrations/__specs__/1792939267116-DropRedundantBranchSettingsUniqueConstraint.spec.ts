import { DropRedundantBranchSettingsUniqueConstraint1792939267116 } from '../1792939267116-DropRedundantBranchSettingsUniqueConstraint';

describe('DropRedundantBranchSettingsUniqueConstraint migration', () => {
  const migrationName =
    'DropRedundantBranchSettingsUniqueConstraint1792939267116';

  function createRunner(indexRows: Array<Record<string, unknown>>) {
    const statements: string[] = [];
    const query = jest.fn(async (sql: string) => {
      statements.push(sql);
      return sql.includes('FROM pg_index i') ? indexRows : undefined;
    });
    return { runner: { query }, statements };
  }

  it('verifies the shipped unique index, then drops the redundant constraint', async () => {
    const { runner, statements } = createRunner([{ '?column?': 1 }]);

    await new DropRedundantBranchSettingsUniqueConstraint1792939267116().up(
      runner as never,
    );

    expect(statements).toHaveLength(2);
    expect(statements[0]).toContain('FROM pg_index i');
    expect(statements[0]).toContain(
      "ix.relname = 'IDX_branch_settings_branch_org'",
    );
    expect(statements[0]).toContain('i.indisunique');
    expect(statements[0]).toContain('i.indisvalid');
    expect(statements[1]).toContain(
      'ALTER TABLE "TENANCY_BRANCH_SETTINGS" DROP CONSTRAINT IF EXISTS "UQ_branch_settings_branch_org"',
    );
  });

  it('fails closed without issuing the drop when the canonical unique index is absent', async () => {
    const { runner, statements } = createRunner([]);

    await expect(
      new DropRedundantBranchSettingsUniqueConstraint1792939267116().up(
        runner as never,
      ),
    ).rejects.toThrow(
      /canonical unique index IDX_branch_settings_branch_org/i,
    );

    expect(statements).toHaveLength(1);
    expect(statements[0]).not.toContain('DROP CONSTRAINT');
  });

  it('never deletes rows, truncates, or drops tables', async () => {
    const { runner, statements } = createRunner([{ '?column?': 1 }]);

    await new DropRedundantBranchSettingsUniqueConstraint1792939267116().up(
      runner as never,
    );

    expect(statements.join('\n')).not.toMatch(
      /\b(DELETE|TRUNCATE|DROP\s+TABLE)\b/i,
    );
  });

  it('keeps a stable, timestamp-suffixed migration identity', () => {
    const migration = new DropRedundantBranchSettingsUniqueConstraint1792939267116();

    expect(migration.name).toBe(migrationName);
    expect(migration.name).toMatch(/\d{13}$/);
  });

  it('has an intentionally empty down() that cannot reintroduce the constraint', async () => {
    const query = jest.fn();
    const migration = new DropRedundantBranchSettingsUniqueConstraint1792939267116();

    await (
      migration.down as unknown as (runner: unknown) => Promise<void>
    )({ query });

    expect(query).not.toHaveBeenCalled();
  });
});
