import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken, getDataSourceToken } from '@nestjs/typeorm';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import * as fs from 'fs';
import * as path from 'path';
import { PtSessionsService } from './pt-sessions.service';
import { PTSession } from '../entities/pt-session.entity';
import { PTEnrollment } from '../entities/pt-enrollment.entity';
import { PersonalTrainer } from '../entities/personal-trainer.entity';
import { PTSessionStatus } from '../entities/pt-session-status.enum';
import { PTEnrollmentStatus } from '../entities/pt-enrollment-status.enum';
import { TenantContextService } from '../../shared/tenant/tenant-context.service';
import { OutboxService } from '../../shared/outbox/outbox.service';

/** Recursively list the module's production TypeScript sources. */
function listTypeScriptFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return listTypeScriptFiles(full);
    return entry.isFile() &&
      entry.name.endsWith('.ts') &&
      !entry.name.endsWith('.spec.ts')
      ? [full]
      : [];
  });
}

describe('PtSessionsService', () => {
  let service!: PtSessionsService;
  let mockSessionRepo!: Record<string, jest.Mock>;
  let mockEnrollmentRepo!: Record<string, jest.Mock>;
  let mockTrainerRepo!: Record<string, jest.Mock>;
  let mockDataSource!: Record<string, jest.Mock>;
  let mockTenantContext!: Record<string, jest.Mock>;
  let mockOutbox!: Record<string, jest.Mock>;

  const orgId = 'org-123';

  const enrollmentFixture = {
    id: 'enrollment-1',
    organization_id: orgId,
    member_id: 'member-uuid-1',
    package_id: 'package-1',
    trainer_id: 'trainer-1',
    start_date: '2026-09-01',
    end_date: null,
    sessions_used: 0,
    session_count: 5,
    status: PTEnrollmentStatus.ACTIVE,
  } as PTEnrollment;

  const trainerFixture = {
    id: 'trainer-1',
    organization_id: orgId,
    branch_id: 'branch-1',
    is_active: true,
  } as PersonalTrainer;

  const sessionFixture = {
    id: 'session-1',
    organization_id: orgId,
    branch_id: 'branch-1',
    member_id: 'member-uuid-1',
    trainer_id: 'trainer-1',
    enrollment_id: 'enrollment-1',
    scheduled_start: new Date('2026-09-02T09:00:00Z'),
    scheduled_end: new Date('2026-09-02T10:00:00Z'),
    actual_start: null,
    actual_end: null,
    status: PTSessionStatus.SCHEDULED,
    notes: null,
    workout_session_id: null,
} as PTSession;

  const bookDto = {
    enrollment_id: 'enrollment-1',
    scheduled_start: '2026-09-02T09:00:00.000Z',
    scheduled_end: '2026-09-02T10:00:00.000Z',
  };

  beforeEach(async () => {
    mockSessionRepo = {
      create: jest.fn().mockImplementation((dto) => ({ id: 'session-1', ...dto })),
      save: jest.fn().mockImplementation((s) => Promise.resolve(s)),
      find: jest.fn().mockResolvedValue([sessionFixture]),
      findOne: jest.fn().mockImplementation(({ where }) =>
        Promise.resolve(where.id === 'session-1' ? { ...sessionFixture } : null),
      ),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };

    mockEnrollmentRepo = {
      findOne: jest.fn().mockResolvedValue(enrollmentFixture),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      save: jest.fn().mockImplementation((e) => Promise.resolve(e)),
      find: jest.fn().mockResolvedValue([enrollmentFixture]),
    };

    mockTrainerRepo = {
      findOne: jest.fn().mockResolvedValue(trainerFixture),
    };

    // Throws for any repository other than the two PT entities this flow owns:
    // an attendance write, a commission write, or a workout-assignment write
    // would all fail loudly here.
    mockDataSource = {
      getRepository: jest.fn().mockImplementation((target: unknown) => {
        if (target === PTSession) return mockSessionRepo;
        if (target === PTEnrollment) return mockEnrollmentRepo;
        throw new Error(
          `PtSessionsService requested an unexpected repository: ${
            (target as { name?: string })?.name ?? String(target)
          }`,
        );
      }),
      transaction: jest
        .fn()
        .mockImplementation(async (cb: (mgr: EntityManager) => unknown) =>
          cb({
            getRepository: mockDataSource.getRepository,
          } as unknown as EntityManager),
        ),
    };

    mockTenantContext = {
      getCurrentOrganizationId: jest.fn().mockResolvedValue(orgId),
      getRequestedOrganizationId: jest.fn(),
      requireOrganizationAccess: jest.fn().mockResolvedValue(orgId),
      getCurrentBranchId: jest.fn().mockResolvedValue(null),
      validateBranchAccess: jest.fn().mockResolvedValue(true),
      getCurrentUserId: jest.fn().mockResolvedValue('user-1'),
    };

    mockOutbox = { saveEventEnvelope: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PtSessionsService,
        { provide: getRepositoryToken(PTSession), useValue: mockSessionRepo },
        {
          provide: getRepositoryToken(PTEnrollment),
          useValue: mockEnrollmentRepo,
        },
        {
          provide: getRepositoryToken(PersonalTrainer),
          useValue: mockTrainerRepo,
        },
        { provide: getDataSourceToken(), useValue: mockDataSource },
        { provide: TenantContextService, useValue: mockTenantContext },
        { provide: OutboxService, useValue: mockOutbox },
      ],
    }).compile();

    service = module.get(PtSessionsService);
  });

  // ---------------------------------------------------------------------------
  // Booking — and the Q1 exhaustion guard
  // ---------------------------------------------------------------------------

  describe('book', () => {
    it('books a scheduled session, copying member_id from the enrollment', async () => {
      const saved = await service.book(bookDto);

      expect(mockSessionRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          organization_id: orgId,
          member_id: 'member-uuid-1',
          trainer_id: 'trainer-1',
          enrollment_id: 'enrollment-1',
          status: PTSessionStatus.SCHEDULED,
        }),
      );
      // Q27: the workout link is NEVER auto-populated.
      expect(mockSessionRepo.create.mock.calls[0][0].workout_session_id).toBeNull();
      expect(saved.status).toBe(PTSessionStatus.SCHEDULED);
    });

    it('emits PTSessionBooked.v1 on the booking transaction', async () => {
      await service.book(bookDto);

      expect(mockOutbox.saveEventEnvelope).toHaveBeenCalledTimes(1);
      const call = mockOutbox.saveEventEnvelope.mock.calls[0];
      expect(call[0]).toBe('PTSessionBooked.v1');
      expect(call[3]).toMatchObject({
        sessionId: 'session-1',
        enrollmentId: 'enrollment-1',
        memberId: 'member-uuid-1',
        trainerId: 'trainer-1',
      });
      expect(typeof call[6].getRepository).toBe('function');
    });

    it('REFUSES to book against a completed (exhausted) enrollment', async () => {
      mockEnrollmentRepo.findOne.mockResolvedValue({
        ...enrollmentFixture,
        sessions_used: 5,
        status: PTEnrollmentStatus.COMPLETED,
      });

      await expect(service.book(bookDto)).rejects.toThrow(ConflictException);
      await expect(service.book(bookDto)).rejects.toThrow(
        'PTEnrollment is completed',
      );
      expect(mockDataSource.transaction).not.toHaveBeenCalled();
      expect(mockSessionRepo.save).not.toHaveBeenCalled();
    });

    it('refuses to book when sessions_used already reached session_count, even if status is stale', async () => {
      mockEnrollmentRepo.findOne.mockResolvedValue({
        ...enrollmentFixture,
        sessions_used: 5,
        session_count: 5,
        status: PTEnrollmentStatus.ACTIVE,
      });

      await expect(service.book(bookDto)).rejects.toThrow(
        'PTEnrollment has no remaining sessions',
      );
      expect(mockSessionRepo.save).not.toHaveBeenCalled();
    });

    it('rejects a missing enrollment (nothing booked, no transaction opened)', async () => {
      mockEnrollmentRepo.findOne.mockResolvedValue(null);

      await expect(service.book(bookDto)).rejects.toThrow(
        'PTEnrollment not found',
      );
      expect(mockDataSource.transaction).not.toHaveBeenCalled();
    });

    it('rejects a session that ends before it starts', async () => {
      await expect(
        service.book({
          ...bookDto,
          scheduled_start: '2026-09-02T10:00:00.000Z',
          scheduled_end: '2026-09-02T09:00:00.000Z',
        }),
      ).rejects.toThrow('scheduled_end must be after scheduled_start');
      expect(mockSessionRepo.save).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // Q1 — sessions_used auto-increment, exhaustion transition and guard
  // ---------------------------------------------------------------------------

  describe('completeSession (Q1)', () => {
    it('increments sessions_used with an atomic SQL expression, in the same transaction as the session write', async () => {
      await service.completeSession('session-1', {});

      expect(mockDataSource.transaction).toHaveBeenCalledTimes(1);
      expect(mockEnrollmentRepo.update).toHaveBeenCalledTimes(1);

      const [criteria, payload] = mockEnrollmentRepo.update.mock.calls[0];
      expect(criteria).toEqual({ id: 'enrollment-1', organization_id: orgId });

      // The increment is the DB expression `sessions_used + 1`, NOT a value read
      // in JS beforehand — two concurrent completions cannot both read the same
      // pre-increment number.
      expect(typeof payload.sessions_used).toBe('function');
      expect(payload.sessions_used()).toBe('sessions_used + 1');

      // 0 used of 5 → the enrollment is NOT exhausted by this completion.
      expect(payload.status).toBeUndefined();

      // Session rows move to completed inside the same transaction.
      const saved = mockSessionRepo.save.mock.calls[0][0];
      expect(saved.status).toBe(PTSessionStatus.COMPLETED);
      expect(saved.actual_start).toBeInstanceOf(Date);
    });

    it('writes the session row and the enrollment increment with the SAME manager (one unit of work)', async () => {
      await service.completeSession('session-1', {});

      // The mock manager is the only source of repositories inside the
      // transaction, so its getRepository call log proves both writes came from
      // the transaction scope rather than the ambient repositories.
      expect(mockDataSource.getRepository).toHaveBeenCalledWith(PTSession);
      expect(mockDataSource.getRepository).toHaveBeenCalledWith(PTEnrollment);
    });

    it('locks the enrollment row before re-validating the exhaustion guard', async () => {
      await service.completeSession('session-1', {});

      expect(mockEnrollmentRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'enrollment-1', organization_id: orgId },
        lock: { mode: 'pessimistic_write' },
      });
    });

    it('AUTO-TRANSITIONS the enrollment to completed when the last session is consumed', async () => {
      mockEnrollmentRepo.findOne.mockResolvedValue({
        ...enrollmentFixture,
        sessions_used: 4,
        session_count: 5,
        status: PTEnrollmentStatus.ACTIVE,
      });

      await service.completeSession('session-1', {});

      const payload = mockEnrollmentRepo.update.mock.calls[0][1];
      expect(payload.status).toBe(PTEnrollmentStatus.COMPLETED);
      expect(payload.sessions_used()).toBe('sessions_used + 1');
      // Same single UPDATE statement: no second write, no separate transition step.
      expect(mockEnrollmentRepo.update).toHaveBeenCalledTimes(1);
    });

    it('emits PTSessionCompleted.v1 with the actual times, on the transaction', async () => {
      await service.completeSession('session-1', {
        actual_start: '2026-09-02T09:05:00.000Z',
        actual_end: '2026-09-02T09:55:00.000Z',
      });

      const call = mockOutbox.saveEventEnvelope.mock.calls[0];
      expect(call[0]).toBe('PTSessionCompleted.v1');
      expect(call[3]).toEqual({
        sessionId: 'session-1',
        enrollmentId: 'enrollment-1',
        actualStart: '2026-09-02T09:05:00.000Z',
        actualEnd: '2026-09-02T09:55:00.000Z',
      });
      expect(typeof call[6].getRepository).toBe('function');
    });

    it('does NOT increment twice when the session is already completed', async () => {
      mockSessionRepo.findOne.mockResolvedValue({
        ...sessionFixture,
        status: PTSessionStatus.COMPLETED,
      });

      await expect(service.completeSession('session-1', {})).rejects.toThrow(
        'PT session is already completed',
      );
      expect(mockEnrollmentRepo.update).not.toHaveBeenCalled();
      expect(mockEnrollmentRepo.findOne).not.toHaveBeenCalled();
    });

    it.each([PTSessionStatus.CANCELLED, PTSessionStatus.NO_SHOW])(
      'refuses to complete a "%s" session',
      async (status) => {
        mockSessionRepo.findOne.mockResolvedValue({ ...sessionFixture, status });

        await expect(service.completeSession('session-1', {})).rejects.toThrow(
          ConflictException,
        );
        expect(mockEnrollmentRepo.update).not.toHaveBeenCalled();
      },
    );

    it('REFUSES to complete against an exhausted/completed enrollment', async () => {
      mockEnrollmentRepo.findOne.mockResolvedValue({
        ...enrollmentFixture,
        sessions_used: 5,
        session_count: 5,
        status: PTEnrollmentStatus.COMPLETED,
      });

      await expect(service.completeSession('session-1', {})).rejects.toThrow(
        'PTEnrollment is completed — no sessions remain',
      );
      expect(mockEnrollmentRepo.update).not.toHaveBeenCalled();
      expect(mockSessionRepo.save).not.toHaveBeenCalled();
      expect(mockOutbox.saveEventEnvelope).not.toHaveBeenCalled();
    });

    it('rejects a session id outside the authorized organization', async () => {
      mockSessionRepo.findOne.mockResolvedValue(null);

      await expect(
        service.completeSession('session-other-org', {}),
      ).rejects.toThrow('PTSession not found');
      expect(mockSessionRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'session-other-org', organization_id: orgId },
        lock: { mode: 'pessimistic_write' },
      });
      expect(mockEnrollmentRepo.update).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // Q3 — PT sessions are fully decoupled from attendance
  // ---------------------------------------------------------------------------

  describe('attendance decoupling (Q3)', () => {
    it('completing a session creates NO attendance record and calls NO attendance code', async () => {
      await service.completeSession('session-1', {});

      // The DataSource mock throws for every repository other than PTSession and
      // PTEnrollment — an attendance write would have thrown here and failed the
      // test rather than silently passing.
      const requested = mockDataSource.getRepository.mock.calls.map((c) => c[0]);
      expect(requested).toEqual([PTSession, PTEnrollment]);

      // And the only event published is the PT session event, not an
      // attendance-side effect.
      expect(mockOutbox.saveEventEnvelope.mock.calls.map((c) => c[0])).toEqual([
        'PTSessionCompleted.v1',
      ]);
    });

    it('booking a session likewise touches nothing outside PT', async () => {
      await service.book(bookDto);

      const requested = mockDataSource.getRepository.mock.calls.map((c) => c[0]);
      expect(requested).toEqual([PTSession]);
    });

    it('no production file in src/pt imports or references the attendance module', () => {
      const ptDir = path.join(__dirname, '..');
      const offenders: string[] = [];

      for (const file of listTypeScriptFiles(ptDir)) {
        const source = fs.readFileSync(file, 'utf8');
        if (
          /from '[^']*attendance/i.test(source) ||
          /\bAttendanceService\b|\bAttendanceRecord\b|\bAttendanceEvent\b|\bAttendanceAccessDecision\b|ATTENDANCE_/.test(
            source,
          )
        ) {
          offenders.push(path.relative(ptDir, file));
        }
      }

      expect(offenders).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // Q27 — the workout link is manual only
  // ---------------------------------------------------------------------------

  describe('linkWorkoutSession (Q27)', () => {
    it('sets workout_session_id on the session and returns the refreshed row', async () => {
      const linked = { ...sessionFixture, workout_session_id: 'workout-session-9' };
      mockSessionRepo.findOne
        .mockResolvedValueOnce({ ...sessionFixture })
        .mockResolvedValueOnce(linked);

      const result = await service.linkWorkoutSession('session-1', {
        workout_session_id: 'workout-session-9',
      });

      expect(mockSessionRepo.update).toHaveBeenCalledWith(
        { id: 'session-1', organization_id: orgId },
        { workout_session_id: 'workout-session-9' },
      );
      expect(result.workout_session_id).toBe('workout-session-9');
    });

    it('is org-scoped: a session outside the organization is not found and nothing is written', async () => {
      mockSessionRepo.findOne.mockResolvedValue(null);

      await expect(
        service.linkWorkoutSession('session-other-org', {
          workout_session_id: 'workout-session-9',
        }),
      ).rejects.toThrow('PTSession not found');
      expect(mockSessionRepo.update).not.toHaveBeenCalled();
    });

    it('completion NEVER populates the workout link', async () => {
      await service.completeSession('session-1', {});

      const saved = mockSessionRepo.save.mock.calls[0][0];
      expect(saved.workout_session_id).toBeNull();
      // Completion writes only through the session repository — never by calling
      // into Workouts.
      expect(mockSessionRepo.update).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ workout_session_id: expect.anything() }),
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Org-scoping for reads
  // ---------------------------------------------------------------------------

  describe('reads are org-scoped', () => {
    it('findAll always filters on the authorized organization', async () => {
      await service.findAll({ enrollment_id: 'enrollment-1' });

      expect(mockSessionRepo.find).toHaveBeenCalledWith({
        where: { organization_id: orgId, enrollment_id: 'enrollment-1' },
        order: { scheduled_start: 'DESC' },
      });
    });

    it('findOne rejects a session from another organization', async () => {
      mockSessionRepo.findOne.mockResolvedValue(null);

      await expect(service.findOne('session-other-org')).rejects.toThrow(
        NotFoundException,
      );
      expect(mockSessionRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'session-other-org', organization_id: orgId },
      });
    });
  });
});