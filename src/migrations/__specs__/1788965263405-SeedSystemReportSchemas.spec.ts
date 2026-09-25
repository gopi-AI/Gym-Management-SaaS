import { QueryRunner } from 'typeorm';
import {
  SYSTEM_REPORT_SCHEMAS,
  SeedSystemReportSchemas1788965263405,
} from '../1788965263405-SeedSystemReportSchemas';

interface ReportSchemaRow {
  id: string;
  organization_id: string;
  name: string;
  description: string;
  category: string;
  query_definition: Record<string, unknown>;
  parameters: unknown[];
  is_system: boolean;
  is_active: boolean;
  created_by: string | null;
}

/**
 * The fake runner understands the migration's exact SQL and applies its inserts
 * and deletes to in-memory rows. This exercises the real check-then-insert and
 * scoped cleanup behavior rather than returning canned query results.
 */
class FakeQueryRunner {
  organizations = [{ id: 'org-a' }, { id: 'org-b' }];
  reportSchemas: ReportSchemaRow[] = [];
  statements: Array<{ sql: string; params: unknown[] }> = [];

  private sequence = 0;

  private nextId(): string {
    this.sequence += 1;
    return `schema-${String(this.sequence).padStart(3, '0')}`;
  }

  async query(sql: string, params: unknown[] = []): Promise<Array<Record<string, unknown>>> {
    const query = sql.replace(/\s+/g, ' ').trim();
    this.statements.push({ sql: query, params });

    if (query === 'SELECT "id" FROM "TENANCY_ORGANIZATIONS" ORDER BY "id" ASC') {
      return this.organizations;
    }

    if (query.startsWith('SELECT "id" FROM "REPORTS_REPORT_SCHEMAS"')) {
      const [organizationId, name] = params as [string, string];
      return this.reportSchemas
        .filter(
          (row) =>
            row.organization_id === organizationId && row.name === name && row.is_system === true,
        )
        .map((row) => ({ id: row.id }));
    }

    if (query.startsWith('INSERT INTO "REPORTS_REPORT_SCHEMAS"')) {
      const [organizationId, name, description, category, definition, parameters] = params as [
        string,
        string,
        string,
        string,
        string,
        string,
      ];
      this.reportSchemas.push({
        id: this.nextId(),
        organization_id: organizationId,
        name,
        description,
        category,
        query_definition: JSON.parse(definition),
        parameters: JSON.parse(parameters),
        is_system: true,
        is_active: true,
        created_by: null,
      });
      return [];
    }

    if (query.startsWith('DELETE FROM "REPORTS_REPORT_SCHEMAS"')) {
      const [names] = params as [string[]];
      this.reportSchemas = this.reportSchemas.filter(
        (row) => !(row.is_system === true && names.includes(row.name)),
      );
      return [];
    }

    throw new Error(`QueryRunner received an unexpected statement: ${query}`);
  }
}

describe('Phase 6 system report schema seed migration', () => {
  const asQueryRunner = (runner: FakeQueryRunner): QueryRunner => runner as unknown as QueryRunner;
  const migration = () => new SeedSystemReportSchemas1788965263405();

  it('defines exactly the 11 reviewed catalog rows and excludes deferred reports', () => {
    expect(SYSTEM_REPORT_SCHEMAS).toHaveLength(11);
    expect(SYSTEM_REPORT_SCHEMAS.map((schema) => schema.name)).toEqual([
      'New Members (Daily/Weekly/Monthly)',
      'Member Demographics',
      'Membership Status Distribution',
      'Membership Tenure Distribution',
      'Revenue Summary',
      'Membership Sales by Plan',
      'Outstanding Invoices',
      'Payment Method Mix',
      'Daily Check-ins',
      'Peak Hours',
      'Week-over-Week Trend',
    ]);
    expect(SYSTEM_REPORT_SCHEMAS.map((schema) => schema.name)).not.toEqual(
      expect.arrayContaining(['Refund Report', 'Avg Session Duration']),
    );
  });

  it('seeds exactly 11 rows per organization with the required attributes', async () => {
    const runner = new FakeQueryRunner();

    await migration().up(asQueryRunner(runner));

    expect(runner.reportSchemas).toHaveLength(22);
    for (const organization of runner.organizations) {
      const rows = runner.reportSchemas.filter((row) => row.organization_id === organization.id);
      expect(rows).toHaveLength(11);
      expect(rows.every((row) => row.is_system && row.is_active)).toBe(true);
      expect(rows.every((row) => row.created_by === null)).toBe(true);
      expect(rows.every((row) => Array.isArray(row.parameters) && row.parameters.length === 0)).toBe(true);
      expect(rows.map((row) => row.name)).toEqual(SYSTEM_REPORT_SCHEMAS.map((schema) => schema.name));
      expect(rows.every((row) => row.query_definition && row.category && row.description)).toBe(true);
    }
    expect(new Set(runner.reportSchemas.map((row) => row.organization_id))).toEqual(
      new Set(['org-a', 'org-b']),
    );
  });

  it('is idempotent and preserves a custom row', async () => {
    const runner = new FakeQueryRunner();
    runner.reportSchemas.push({
      id: 'custom-001',
      organization_id: 'org-a',
      name: 'New Members (Daily/Weekly/Monthly)',
      description: 'Custom replacement',
      category: 'custom',
      query_definition: { source: 'Member', columns: { id: 'id' } },
      parameters: [],
      is_system: false,
      is_active: true,
      created_by: 'user-001',
    });

    await migration().up(asQueryRunner(runner));
    await migration().up(asQueryRunner(runner));

    expect(runner.reportSchemas).toHaveLength(23);
    expect(runner.reportSchemas.filter((row) => row.is_system)).toHaveLength(22);
    expect(runner.reportSchemas.filter((row) => !row.is_system)).toEqual([
      expect.objectContaining({ id: 'custom-001', name: 'New Members (Daily/Weekly/Monthly)' }),
    ]);
  });

  it('down removes only the 11 system rows per organization and leaves custom/system-unrelated rows', async () => {
    const runner = new FakeQueryRunner();
    runner.reportSchemas.push(
      {
        id: 'custom-001',
        organization_id: 'org-a',
        name: 'New Members (Daily/Weekly/Monthly)',
        description: 'Custom replacement',
        category: 'custom',
        query_definition: { source: 'Member', columns: { id: 'id' } },
        parameters: [],
        is_system: false,
        is_active: true,
        created_by: 'user-001',
      },
      {
        id: 'other-system-001',
        organization_id: 'org-a',
        name: 'Other System Report',
        description: 'Not owned by this migration',
        category: 'custom',
        query_definition: { source: 'Member', columns: { id: 'id' } },
        parameters: [],
        is_system: true,
        is_active: true,
        created_by: null,
      },
    );

    await migration().up(asQueryRunner(runner));
    await migration().down(asQueryRunner(runner));

    expect(runner.reportSchemas).toEqual([
      expect.objectContaining({ id: 'custom-001', is_system: false }),
      expect.objectContaining({ id: 'other-system-001', name: 'Other System Report', is_system: true }),
    ]);
  });
});