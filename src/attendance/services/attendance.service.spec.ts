import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken, getDataSourceToken } from '@nestjs/typeorm';
import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { AttendanceService } from './attendance.service';
import { AttendanceEvent } from '../entities/attendance-event.entity';
import { AttendanceRecord } from '../entities/attendance-record.entity';
import { AttendanceAccessDecision } from '../entities/attendance-access-decision.entity';
import { TenantContextService } from '../../shared/tenant/tenant-context.service';
import { OutboxService } from '../../shared/outbox/outbox.service';
import { MembershipsService } from '../../memberships/services/memberships.service';
import {
  ATTENDANCE_EVENT_KINDS,
  ATTENDANCE_EVENT_TYPES,
  ATTENDANCE_EVENT_VERSION,
} from '../attendance.constants';

/**
 * Behavioral verification of the front-desk attendance flow.
 *
 * The interesting properties are not "was a row written" but "was the DECISION
 * recorded, and was it recorded BEFORE the caller was told no": a refused
 * check-in must persist its audit trail (event + access decision) even though the
 * request ends in an error, and a granted check-in must emit
 * `AttendanceEventRecorded.v1` on the same transaction as the session it belongs
 * to.
 */
describe('AttendanceService', () => {
  let service: AttendanceService;
  let mockRecordRepo: Record<string, jest.Mock>;
  let mockEventRepo: Record<string, jest.Mock>;
  let mockDecisionRepo: Record<string, jest.Mock>;
  let mockDataSource: Record<string, any>;
  let mockTenantContext: Record<string, jest.Mock>;
  let mockOutboxService: Record<string, jest.Mock>;
  let mockMembershipsService: Record<string, jest.Mock>;

  const orgId = '11111111-1111-4111-8111-111111111111';
  const memberId = '22222222-2222-4222-8222-222222222222';
  const userId = '33333333-3333-4333-8333-333333333333';
  const branchId = '44444444-4444-4444-8444-444444444444';

  const savedRecord: AttendanceRecord = {
    id: '55555555-5555-4555-8555-555555555555',
    organization_id: orgId,
    branch_id: null,
    member_id: memberId,
    check_in_time: new Date('2026-02-01T09:00:00.000Z'),
    check_out_time: null,
    check_in_method: 'manual',
    check_out_method: null,
    checked_in_by: userId,
  };

  const savedEvent: AttendanceEvent = {
    id: '66666666-6666-4666-8666-666666666666',
    organization_id: orgId,
    branch_id: null,
    device_id: null,
    member_id: memberId,
    event_time: new Date('2026-02-01T09:00:00.000Z'),
    event_type: ATTENDANCE_EVENT_KINDS.CHECK_IN,
    biometric_id: null,
  };

  const savedDecision: AttendanceAccessDecision = {
    id: '77777777-7777-4777-8777-777777777777',
    attendance_event_id: savedEvent.id,
    is_granted: true,
    reason: null,
    decided_at: new Date('2026-02-01T09:00:00.000Z'),
  };

  beforeEach(async () => {
    mockRecordRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation((dto) => dto),
      // Echo the persisted entity back (with the row's server-generated id), the
      // way TypeORM's save() returns the saved entity.
      save: jest.fn().mockImplementation(async (entity: object) => ({ ...savedRecord, ...entity })),
      createQueryBuilder: jest.fn(),
    };
    mockEventRepo = {
      create: jest.fn().mockImplementation((dto) => dto),
      save: jest.fn().mockResolvedValue(savedEvent),
    };
    mockDecisionRepo = {
      create: jest.fn().mockImplementation((dto) => dto),
      save: jest.fn().mockResolvedValue(savedDecision),
      createQueryBuilder: jest.fn(),
    };

    mockDataSource = {
      transaction: jest.fn().mockImplementation(async (cb: Function) =>
        cb({
          getRepository: jest.fn().mockImplementation((entity: unknown) => {
            if (entity === AttendanceEvent) return mockEventRepo;
            if (entity === AttendanceRecord) return mockRecordRepo;
            if (entity === AttendanceAccessDecision) return mockDecisionRepo;
            return {};
          }),
        }),
      ),
      createQueryBuilder: jest.fn(() => ({
        select: jest.fn().mockReturnThis(),
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getRawOne: jest.fn().mockResolvedValue({ '?column?': 1 }),
      })),
    };

    mockTenantContext = {
      getCurrentOrganizationId: jest.fn().mockResolvedValue(orgId),
      getRequestedOrganizationId: jest.fn().mockResolvedValue(null),
      requireOrganizationAccess: jest.fn().mockResolvedValue(orgId),
      getCurrentUserId: jest.fn().mockResolvedValue(userId),
      validateBranchAccess: jest.fn().mockResolvedValue(true),
    };

    mockOutboxService = { saveEventEnvelope: jest.fn().mockResolvedValue({}) };
    mockMembershipsService = {
      getCheckInEligibility: jest
        .fn()
        .mockResolvedValue({ eligible: true, membership: { id: 'membership-1' } }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AttendanceService,
        { provide: getRepositoryToken(AttendanceRecord), useValue: mockRecordRepo },
        { provide: getRepositoryToken(AttendanceEvent), useValue: mockEventRepo },
        { provide: getRepositoryToken(AttendanceAccessDecision), useValue: mockDecisionRepo },
        { provide: getDataSourceToken(), useValue: mockDataSource },
        { provide: TenantContextService, useValue: mockTenantContext },
        { provide: OutboxService, useValue: mockOutboxService },
        { provide: MembershipsService, useValue: mockMembershipsService },
      ],
    }).compile();

    service = module.get<AttendanceService>(AttendanceService);
  });

  describe('recordCheckIn', () => {
    it('opens a session, records a granted decision and emits AttendanceEventRecorded.v1', async () => {
      const result = await service.recordCheckIn({ member_id: memberId });

      expect(result.record.id).toBe(savedRecord.id);
      expect(result.decision.is_granted).toBe(true);
      expect(result.event.event_type).toBe(ATTENDANCE_EVENT_KINDS.CHECK_IN);

      const record = mockRecordRepo.create.mock.calls[0][0] as Record<string, unknown>;
      expect(record).toMatchObject({
        organization_id: orgId,
        member_id: memberId,
        check_in_method: 'manual',
        check_out_method: null,
        checked_in_by: userId,
      });

      const decision = mockDecisionRepo.create.mock.calls[0][0] as Record<string, unknown>;
      expect(decision).toMatchObject({ is_granted: true, reason: null });

      const [eventType, eventVersion, organizationId, payload, correlationId, , manager] =
        mockOutboxService.saveEventEnvelope.mock.calls[0];
      expect(eventType).toBe(ATTENDANCE_EVENT_TYPES.ATTENDANCE_EVENT_RECORDED);
      expect(eventVersion).toBe(ATTENDANCE_EVENT_VERSION);
      expect(organizationId).toBe(orgId);
      expect(payload).toMatchObject({
        eventId: savedEvent.id,
        memberId,
        eventType: ATTENDANCE_EVENT_KINDS.CHECK_IN,
        deviceId: null,
        biometricId: null,
        checkInMethod: 'manual',
        checkedInBy: userId,
      });
      expect(correlationId).toBe(savedRecord.id);
      // The envelope must travel on the transaction that wrote the session.
      expect(manager).toBeDefined();
    });

    it('never trusts a client timestamp: the event time is stamped server-side', async () => {
      const before = Date.now();
      await service.recordCheckIn({ member_id: memberId });
      const after = Date.now();

      const event = mockEventRepo.create.mock.calls[0][0] as AttendanceEvent;
      expect(event.event_time.getTime()).toBeGreaterThanOrEqual(before);
      expect(event.event_time.getTime()).toBeLessThanOrEqual(after);
    });

    it('records a refused decision instead of nothing when the membership is not eligible', async () => {
      mockMembershipsService.getCheckInEligibility.mockResolvedValue({
        eligible: false,
        reason: 'paused',
      });

      await expect(service.recordCheckIn({ member_id: memberId })).rejects.toBeInstanceOf(
        ForbiddenException,
      );

      // The audit trail must survive the 403.
      expect(mockDecisionRepo.save).toHaveBeenCalledTimes(1);
      expect(mockDecisionRepo.create.mock.calls[0][0]).toMatchObject({
        attendance_event_id: savedEvent.id,
        is_granted: false,
        reason: 'paused',
      });
      expect(mockRecordRepo.save).not.toHaveBeenCalled();
      expect(mockOutboxService.saveEventEnvelope).not.toHaveBeenCalled();
    });

    it('reports the reason code to the caller so the front desk can explain the refusal', async () => {
      mockMembershipsService.getCheckInEligibility.mockResolvedValue({
        eligible: false,
        reason: 'expired',
      });

      await expect(service.recordCheckIn({ member_id: memberId })).rejects.toMatchObject({
        response: { reason: 'expired' },
      });
    });

    it('refuses a second check-in while a session is open (409) and records the decision', async () => {
      mockRecordRepo.findOne.mockResolvedValue(savedRecord);

      await expect(service.recordCheckIn({ member_id: memberId })).rejects.toBeInstanceOf(
        ConflictException,
      );

      expect(mockDecisionRepo.create.mock.calls[0][0]).toMatchObject({
        is_granted: false,
        reason: 'already_checked_in',
      });
      expect(mockOutboxService.saveEventEnvelope).not.toHaveBeenCalled();
    });

    it('translates the open-session unique violation race into a 409', async () => {
      mockRecordRepo.save.mockRejectedValue({ driverError: { code: '23505' } });

      await expect(service.recordCheckIn({ member_id: memberId })).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('rejects a member that does not belong to the authorized organization', async () => {
      mockDataSource.createQueryBuilder = jest.fn(() => ({
        select: jest.fn().mockReturnThis(),
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getRawOne: jest.fn().mockResolvedValue(null),
      }));

      await expect(service.recordCheckIn({ member_id: memberId })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(mockDataSource.transaction).not.toHaveBeenCalled();
    });

    it('rejects a branch outside the authorized organization', async () => {
      mockTenantContext.validateBranchAccess.mockResolvedValue(false);

      await expect(
        service.recordCheckIn({ member_id: memberId, branch_id: branchId }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(mockDataSource.transaction).not.toHaveBeenCalled();
    });
  });

  describe('recordCheckOut', () => {
    it('closes the open session and emits a CHECK_OUT event', async () => {
      mockRecordRepo.findOne.mockResolvedValue({ ...savedRecord });
      mockEventRepo.save.mockResolvedValue({
        ...savedEvent,
        event_type: ATTENDANCE_EVENT_KINDS.CHECK_OUT,
      });

      const result = await service.recordCheckOut({ member_id: memberId });

      expect(result.record.check_out_time).toBeInstanceOf(Date);
      expect(result.record.check_out_method).toBe('manual');
      expect(result.decision.is_granted).toBe(true);

      const payload = mockOutboxService.saveEventEnvelope.mock.calls[0][3] as Record<
        string,
        unknown
      >;
      expect(payload).toMatchObject({
        eventType: ATTENDANCE_EVENT_KINDS.CHECK_OUT,
        checkOutMethod: 'manual',
      });
      expect(payload).not.toHaveProperty('checkInMethod');
    });

    it('refuses a check-out with no open session (409) and records the decision', async () => {
      mockRecordRepo.findOne.mockResolvedValue(null);

      await expect(service.recordCheckOut({ member_id: memberId })).rejects.toBeInstanceOf(
        ConflictException,
      );

      expect(mockDecisionRepo.create.mock.calls[0][0]).toMatchObject({
        is_granted: false,
        reason: 'no_open_check_in',
      });
      expect(mockOutboxService.saveEventEnvelope).not.toHaveBeenCalled();
    });
  });
});
