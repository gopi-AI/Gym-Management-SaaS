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

  it('provisions exactly 11 system rows with the required attributes', async () => {
    await provisionSystemReportSchemas(manager, organizationId);

    expect(rows).toHaveLength(11);
    expect(rows.map((row) => row.name)).toEqual(SYSTEM_REPORT_SCHEMAS.map((schema) => schema.name));
    expect(rows.every((row) => row.organization_id === organizationId)).toBe(true);
    expect(rows.every((row) => row.is_system && row.is_active)).toBe(true);
    expect(rows.every((row) => row.created_by === null)).toBe(true);
    expect(rows.every((row) => Array.isArray(row.parameters) && row.parameters.length === 0)).toBe(true);
  });

  it('is idempotent when run again for the same organization', async () => {
    await provisionSystemReportSchemas(manager, organizationId);
    await provisionSystemReportSchemas(manager, organizationId);

    expect(rows).toHaveLength(11);
    expect(repository.save).toHaveBeenCalledTimes(11);
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

    expect(rows).toHaveLength(12);
    expect(rows.find((row) => row.id === 'custom-1')).toEqual(custom);
    expect(rows.filter((row) => row.name === custom.name)).toHaveLength(2);
  });
});