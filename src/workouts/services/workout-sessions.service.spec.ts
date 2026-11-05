import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { WorkoutSessionsService } from './workout-sessions.service';
import { WorkoutsTenantService } from './workouts-tenant.service';
import { OutboxService } from '../../shared/outbox/outbox.service';
import { WorkoutSession } from '../entities/workout-session.entity';
import { WorkoutSessionExercise } from '../entities/workout-session-exercise.entity';
import { WorkoutTemplate } from '../entities/workout-template.entity';
import { Exercise } from '../entities/exercise.entity';
import { WorkoutPlanAssignment } from '../entities/workout-plan-assignment.entity';
import { PrescribedWorkoutDay } from '../entities/prescribed-workout-day.entity';
import { PrescribedWorkoutDayExercise } from '../entities/prescribed-workout-day-exercise.entity';
import { PlanDaySubmission } from '../entities/plan-day-submission.entity';
import { PlanDaySubmissionExercise } from '../entities/plan-day-submission-exercise.entity';
import { WorkoutSessionStatus } from '../entities/workout-session-status.enum';
import { PlanDayStatus } from '../entities/plan-day-status.enum';
import { AssignmentLoggingMode } from '../entities/assignment-logging-mode.enum';
import { AssignmentStatus } from '../entities/assignment-status.enum';

describe('WorkoutSessionsService', () => {
  const orgId = 'org-1';
  const memberId = 'member-1';
  const userId = 'user-1';

  let service: WorkoutSessionsService;
  let sessionRepo: Record<string, jest.Mock>;
  let sessionExerciseRepo: Record<string, jest.Mock>;
  let legacyTemplateRepo: Record<string, jest.Mock>;
  let exerciseRepo: Record<string, jest.Mock>;
  let assignmentRepo: Record<string, jest.Mock>;
  let prescribedDayRepo: Record<string, jest.Mock>;
  let prescribedExerciseRepo: Record<string, jest.Mock>;
  let submissionRepo: Record<string, jest.Mock>;
  let submissionExerciseRepo: Record<string, jest.Mock>;
  let manager: EntityManager;
  let managerSessionRepo: Record<string, jest.Mock>;
  let managerSessionExerciseRepo: Record<string, jest.Mock>;
  let managerSubmissionRepo: Record<string, jest.Mock>;
  let managerSubmissionExerciseRepo: Record<string, jest.Mock>;
  let managerDayRepo: Record<string, jest.Mock>;
  let dataSource: { transaction: jest.Mock };
  let tenant: Record<string, jest.Mock>;
  let outbox: Record<string, jest.Mock>;

  const dayFixture = {
    id: 'day-1',
    organization_id: orgId,
    assignment_id: 'assignment-1',
    is_rest_day: false,
    status: PlanDayStatus.PENDING,
  };

  const assignmentFixture = {
    id: 'assignment-1',
    organization_id: orgId,
    member_id: memberId,
    status: AssignmentStatus.ACTIVE,
    logging_mode: AssignmentLoggingMode.SIMPLE,
  };

  beforeEach(() => {
    sessionRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      find: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    sessionExerciseRepo = { find: jest.fn().mockResolvedValue([]) };
    legacyTemplateRepo = { findOne: jest.fn().mockResolvedValue(null) };
    exerciseRepo = { find: jest.fn().mockResolvedValue([]) };
    assignmentRepo = { findOne: jest.fn().mockResolvedValue(null) };
    prescribedDayRepo = { findOne: jest.fn().mockResolvedValue(null) };
    prescribedExerciseRepo = { find: jest.fn().mockResolvedValue([]) };
    submissionRepo = { findOne: jest.fn().mockResolvedValue(null) };
    submissionExerciseRepo = { find: jest.fn().mockResolvedValue([]) };

    managerSessionRepo = {
      create: jest.fn((input) => ({ ...input })),
      save: jest.fn(async (input) => ({ id: 'session-1', ...input })),
    };
    managerSessionExerciseRepo = {
      delete: jest.fn().mockResolvedValue({ affected: 0 }),
      create: jest.fn((input) => ({ ...input })),
      save: jest.fn(async (input) => input),
    };
    managerSubmissionRepo = {
      create: jest.fn((input) => ({ ...input })),
      save: jest.fn(async (input) => ({ id: 'submission-1', ...input })),
    };
    managerSubmissionExerciseRepo = {
      create: jest.fn((input) => ({ ...input })),
      save: jest.fn(async (input) => input),
    };
    managerDayRepo = { update: jest.fn().mockResolvedValue({ affected: 1 }) };

    manager = {
      getRepository: jest.fn((target: unknown) => {
        if (target === WorkoutSession) return managerSessionRepo;
        if (target === WorkoutSessionExercise) return managerSessionExerciseRepo;
        if (target === PlanDaySubmission) return managerSubmissionRepo;
        if (target === PlanDaySubmissionExercise) {
          return managerSubmissionExerciseRepo;
        }
        if (target === PrescribedWorkoutDay) return managerDayRepo;
        throw new Error('unexpected repository');
      }),
    } as unknown as EntityManager;

    dataSource = {
      transaction: jest.fn(async (cb: (m: EntityManager) => unknown) => cb(manager)),
    };
    tenant = {
      requireMemberInOrganization: jest.fn().mockResolvedValue({ id: memberId }),
      getCurrentUserId: jest.fn().mockResolvedValue(userId),
    };
    outbox = {
      saveEventEnvelope: jest.fn().mockResolvedValue({ id: 'outbox-1' }),
    };

    service = new WorkoutSessionsService(
      sessionRepo as never,
      sessionExerciseRepo as never,
      legacyTemplateRepo as never,
      exerciseRepo as never,
      assignmentRepo as never,
      prescribedDayRepo as never,
      prescribedExerciseRepo as never,
      submissionRepo as never,
      submissionExerciseRepo as never,
      dataSource as never,
      tenant as unknown as WorkoutsTenantService,
      outbox as unknown as OutboxService,
    );
  });

  function mockPlanDay(exerciseIds: string[] = ['ex-1']) {
    prescribedDayRepo.findOne.mockResolvedValue(dayFixture);
    assignmentRepo.findOne.mockResolvedValue(assignmentFixture);
    prescribedExerciseRepo.find.mockResolvedValue(
      exerciseIds.map((exerciseId, index) => ({
        id: `pde-${index + 1}`,
        prescribed_day_id: 'day-1',
        exercise_id: exerciseId,
      })),
    );
    exerciseRepo.find.mockResolvedValue(
      exerciseIds.map((exerciseId) => ({ id: exerciseId })),
    );
  }

  describe('create', () => {
    it('rejects a prescribed day that does not belong to the route member', async () => {
      prescribedDayRepo.findOne.mockResolvedValue(dayFixture);
      assignmentRepo.findOne.mockResolvedValue(null);

      await expect(
        service.create(
          orgId,
          memberId,
          { prescribed_day_id: 'day-1' },
          userId,
        ),
      ).rejects.toThrow(NotFoundException);

      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('allows a standalone session with no assignment and emits WorkoutSessionLogged.v1', async () => {
      await service.create(
        orgId,
        memberId,
        { session_date: '2026-11-01', notes: 'morning' },
        userId,
      );

      expect(managerSessionRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          organization_id: orgId,
          member_id: memberId,
          assignment_id: null,
          prescribed_day_id: null,
          status: WorkoutSessionStatus.IN_PROGRESS,
          session_date: '2026-11-01',
          created_by: userId,
        }),
      );
      expect(outbox.saveEventEnvelope).toHaveBeenCalledWith(
        'WorkoutSessionLogged',
        'v1',
        orgId,
        expect.objectContaining({
          sessionId: 'session-1',
          memberId,
          organizationId: orgId,
          assignmentId: null,
          prescribedDayId: null,
        }),
        memberId,
        undefined,
        manager,
      );
    });

    it('requires a completion checkbox for a simple logging plan', async () => {
      mockPlanDay();

      await expect(
        service.create(
          orgId,
          memberId,
          {
            prescribed_day_id: 'day-1',
            exercises: [{ exercise_id: 'ex-1' }],
          },
          userId,
        ),
      ).rejects.toThrow(BadRequestException);

      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('requires actual sets and reps for a detailed PT plan', async () => {
      mockPlanDay();
      assignmentRepo.findOne.mockResolvedValue({
        ...assignmentFixture,
        logging_mode: AssignmentLoggingMode.DETAILED,
      });

      await expect(
        service.create(
          orgId,
          memberId,
          {
            prescribed_day_id: 'day-1',
            exercises: [
              { exercise_id: 'ex-1', completed: true },
            ],
          },
          userId,
        ),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.create(
          orgId,
          memberId,
          {
            prescribed_day_id: 'day-1',
            exercises: [
              {
                exercise_id: 'ex-1',
                sets_completed: 3,
                reps_completed: 12,
                weight_used: 60,
              },
            ],
          },
          userId,
        ),
      ).resolves.toBeDefined();
    });
  });

  describe('finish / cancel', () => {
    it('locks a finished session against further edits', async () => {
      sessionRepo.findOne.mockResolvedValue({
        id: 'session-1',
        organization_id: orgId,
        status: WorkoutSessionStatus.FINISHED,
      });

      await expect(service.update(orgId, 'session-1', { notes: 'x' })).rejects
        .toThrow(ConflictException);
      await expect(service.finish(orgId, 'session-1')).rejects.toThrow(
        ConflictException,
      );
      await expect(service.cancel(orgId, 'session-1')).rejects.toThrow(
        ConflictException,
      );
    });

    it('finishes an in-progress session and sets completed_at', async () => {
      sessionRepo.findOne
        .mockResolvedValueOnce({
          id: 'session-1',
          organization_id: orgId,
          status: WorkoutSessionStatus.IN_PROGRESS,
        })
        .mockResolvedValueOnce({
          id: 'session-1',
          organization_id: orgId,
          status: WorkoutSessionStatus.FINISHED,
        });

      const result = await service.finish(orgId, 'session-1');

      expect(sessionRepo.update).toHaveBeenCalledWith(
        { id: 'session-1', organization_id: orgId },
        expect.objectContaining({
          status: WorkoutSessionStatus.FINISHED,
          completed_at: expect.any(Date),
        }),
      );
      expect(result.status).toBe(WorkoutSessionStatus.FINISHED);
    });

    it('cancels an in-progress session and keeps it in history', async () => {
      sessionRepo.findOne.mockResolvedValue({
        id: 'session-1',
        organization_id: orgId,
        status: WorkoutSessionStatus.IN_PROGRESS,
      });

      await service.cancel(orgId, 'session-1');

      expect(sessionRepo.update).toHaveBeenCalledWith(
        { id: 'session-1', organization_id: orgId },
        expect.objectContaining({
          status: WorkoutSessionStatus.CANCELLED,
          cancelled_at: expect.any(Date),
        }),
      );
    });
  });

  describe('softDelete', () => {
    it('records deleted_at/deleted_by without a reason and never touches the plan day', async () => {
      sessionRepo.findOne.mockResolvedValue({
        id: 'session-1',
        organization_id: orgId,
        deleted_at: null,
      });

      const result = await service.softDelete(orgId, 'session-1', userId);

      expect(result.success).toBe(true);
      expect(sessionRepo.update).toHaveBeenCalledWith(
        { id: 'session-1', organization_id: orgId },
        expect.objectContaining({
          deleted_at: expect.any(Date),
          deleted_by: userId,
        }),
      );
      expect(managerDayRepo.update).not.toHaveBeenCalled();
    });

    it('is idempotent when the session is already soft-deleted', async () => {
      const deletedAt = new Date('2026-11-01T00:00:00.000Z');
      sessionRepo.findOne.mockResolvedValue({
        id: 'session-1',
        organization_id: orgId,
        deleted_at: deletedAt,
      });

      const result = await service.softDelete(orgId, 'session-1', userId);

      expect(result.deleted_at).toBe(deletedAt);
      expect(sessionRepo.update).not.toHaveBeenCalled();
    });
  });

  describe('submitDay', () => {
    it('creates an immutable submission from finished sessions and emits the event', async () => {
      prescribedDayRepo.findOne.mockResolvedValue(dayFixture);
      assignmentRepo.findOne.mockResolvedValue(assignmentFixture);
      sessionRepo.find.mockResolvedValue([
        { id: 'session-1', completed_at: new Date('2026-11-01T10:00:00Z') },
        { id: 'session-2', completed_at: new Date('2026-11-01T18:00:00Z') },
      ]);
      sessionExerciseRepo.find.mockResolvedValue([
        {
          id: 'se-1',
          session_id: 'session-1',
          exercise_id: 'ex-1',
          prescribed_day_exercise_id: 'pde-1',
          completed: true,
          sets_completed: null,
          reps_completed: null,
          weight_used: null,
          notes: null,
          created_at: new Date('2026-11-01T10:00:00Z'),
        },
        {
          id: 'se-2',
          session_id: 'session-2',
          exercise_id: 'ex-2',
          prescribed_day_exercise_id: 'pde-2',
          completed: true,
          sets_completed: null,
          reps_completed: null,
          weight_used: null,
          notes: null,
          created_at: new Date('2026-11-01T18:00:00Z'),
        },
      ]);
      prescribedExerciseRepo.find.mockResolvedValue([
        { id: 'pde-1', prescribed_day_id: 'day-1', exercise_id: 'ex-1' },
        { id: 'pde-2', prescribed_day_id: 'day-1', exercise_id: 'ex-2' },
      ]);

      const result = await service.submitDay(orgId, 'day-1', { notes: 'done' }, userId);

      expect(result.id).toBe('submission-1');
      expect(managerSubmissionRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          organization_id: orgId,
          prescribed_day_id: 'day-1',
          member_id: memberId,
          submitted_by: userId,
        }),
      );
      expect(managerSubmissionExerciseRepo.create).toHaveBeenCalledTimes(2);
      expect(managerSubmissionExerciseRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          prescribed_day_exercise_id: 'pde-1',
          completed: true,
        }),
      );
      expect(managerDayRepo.update).toHaveBeenCalledWith(
        { id: 'day-1', organization_id: orgId },
        expect.objectContaining({ status: PlanDayStatus.SUBMITTED }),
      );
      expect(outbox.saveEventEnvelope).toHaveBeenCalledWith(
        'WorkoutPlanDaySubmitted',
        'v1',
        orgId,
        expect.objectContaining({
          prescribedDayId: 'day-1',
          submissionId: 'submission-1',
          sessionIds: ['session-1', 'session-2'],
        }),
        memberId,
        undefined,
        manager,
      );
    });

    it('rejects submission with no finished session', async () => {
      prescribedDayRepo.findOne.mockResolvedValue(dayFixture);
      assignmentRepo.findOne.mockResolvedValue(assignmentFixture);
      sessionRepo.find.mockResolvedValue([]);

      await expect(
        service.submitDay(orgId, 'day-1', {}, userId),
      ).rejects.toThrow(BadRequestException);
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('rejects submission of an already-approved day', async () => {
      prescribedDayRepo.findOne.mockResolvedValue({
        ...dayFixture,
        status: PlanDayStatus.APPROVED,
      });

      await expect(
        service.submitDay(orgId, 'day-1', {}, userId),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('listMemberSessions', () => {
    it('excludes soft-deleted rows unless include_deleted is requested', async () => {
      await service.listMemberSessions(orgId, memberId);
      expect(sessionRepo.find).toHaveBeenLastCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ deleted_at: expect.anything() }),
        }),
      );

      await service.listMemberSessions(orgId, memberId, {
        include_deleted: true,
      });
      const calls = sessionRepo.find.mock.calls;
      const lastCall = calls[calls.length - 1][0];
      expect(lastCall.where.deleted_at).toBeUndefined();
    });
  });
});
