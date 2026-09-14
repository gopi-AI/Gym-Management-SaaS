import { Test, TestingModule } from '@nestjs/testing';
import { MembershipsController } from './memberships.controller';
import { MembershipsService } from '../services/memberships.service';

describe('MembershipsController', () => {
  let controller: MembershipsController;
  let mockService: Record<string, jest.Mock>;

  beforeEach(async () => {
    mockService = {
      findAll: jest.fn(),
      findOne: jest.fn(),
      findByMember: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      pause: jest.fn(),
      resume: jest.fn(),
      freeze: jest.fn(),
      unfreeze: jest.fn(),
      cancel: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [MembershipsController],
      providers: [
        { provide: MembershipsService, useValue: mockService },
      ],
    }).compile();

    controller = module.get<MembershipsController>(MembershipsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('GET /v1/memberships', () => {
    it('should call findAll with query params', async () => {
      const query = { page: 1, limit: 20 };
      const expected = { data: [], total: 0, page: 1, limit: 20 };
      mockService.findAll.mockResolvedValue(expected);
      const result = await controller.findAll(query);
      expect(result).toEqual(expected);
      expect(mockService.findAll).toHaveBeenCalledWith(query);
    });
  });

  describe('GET /v1/memberships/:id', () => {
    it('should call findOne with id', async () => {
      const expected = { id: 'm1' };
      mockService.findOne.mockResolvedValue(expected);
      const result = await controller.findOne('m1');
      expect(result).toEqual(expected);
      expect(mockService.findOne).toHaveBeenCalledWith('m1');
    });
  });
describe('GET /v1/memberships/member/:memberId', () => {
    it('should call findByMember with memberId and query', async () => {
      const query = { status: 'active' };
      const expected = { data: [], total: 0, page: 1, limit: 20 };
      mockService.findByMember.mockResolvedValue(expected);
      const result = await controller.findByMember('member-1', query);
      expect(result).toEqual(expected);
      expect(mockService.findByMember).toHaveBeenCalledWith('member-1', query);
    });
  });

  describe('POST /v1/memberships', () => {
    it('should call create with dto', async () => {
      const dto = { member_id: 'member-1', plan_id: 'plan-1' };
      const expected = { id: 'new-m1' };
      mockService.create.mockResolvedValue(expected);
      const result = await controller.create(dto);
      expect(result).toEqual(expected);
      expect(mockService.create).toHaveBeenCalledWith(dto);
    });
  });

  describe('PATCH /v1/memberships/:id', () => {
    it('should call update with id and dto', async () => {
      const dto = { plan_id: 'plan-2' };
      const expected = { id: 'm1', plan_id: 'plan-2' };
      mockService.update.mockResolvedValue(expected);
      const result = await controller.update('m1', dto);
      expect(result).toEqual(expected);
      expect(mockService.update).toHaveBeenCalledWith('m1', dto);
    });
  });

  describe('POST /v1/memberships/:id/pause', () => {
    it('should call pause with id and dto', async () => {
      const dto = { reason: 'Vacation' };
      const expected = { id: 'm1', status: 'paused' };
      mockService.pause.mockResolvedValue(expected);
      const result = await controller.pause('m1', dto);
      expect(result).toEqual(expected);
      expect(mockService.pause).toHaveBeenCalledWith('m1', dto);
    });
  });

  describe('POST /v1/memberships/:id/resume', () => {
    it('should call resume with id', async () => {
      const expected = { id: 'm1', status: 'active' };
      mockService.resume.mockResolvedValue(expected);
      const result = await controller.resume('m1', { reason: 'Back' });
      expect(result).toEqual(expected);
      expect(mockService.resume).toHaveBeenCalledWith('m1', { reason: 'Back' });
    });
  });

  describe('POST /v1/memberships/:id/freeze', () => {
    it('should call freeze with id', async () => {
      const expected = { id: 'm1', status: 'frozen' };
      mockService.freeze.mockResolvedValue(expected);
      const result = await controller.freeze('m1', {});
      expect(result).toEqual(expected);
      expect(mockService.freeze).toHaveBeenCalledWith('m1', {});
    });
  });

  describe('POST /v1/memberships/:id/unfreeze', () => {
    it('should call unfreeze with id', async () => {
      const expected = { id: 'm1', status: 'active' };
      mockService.unfreeze.mockResolvedValue(expected);
      const result = await controller.unfreeze('m1', {});
      expect(result).toEqual(expected);
      expect(mockService.unfreeze).toHaveBeenCalledWith('m1', {});
    });
  });

  describe('POST /v1/memberships/:id/cancel', () => {
    it('should call cancel with id and dto', async () => {
      const dto = { reason: 'Leaving' };
      const expected = { id: 'm1', status: 'cancelled' };
      mockService.cancel.mockResolvedValue(expected);
      const result = await controller.cancel('m1', dto);
      expect(result).toEqual(expected);
      expect(mockService.cancel).toHaveBeenCalledWith('m1', dto);
    });
  });
});