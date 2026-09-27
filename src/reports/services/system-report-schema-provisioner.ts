import { EntityManager } from 'typeorm';
import { ReportSchema } from '../entities/report-schema.entity';
import { SYSTEM_REPORT_SCHEMAS } from '../constants/system-report-catalog';

/**
 * Provision the system report catalog inside the caller's transaction.
 *
 * This is deliberately a plain function rather than a Nest provider: organization
 * creation supplies the transaction-scoped EntityManager, and provisioning has no
 * request context or authorization concerns of its own.
 */
export async function provisionSystemReportSchemas(
  manager: EntityManager,
  organizationId: string,
): Promise<void> {
  const repository = manager.getRepository(ReportSchema);

  for (const schema of SYSTEM_REPORT_SCHEMAS) {
    const existing = await repository.findOne({
      where: {
        organization_id: organizationId,
        name: schema.name,
        is_system: true,
      },
    });

    if (existing) {
      continue;
    }

    await repository.save(
      repository.create({
        organization_id: organizationId,
        name: schema.name,
        description: schema.description,
        category: schema.category,
        query_definition: schema.query_definition,
        parameters: [],
        is_system: true,
        is_active: true,
        created_by: null,
      }),
    );
  }
}