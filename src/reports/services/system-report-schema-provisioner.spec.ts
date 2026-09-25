import { EntityManager } from 'typeorm';
import { ReportSchema } from '../entities/report-schema.entity';
import { SYSTEM_REPORT_SCHEMAS } from '../constants/system-report-catalog';
import { provisionSystemReportSchemas } from './system-report-schema-provisioner';

describe('provisionSystemReportSchemas', () => {
  const organizationId = 'org-1';
  let rows: ReportSchema[];
  let repository: {
    create: jest.Mock;
    findOne: jest.Mock;
    save: jest.Mock;
  };
  let manager: EntityManager;

  beforeEach(() => {
    rows = [];
    repository = {
      create: jest.fn((value: Partial<ReportSchema>) => value),
      findOne: jest.fn(async ({ where }: { where: Partial<ReportSchema> }) =>
        rows.find(
          (row) =>
            row.organization_id === where.organization_id &&
            row.name === where.name &&
            row.is_system === where.is_system,
        ) ?? null,
      ),
      save: jest.fn(async (row: ReportSchema) => {
        rows.push({ ...row, id: `schema-${rows.length + 1}` } as ReportSchema);
        return row;
      }),
    };
    manager = {
      getRepository: jest.fn().mockReturnValue(repository),
    } as unknown as EntityManager;
  });

  it('provisions exactly 14 system rows with the required attributes', async () => {
    await provisionSystemReportSchemas(manager, organizationId);

    expect(rows).toHaveLength(14);
    expect(rows.map((row) => row.name)).toEqual(SYSTEM_REPORT_SCHEMAS.map((schema) => schema.name));
    expect(rows.every((row) => row.organization_id === organizationId)).toBe(true);
    expect(rows.every((row) => row.is_system && row.is_active)).toBe(true);
    expect(rows.every((row) => row.created_by === null)).toBe(true);
    expect(rows.every((row) => Array.isArray(row.parameters) && row.parameters.length === 0)).toBe(true);

    const ptSessionsReport = rows.find(
      (row) => row.name === 'Completed PT Sessions by Trainer',
    );
    expect(ptSessionsReport?.query_definition).toEqual(
      expect.objectContaining({
        source: 'PTSession',
        columns: expect.objectContaining({
          month: { bucket: 'scheduled_start', unit: 'month' },
          session_count: { fn: 'COUNT', column: '*' },
        }),
        filters: [
          { column: 'scheduled_start', operator: 'BETWEEN', value: ['$from', '$to'] },
          { column: 'status', operator: '=', value: 'completed' },
          { column: 'branch_id', operator: '=', value: '$branchId' },
        ],
        group_by: ['month', 'trainer_id'],
      }),
    );

    const pointsReport = rows.find((row) => row.name === 'Points Issued/Burned');
    expect(pointsReport?.query_definition).toEqual(
      expect.objectContaining({
        source: 'LoyaltyTransaction',
        columns: expect.objectContaining({
          total_points: { fn: 'SUM', column: 'points' },
        }),
        group_by: ['period', 'transaction_type'],
      }),
    );
  });

  /**
   * P6-38's fix, asserted where the defect actually lived.
   *
   * The row was unexecutable because its measure was `AVG(check_out_time -
   * check_in_time)` — an aggregate over a *difference of two columns*, which
   * `ColumnRef` admits in none of its three shapes. Persisting the difference as
   * `AttendanceRecord.duration_minutes` reduces it to `AVG(duration_minutes)`.
   *
   * This asserts the *shape* rather than a string, so it keeps meaning what it
   * means if the row is ever reworded: the measure is an allowlisted aggregate over
   * a single plain column, and no value in the row is an arithmetic expression.
   */
  it('declares P6-38\'s Avg Session Duration as an allowlisted aggregate over a real column', async () => {
    await provisionSystemReportSchemas(manager, organizationId);

    const row = rows.find((candidate) => candidate.name === 'Avg Session Duration');
    expect(row).toBeDefined();

    const definition = row?.query_definition as {
      source: string;
      columns: Record<string, unknown>;
      group_by?: readonly string[];
    };

    expect(definition.source).toBe('AttendanceRecord');
    expect(definition.columns.avg_duration).toEqual({
      fn: 'AVG',
      column: 'duration_minutes',
    });

    // The row's declared `member_id` dimension is preserved as the grouping key,
    // so the AVG is per member rather than a single figure per organization.
    expect(definition.columns.member_id).toBe('member_id');
    expect(definition.group_by).toEqual(['member_id']);

    // No column value may be anything other than a string, a bucket, or an
    // aggregate object — this is what an arithmetic expression would break.
    for (const ref of Object.values(definition.columns)) {
      const isAggregate =
        typeof ref === 'object' && ref !== null && 'fn' in (ref as object);
      const isBucket =
        typeof ref === 'object' && ref !== null && 'bucket' in (ref as object);
      expect(typeof ref === 'string' || isAggregate || isBucket).toBe(true);
    }
  });

  it('is idempotent when run again for the same organization', async () => {
    await provisionSystemReportSchemas(manager, organizationId);
    await provisionSystemReportSchemas(manager, organizationId);

    expect(rows).toHaveLength(14);
    expect(repository.save).toHaveBeenCalledTimes(14);
  });

  it('does not suppress or modify a custom same-name row', async () => {
    const custom = {
      id: 'custom-1',
      organization_id: organizationId,
      name: SYSTEM_REPORT_SCHEMAS[0].name,
      description: 'Custom replacement',
      category: 'custom',
      query_definition: { source: 'Member', columns: {} },
      parameters: ['custom'],
      is_system: false,
      is_active: true,
      created_by: 'user-1',
    } as unknown as ReportSchema;
    rows.push(custom);

    await provisionSystemReportSchemas(manager, organizationId);

    // 14 provisioned system rows plus the pre-existing custom one.
    expect(rows).toHaveLength(15);
    expect(rows.find((row) => row.id === 'custom-1')).toEqual(custom);
    expect(rows.filter((row) => row.name === custom.name)).toHaveLength(2);
  });
});