import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken, getDataSourceToken } from '@nestjs/typeorm';
import { BadRequestException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { MeasurementLogsService } from './measurement-logs.service';
import { MeasurementLog, MeasurementType } from '../entities/measurement-log.entity';
import { MemberProfile } from '../entities/member-profile.entity';
import { TenantContextService } from '../../shared/tenant/tenant-context.service';

describe('MeasurementLogsService', () => {
  let service: MeasurementLogsService;
  let mockMeasurementLogRepo: Record<string, jest.Mock>;
  let mockMemberProfileRepo: Record<string, jest.Mock>;
  let mockDataSource: Record<string, jest.Mock>;
  let mockTenantContext: Record<string, jest.Mock>;

  const orgId = 'org-123';
  const memberId = 'member-uuid-1';
  const validDto = {
    member_id: memberId,
    measurement_type: MeasurementType.WEIGHT,
    value: 72.5,
    unit: 'kg',
    measured_at: '2026-09-15T10:00:00Z',
    measured_by: undefined,
    notes: undefined,
  };

  beforeEach(async () => {
    mockMeasurementLogRepo = {
      create: jest.fn().mockImplementation((dto) => ({ id: 'meas-1', ...dto })),
      save: jest.fn().mockResolvedValue({ id: 'meas-1' }),
      findAndCount: jest.fn().mockResolvedValue([[], 0]),
    };

    mockMemberProfileRepo = {
      findOne: jest.fn().mockResolvedValue({ id: 'prof-1', member_id: memberId, weight: null }),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };

    mockDataSource = {
      transaction: jest.fn().mockImplementation(async (cb: (mgr: EntityManager) => unknown) => {
        const manager = {
          getRepository: jest.fn().mockImplementation((target: any) => {
            if (target === MeasurementLog) return mockMeasurementLogRepo;
            if (target === MemberProfile) return mockMemberProfileRepo;
            return {};
          }),
        };
        return cb(manager as unknown as EntityManager);
      }),
    };

    mockTenantContext = {
      getCurrentOrganizationId: jest.fn().mockResolvedValue(orgId),
      getRequestedOrganizationId: jest.fn(),
      requireOrganizationAccess: jest.fn(),
      getCurrentBranchId: jest.fn().mockResolvedValue(null),
      validateBranchAccess: jest.fn().mockResolvedValue(true),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MeasurementLogsService,
        { provide: getRepositoryToken(MeasurementLog), useValue: mockMeasurementLogRepo },
        { provide: getRepositoryToken(MemberProfile), useValue: mockMemberProfileRepo },
        { provide: getDataSourceToken(), useValue: mockDataSource },
        { provide: TenantContextService, useValue: mockTenantContext },
      ],
    }).compile();

    service = module.get<MeasurementLogsService>(MeasurementLogsService);
  });

  // Test A: MeasurementLog insert fails → MemberProfile untouched
  it('Test A: MeasurementLog insert fails → MemberProfile is never touched', async () => {
    mockMeasurementLogRepo.save.mockRejectedValue(new Error('DB_INSERT_FAILED'));

    await expect(service.create(validDto)).rejects.toThrow('DB_INSERT_FAILED');

    expect(mockMemberProfileRepo.update).not.toHaveBeenCalled();
    expect(mockDataSource.transaction).toHaveBeenCalledTimes(1);
  });

  // Test B: MemberProfile update fails → MeasurementLog rolled back
  it('Test B: MemberProfile update fails → transaction rolls back MeasurementLog insert', async () => {
    mockMemberProfileRepo.update.mockRejectedValue(new Error('PROFILE_UPDATE_FAILED'));

    await expect(service.create(validDto)).rejects.toThrow('PROFILE_UPDATE_FAILED');

    expect(mockMeasurementLogRepo.save).toHaveBeenCalledTimes(1);
    expect(mockMemberProfileRepo.update).toHaveBeenCalledTimes(1);
    expect(mockDataSource.transaction).toHaveBeenCalledTimes(1);
  });

  // Test C: both writes succeed with correct data
  it('Test C: both writes succeed with correct data', async () => {
    const savedMeasurement = {
      id: 'meas-1',
      organization_id: orgId,
      member_id: memberId,
      measurement_type: MeasurementType.WEIGHT,
      value: 72.5,
      unit: 'kg',
      measured_at: new Date('2026-09-15T10:00:00Z'),
      notes: null,
      measured_by: null,
    };
    mockMeasurementLogRepo.save.mockResolvedValue(savedMeasurement);

    const result = await service.create(validDto);

    expect(result).toBe(savedMeasurement);
    expect(mockMeasurementLogRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        organization_id: orgId,
        member_id: memberId,
        measurement_type: MeasurementType.WEIGHT,
        value: 72.5,
        unit: 'kg',
      }),
    );
    expect(mockMeasurementLogRepo.save).toHaveBeenCalled();
    expect(mockMemberProfileRepo.findOne).toHaveBeenCalledWith({
      where: { member_id: memberId },
    });
    expect(mockMemberProfileRepo.update).toHaveBeenCalledWith(
      { member_id: memberId },
      { weight: '72.5' },
    );
  });

  describe('validation', () => {
    it('rejects reserved measurement types', async () => {
      for (const type of [MeasurementType.CHEST, MeasurementType.WAIST, MeasurementType.HIP, MeasurementType.ARM, MeasurementType.THIGH, MeasurementType.CALF]) {
        await expect(service.create({ ...validDto, measurement_type: type })).rejects.toThrow(BadRequestException);
      }
      expect(mockDataSource.transaction).not.toHaveBeenCalled();
    });

    it('rejects weight out of range', async () => {
      await expect(service.create({ ...validDto, value: 0.5 })).rejects.toThrow(BadRequestException);
      await expect(service.create({ ...validDto, value: 501 })).rejects.toThrow(BadRequestException);
    });

    it('rejects body_fat', async () => {
      await expect(
        service.create({ ...validDto, measurement_type: MeasurementType.BODY_FAT, value: 1, unit: '%' }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.create({ ...validDto, measurement_type: MeasurementType.BODY_FAT, value: 15, unit: 'kg' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('findAll', () => {
    it('returns paginated measurements scoped to organization', async () => {
      const mockData = [
        { id: 'm1', member_id: memberId, measurement_type: MeasurementType.WEIGHT, value: 72.5 } as MeasurementLog,
        { id: 'm2', member_id: memberId, measurement_type: MeasurementType.BODY_FAT, value: 15.2 } as MeasurementLog,
      ];
      mockMeasurementLogRepo.findAndCount.mockResolvedValue([mockData, 2]);

      const result = await service.findAll({ member_id: memberId, page: 1, limit: 20 });

      expect(result.data).toHaveLength(2);
      expect(result.total).toBe(2);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(20);
    });
  });
});
