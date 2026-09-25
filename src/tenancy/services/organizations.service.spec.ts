import { EntityManager } from 'typeorm';
import { Organization } from '../entities/organization.entity';
import { OrganizationsService } from './organizations.service';
import { ReportSchema } from '../../reports/entities/report-schema.entity';

describe('OrganizationsService.create', () => {
  const dto = {
    name: 'Gym One',
    timezone: 'UTC',
    locale: 'en-US',
    currency: 'USD',
  };

  it('uses one transaction manager for the organization and report writes', async () => {
    const organization = { id: 'org-1', ...dto, is_active: true } as Organization;
    const organizationRepository = {
      create: jest.fn((value: Partial<Organization>) => value),
      save: jest.fn().mockResolvedValue(organization),
    };
    const reportRepository = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((value: Partial<ReportSchema>) => value),
      save: jest.fn().mockResolvedValue({}),
    };
    const manager = {
      getRepository: jest.fn((entity: unknown) =>
        entity === Organization ? organizationRepository : reportRepository,
      ),
    } as unknown as EntityManager;
    const dataSource = {
      transaction: jest.fn(async (callback: (manager: EntityManager) => Promise<Organization>) => {
        return callback(manager);
      }),
    };
    const service = new OrganizationsService(
      {} as never,
      dataSource as never,
      {} as never,
    );

    await service.create(dto);

    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    expect(organizationRepository.save).toHaveBeenCalledTimes(1);
    expect(reportRepository.save).toHaveBeenCalledTimes(13);
    expect(manager.getRepository).toHaveBeenCalledWith(Organization);
    expect(manager.getRepository).toHaveBeenCalledWith(ReportSchema);
  });

  it('propagates provisioning failure so the transaction rolls back the organization', async () => {
    let organizationPersisted = false;
    const organization = { id: 'org-1', ...dto, is_active: true } as Organization;
    const organizationRepository = {
      create: jest.fn((value: Partial<Organization>) => value),
      save: jest.fn(async () => {
        organizationPersisted = true;
        return organization;
      }),
    };
    const reportRepository = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((value: Partial<ReportSchema>) => value),
      save: jest.fn().mockRejectedValue(new Error('provisioning failed')),
    };
    const manager = {
      getRepository: jest.fn((entity: unknown) =>
        entity === Organization ? organizationRepository : reportRepository,
      ),
    } as unknown as EntityManager;
    const dataSource = {
      transaction: jest.fn(async (callback: (manager: EntityManager) => Promise<Organization>) => {
        try {
          return await callback(manager);
        } catch (error) {
          organizationPersisted = false;
          throw error;
        }
      }),
    };
    const service = new OrganizationsService(
      {} as never,
      dataSource as never,
      {} as never,
    );

    await expect(service.create(dto)).rejects.toThrow('provisioning failed');
    expect(organizationPersisted).toBe(false);
    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
  });
});