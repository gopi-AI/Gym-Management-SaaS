import { Test, TestingModule } from '@nestjs/testing';
import { TenantSettingsService } from './tenant-settings.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { TenantSettings } from '../entities/tenant-settings.entity';
import { Repository } from 'typeorm';

describe('TenantSettingsService — Organization Isolation (H4)', () => {
  let service: TenantSettingsService;
  // Use a loosely typed mock object to avoid tsc errors from jest.Mocked + Partial<Repository>
  // inside the compiled TestingModule.
  let mockRepo: Record<string, jest.Mock>;

  beforeEach(async () => {
    mockRepo = {
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      update: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TenantSettingsService,
        { provide: getRepositoryToken(TenantSettings), useValue: mockRepo },
      ],
    }).compile();

    service = module.get<TenantSettingsService>(TenantSettingsService);
  });

  it('findOne scopes the query by organization_id', async () => {
    mockRepo.findOne.mockResolvedValue({ organization_id: 'org-A' } as TenantSettings);

    await service.findOne('org-A');

    expect(mockRepo.findOne).toHaveBeenCalledWith({
      where: { organization_id: 'org-A' },
    });
  });

  it('create uses the authorized org ID as organization_id', async () => {
    const dto = { time_zone: 'UTC', locale: 'en-US', currency: 'USD' };
    const saved = { ...dto, organization_id: 'org-A' } as TenantSettings;
    mockRepo.create.mockReturnValue(saved);
    mockRepo.save.mockResolvedValue(saved);

    const result = await service.create('org-A', dto);

    expect(mockRepo.create).toHaveBeenCalledWith({
      organization_id: 'org-A',
      ...dto,
      is_active: true,
    });
    expect(result.organization_id).toBe('org-A');
  });

  it('update scopes the update WHERE by organization_id', async () => {
    mockRepo.update.mockResolvedValue({ affected: 1 } as any);
    mockRepo.findOne.mockResolvedValue({ organization_id: 'org-A' } as TenantSettings);

    await service.update('org-A', { locale: 'de-DE' });

    expect(mockRepo.update).toHaveBeenCalledWith(
      { organization_id: 'org-A' },
      { locale: 'de-DE' },
    );
  });

  it('findOne returns null for an org that has no settings', async () => {
    mockRepo.findOne.mockResolvedValue(null);

    const result = await service.findOne('non-existent-org');
    expect(result).toBeNull();
  });

  it('prevents data leakage: org-B cannot read org-A settings', async () => {
    mockRepo.findOne.mockResolvedValueOnce({
      organization_id: 'org-A',
    } as TenantSettings);
    mockRepo.findOne.mockResolvedValueOnce(null);

    const settingsA = await service.findOne('org-A');
    expect(settingsA).not.toBeNull();

    const settingsB = await service.findOne('org-B');
    expect(settingsB).toBeNull();
  });
});