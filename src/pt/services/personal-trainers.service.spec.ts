import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PersonalTrainersService } from './personal-trainers.service';
import { PersonalTrainer } from '../entities/personal-trainer.entity';
import { TenantContextService } from '../../shared/tenant/tenant-context.service';

describe('PersonalTrainersService', () => {
  let service!: PersonalTrainersService;
  let mockTrainerRepo!: Record<string, jest.Mock>;
  let mockTenantContext!: Record<string, jest.Mock>;

  const orgId = 'org-123';
  const otherOrgId = 'org-999';

  const trainerFixture = {
    id: 'trainer-1',
    organization_id: orgId,
    branch_id: 'branch-1',
    user_id: null,
    first_name: 'Ada',
    last_name: 'Lovelace',
    is_active: true,
  } as PersonalTrainer;

  beforeEach(async () => {
    mockTrainerRepo = {
      create: jest.fn().mockImplementation((dto) => ({ id: 'trainer-1', ...dto })),
      save: jest.fn().mockImplementation((t) => Promise.resolve(t)),
      find: jest.fn().mockResolvedValue([trainerFixture]),
      findOne: jest.fn().mockResolvedValue(trainerFixture),
    };

    mockTenantContext = {
      getCurrentOrganizationId: jest.fn().mockResolvedValue(orgId),
      getRequestedOrganizationId: jest.fn(),
      requireOrganizationAccess: jest.fn().mockResolvedValue(orgId),
      getCurrentBranchId: jest.fn().mockResolvedValue(null),
      validateBranchAccess: jest.fn().mockResolvedValue(true),
      getCurrentUserId: jest.fn().mockResolvedValue('user-1'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PersonalTrainersService,
        { provide: TenantContextService, useValue: mockTenantContext },
        { provide: getRepositoryToken(PersonalTrainer), useValue: mockTrainerRepo },
      ],
    }).compile();

    service = module.get(PersonalTrainersService);
  });

  const createDto = {
    branch_id: 'branch-1',
    first_name: 'Ada',
    last_name: 'Lovelace',
  };

  describe('create', () => {
    it('scopes the trainer to the authorized organization and validates the branch', async () => {
      await service.create(createDto);

      expect(mockTenantContext.validateBranchAccess).toHaveBeenCalledWith(
        orgId,
        'branch-1',
      );
      expect(mockTrainerRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          organization_id: orgId,
          branch_id: 'branch-1',
          first_name: 'Ada',
          last_name: 'Lovelace',
          user_id: null,
          specialty: null,
          certification: null,
          hire_date: null,
          is_active: true,
        }),
      );
      expect(mockTrainerRepo.save).toHaveBeenCalledTimes(1);
    });

    it('refuses a branch that does not belong to the authorized organization', async () => {
      mockTenantContext.validateBranchAccess.mockResolvedValue(false);

      await expect(
        service.create({ ...createDto, branch_id: 'branch-other-org' }),
      ).rejects.toThrow(BadRequestException);
      expect(mockTrainerRepo.save).not.toHaveBeenCalled();
    });

    it('stores an optional user link and profile fields when supplied', async () => {
      await service.create({
        ...createDto,
        user_id: 'user-9',
        specialty: 'Strength',
        certification: 'NASM-CPT',
        hire_date: '2024-04-01',
        is_active: false,
      });

      expect(mockTrainerRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          user_id: 'user-9',
          specialty: 'Strength',
          certification: 'NASM-CPT',
          hire_date: '2024-04-01',
          is_active: false,
        }),
      );
    });
  });

  describe('org-scoping', () => {
    it('findAll filters on the authorized organization and active trainers', async () => {
      await service.findAll();

      expect(mockTrainerRepo.find).toHaveBeenCalledWith({
        where: { organization_id: orgId, is_active: true },
        order: { last_name: 'ASC', first_name: 'ASC' },
      });
    });

    it('findOne scopes by organization_id', async () => {
      await service.findOne('trainer-1');

      expect(mockTrainerRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'trainer-1', organization_id: orgId },
      });
    });

    it('rejects a trainer id from another organization', async () => {
      mockTrainerRepo.findOne.mockResolvedValue(null);

      await expect(service.findOne(otherOrgId)).rejects.toThrow(
        NotFoundException,
      );
      expect(mockTrainerRepo.findOne).toHaveBeenCalledWith({
        where: { id: otherOrgId, organization_id: orgId },
      });
    });

    it('rejects reads with no organization context at all', async () => {
      mockTenantContext.getCurrentOrganizationId.mockResolvedValue(null);
      mockTenantContext.getRequestedOrganizationId.mockResolvedValue(null);

      await expect(service.findAll()).rejects.toThrow(
        'Organization context not found',
      );
      expect(mockTrainerRepo.find).not.toHaveBeenCalled();
    });
  });
});