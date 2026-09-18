import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

/**
 * Loader contract for the TypeORM migration glob.
 *
 * `src/migrations/*{.ts,.js}` (`src/data-source.ts`, and the same glob in
 * `app.module.ts`) is loaded wholesale by the TypeORM CLI, and
 * `DirectoryExportedClassesLoader.loadFileClasses` puts **every exported
 * function** it finds on the migration list — it only recurses through arrays
 * and plain objects, so `export const` is inert. `MigrationExecutor` then
 * requires a 13-digit JavaScript timestamp suffix on each entry's name and
 * aborts the whole run with
 *
 *   "... migration name is wrong. Migration class name should have a
 *    JavaScript timestamp appended."
 *
 * for anything else. That is not a warning: a single exported helper function in
 * `src/migrations/` makes `migration:run` **and** `migration:revert` fail
 * outright for *every* migration, in every environment, including deploys.
 *
 * That is exactly what `1788965263253-CreateFinanceLedgerViews.ts` used to do
 * with its three view-SQL builders. They now live in
 * `src/finance/ledger-views.constants.ts`, outside the glob.
 *
 * These assertions are static (they read the source rather than booting a
 * DataSource) so they fail fast and point at the offending file and line.
 */
const MIGRATIONS_DIR = join(__dirname, '..');

/** Files the CLI actually loads: everything directly in `src/migrations/`. */
function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.ts$/.test(entry.name) && !/\.spec\.ts$/.test(entry.name))
    .map((entry) => entry.name);
}

describe('migration loader contract', () => {
  const files = migrationFiles();

  it('finds the migration files it is meant to be guarding', () => {
    // Guards against the guard silently passing on an empty directory.
    expect(files.length).toBeGreaterThan(20);
    expect(files).toContain('1788965263253-CreateFinanceLedgerViews.ts');
  });

  it('exports no function from any file the CLI loads as a migration', () => {
    // `export function`, `export async function` and `export default function`
    // are all pushed onto the migration list by the loader.
    const offenders: string[] = [];

    for (const file of files) {
      const source = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');

      source.split('\n').forEach((line, index) => {
        if (/^\s*export\s+(async\s+)?function\s/.test(line)) {
          offenders.push(`${file}:${index + 1}  ${line.trim()}`);
        }
      });
    }

    // The message names the file and line so the fix is obvious: move the
    // helper out of `src/migrations/` (see ledger-views.constants.ts) rather
    // than deleting the export.
    expect(offenders).toEqual([]);
  });

  it('exports exactly one migration class per file, each timestamp-suffixed', () => {
    for (const file of files) {
      const source = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
      const classes = source.match(/^\s*export\s+class\s+(\w+)/gm) ?? [];

      // One class per file is the convention the rest of the directory follows.
      expect({ file, count: classes.length }).toEqual({ file, count: 1 });

      const name = classes[0]?.replace(/^\s*export\s+class\s+/, '') ?? '';

      // The exact shape MigrationExecutor demands: a 13-digit timestamp suffix.
      expect({ file, hasTimestamp: /\d{13}$/.test(name) }).toEqual({
        file,
        hasTimestamp: true,
      });
    }
  });

  it('keeps the view-SQL builders outside the glob, where the loader cannot see them', () => {
    // A regression here reintroduces the fatal CLI error, so the location is
    // asserted rather than left to convention.
    const migration = readFileSync(
      join(MIGRATIONS_DIR, '1788965263253-CreateFinanceLedgerViews.ts'),
      'utf8',
    );
    const constants = readFileSync(
      join(MIGRATIONS_DIR, '..', 'finance', 'ledger-views.constants.ts'),
      'utf8',
    );

    expect(migration).not.toMatch(/export\s+function/);
    expect(constants).toMatch(/export\s+function\s+buildMemberOutstandingViewSql/);
    expect(constants).toMatch(/export\s+function\s+buildRevenueByPeriodViewSql/);
    expect(constants).toMatch(/export\s+function\s+buildOutstandingByStatusViewSql/);
  });
});
