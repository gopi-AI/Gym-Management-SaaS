import { ConflictException, NotFoundException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { WorkoutAssignmentsService } from './workout-assignments.service';
import { WorkoutsTenantService } from './workouts-tenant.service';
import { OutboxService } from '../../shared/outbox/outbox.service';
import { WorkoutPlanAssignment } from '../entities/workout-plan-assignment.entity';
import { WorkoutPlanTemplate } from '../entities/workout-plan-template.entity';
import { WorkoutDayTemplate } from '../entities/workout-day-template.entity';
import { WorkoutDayTemplateExercise } from '../entities/workout-day-template-exercise.entity';
import { WorkoutTemplate } from '../entities/workout-template.entity';
import { WorkoutTemplateExercise } from '../entities/workout-template-exercise.entity';
import { Exercise } from '../entities/exercise.entity';
import { PrescribedWorkoutDay } from '../entities/prescribed-workout-day.entity';
import { PrescribedWorkoutDayExercise } from '../entities/prescribed-workout-day-exercise.entity';
import { PlanDayStatus } from '../entities/plan-day-status.enum';

describe('WorkoutAssignmentsService', () => {
  const orgId = 'org-1';
  const memberId = 'member-1';

  let service: WorkoutAssignmentsService;
  let assignmentRepo: Record<string, jest.Mock>;
  let planTemplateRepo: Record<string, jest.Mock>;
  let dayTemplateRepo: Record<string, jest.Mock>;
  let dayTemplateExerciseRepo: Record<string, jest.Mock>;
  let legacyTemplateRepo: Record<string, jest.Mock>;
  let legacyTemplateExerciseRepo: Record<string, jest.Mock>;
  let exerciseRepo: Record<string, jest.Mock>;
  let prescribedDayRepo: Record<string, jest.Mock>;
  let prescribedExerciseRepo: Record<string, jest.Mock>;
  let manager: EntityManager;
  let managerDayRepo: Record<string, jest.Mock>;
  let managerExerciseRepo: Record<string, jest.Mock>;
  let managerAssignmentRepo: Record<string, jest.Mock>;
  let dataSource: { transaction: jest.Mock; query: jest.Mock };
  let tenant: Record<string, jest.Mock>;
  let outbox: Record<string, jest.Mock>;

  beforeEach(() => {
    assignmentRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      find: jest.fn().mockResolvedValue([]),
      create: jest.fn((input) => ({ ...input })),
      save: jest.fn(async (input) => ({ id: 'assignment-1', ...input })),
    };
    planTemplateRepo = { findOne: jest.fn().mockResolvedValue(null) };
    dayTemplateRepo = { find: jest.fn().mockResolvedValue([]) };
    dayTemplateExerciseRepo = { find: jest.fn().mockResolvedValue([]) };
    legacyTemplateRepo = { findOne: jest.fn().mockResolvedValue(null) };
    legacyTemplateExerciseRepo = { find: jest.fn().mockResolvedValue([]) };
    exerciseRepo = { find: jest.fn().mockResolvedValue([]) };
    prescribedDayRepo = {
      find: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      createQueryBuilder: jest.fn(),
    };
    prescribedExerciseRepo = { find: jest.fn().mockResolvedValue([]) };

    managerAssignmentRepo = {
      create: jest.fn((input) => ({ ...input })),
      save: jest.fn(async (input) => ({ id: 'assignment-1', ...input })),
    };
    managerDayRepo = {
      create: jest.fn((input) => ({ ...input })),
      save: jest.fn(async (input) => ({
        id: `prescribed-day-${input.sequence_order}`,
        ...input,
      })),
    };
    managerExerciseRepo = {
      create: jest.fn((input) => ({ ...input })),
      save: jest.fn(async (input) => input),
    };
    manager = {
      getRepository: jest.fn((target: unknown) => {
        if (target === WorkoutPlanAssignment) return managerAssignmentRepo;
        if (target === PrescribedWorkoutDay) return managerDayRepo;
        if (target === PrescribedWorkoutDayExercise) return managerExerciseRepo;
        throw new Error('unexpected repository');
      }),
    } as unknown as EntityManager;

    dataSource = {
      transaction: jest.fn(async (cb: (m: EntityManager) => unknown) => cb(manager)),
      query: jest.fn().mockResolvedValue([]),
    };
    tenant = {
      getOrganizationId: jest.fn().mockResolvedValue(orgId),
      requireMemberInOrganization: jest
        .fn()
        .mockImplementation(async () => ({ id: memberId })),
    };
    outbox = {
      saveEventEnvelope: jest.fn().mockResolvedValue({ id: 'outbox-1' }),
    };

    service = new WorkoutAssignmentsService(
      assignmentRepo as never,
      planTemplateRepo as never,
      dayTemplateRepo as never,
      dayTemplateExerciseRepo as never,
      legacyTemplateRepo as never,
      legacyTemplateExerciseRepo as never,
      exerciseRepo as never,
      prescribedDayRepo as never,
      prescribedExerciseRepo as never,
      dataSource as never,
      tenant as unknown as WorkoutsTenantService,
      outbox as unknown as OutboxService,
    );
  });

  describe('assignPlanTemplate', () => {
    beforeEach(() => {
      planTemplateRepo.findOne.mockResolvedValue({
        id: 'plan-1',
        organization_id: orgId,
        name: 'Weekly',
        days: [
          {
            day_order: 1,
            day_template_id: 'dt-1',
            day_label: 'Push',
            is_rest_day: false,
            is_optional: false,
          },
          {
            day_order: 2,
            day_template_id: null,
            day_label: 'Sunday',
            is_rest_day: true,
            is_optional: false,
          },
        ],
      });
      dayTemplateRepo.find.mockResolvedValue([
        { id: 'dt-1', organization_id: orgId, name: 'Push Day', is_active: true },
      ]);
      dayTemplateExerciseRepo.find.mockResolvedValue([
        {
          day_template_id: 'dt-1',
          exercise_id: 'ex-1',
          section: 'strength',
          sets: 3,
          reps: 12,
          weight_template: null,
          rest_seconds: 60,
          duration_seconds: null,
          distance_meters: null,
          instructions: 'slow tempo',
          sort_order: 1,
        },
      ]);
      exerciseRepo.find.mockResolvedValue([{ id: 'ex-1', name: 'Bench Press' }]);
    });

    it('snapshots every plan day (including rest markers) and emits WorkoutPlanAssigned.v1 with the manager', async () => {
      const result = await service.assignPlanTemplate(
        orgId,
        memberId,
        {
          plan_template_id: 'plan-1',
          start_date: '2026-11-01',
          end_date: '2026-12-31',
          logging_mode: 'detailed' as never,
        },
        'trainer-user-1',
      );

      expect(result.id).toBe('assignment-1');
      expect(managerAssignmentRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          organization_id: orgId,
          member_id: memberId,
          template_id: null,
          plan_template_id: 'plan-1',
          logging_mode: 'detailed',
        }),
      );

      expect(managerDayRepo.save).toHaveBeenCalledTimes(2);
      expect(managerDayRepo.create).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          sequence_order: 1,
          name: 'Push',
          is_rest_day: false,
          status: PlanDayStatus.PENDING,
        }),
      );
      expect(managerDayRepo.create).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          sequence_order: 2,
          name: 'Sunday',
          is_rest_day: true,
        }),
      );

      expect(managerExerciseRepo.save).toHaveBeenCalledTimes(1);
      expect(managerExerciseRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          exercise_id: 'ex-1',
          exercise_name_snapshot: 'Bench Press',
          sets: 3,
          reps: 12,
          sort_order: 1,
        }),
      );

      expect(outbox.saveEventEnvelope).toHaveBeenCalledWith(
        'WorkoutPlanAssigned',
        'v1',
        orgId,
        expect.objectContaining({
          assignmentId: 'assignment-1',
          memberId,
          templateId: null,
          planTemplateId: 'plan-1',
          assignedBy: 'trainer-user-1',
          startDate: '2026-11-01',
          endDate: '2026-12-31',
          loggingMode: 'detailed',
        }),
        memberId,
        undefined,
        manager,
      );
    });

    it('rejects a member outside the authorized organization before opening a transaction', async () => {
      tenant.requireMemberInOrganization.mockRejectedValueOnce(
        new NotFoundException('Member not found'),
      );

      await expect(
        service.assignPlanTemplate(
          orgId,
          'foreign-member',
          { plan_template_id: 'plan-1', start_date: '2026-11-01' },
          'trainer',
        ),
      ).rejects.toThrow(NotFoundException);

      expect(dataSource.transaction).not.toHaveBeenCalled();
      expect(outbox.saveEventEnvelope).not.toHaveBeenCalled();
    });

    it('rejects a second active assignment of the same plan template', async () => {
      assignmentRepo.findOne.mockResolvedValue({ id: 'existing' });

      await expect(
        service.assignPlanTemplate(
          orgId,
          memberId,
          { plan_template_id: 'plan-1', start_date: '2026-11-01' },
          'trainer',
        ),
      ).rejects.toThrow(ConflictException);

      expect(dataSource.transaction).not.toHaveBeenCalled();
    });
  });

  describe('assignLegacyPlan', () => {
    it('groups a flat template by day_of_week and snapshots each group', async () => {
      legacyTemplateRepo.findOne.mockResolvedValue({
        id: 'legacy-1',
        organization_id: orgId,
        name: 'Strength',
      });
      legacyTemplateExerciseRepo.find.mockResolvedValue([
        {
          template_id: 'legacy-1',
          exercise_id: 'ex-1',
          sets: 3,
          reps: 10,
          weight_template: null,
          rest_seconds: 90,
          sort_order: 1,
          day_of_week: 2,
        },
        {
          template_id: 'legacy-1',
          exercise_id: 'ex-1',
          sets: 4,
          reps: 8,
          weight_template: null,
          rest_seconds: 90,
          sort_order: 2,
          day_of_week: 4,
        },
      ]);
      exerciseRepo.find.mockResolvedValue([{ id: 'ex-1', name: 'Squat' }]);

      await service.assignLegacyPlan({
        memberId,
        templateId: 'legacy-1',
        assignedBy: 'system',
        startDate: '2026-11-01',
      });

      expect(managerDayRepo.create).toHaveBeenCalledTimes(2);
      expect(managerDayRepo.create).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ sequence_order: 3, name: 'Strength - Day 3' }),
      );
      expect(managerDayRepo.create).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ sequence_order: 5, name: 'Strength - Day 5' }),
      );
      expect(outbox.saveEventEnvelope).toHaveBeenCalledWith(
        'WorkoutPlanAssigned',
        'v1',
        orgId,
        expect.objectContaining({
          templateId: 'legacy-1',
          planTemplateId: null,
        }),
        memberId,
        undefined,
        manager,
      );
    });
  });

  describe('getProgressForAssignment', () => {
    function mockStatusQuery(rows: Array<{ status: string; count: string }>) {
      const qb = {
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue(rows),
      };
      prescribedDayRepo.createQueryBuilder.mockReturnValue(qb);
      return qb;
    }

    it('counts ONLY trainer-approved days, excludes rest days, and caps at 100', async () => {
      assignmentRepo.findOne.mockResolvedValue({
        id: 'assignment-1',
        organization_id: orgId,
      });
      const qb = mockStatusQuery([
        { status: 'approved', count: '1' },
        { status: 'submitted', count: '1' },
        { status: 'remaining_required', count: '1' },
        { status: 'pending', count: '2' },
      ]);
      dataSource.query.mockResolvedValue([{ prescribed: '4', completed: '2' }]);

      const progress = await service.getProgressForAssignment(
        orgId,
        'assignment-1',
      );

      expect(qb.andWhere).toHaveBeenCalledWith('day.is_rest_day = false');
      expect(progress).toEqual({
        completed: 1,
        prescribed: 5,
        percentage: 20,
        status_counts: {
          pending: 2,
          submitted: 1,
          remaining_required: 1,
          approved: 1,
        },
        exercise_completion: {
          completed: 2,
          prescribed: 4,
          percentage: 50,
        },
      });
    });

    it('returns 0% when the assignment has no prescribed days', async () => {
      assignmentRepo.findOne.mockResolvedValue({
        id: 'assignment-1',
        organization_id: orgId,
      });
      mockStatusQuery([]);
      dataSource.query.mockResolvedValue([{ prescribed: '0', completed: '0' }]);

      const progress = await service.getProgressForAssignment(
        orgId,
        'assignment-1',
      );

      expect(progress.percentage).toBe(0);
      expect(progress.completed).toBe(0);
      expect(progress.prescribed).toBe(0);
      expect(progress.exercise_completion.percentage).toBe(0);
    });

    it('scopes the exercise-completion SQL to the assignment and organization', async () => {
      assignmentRepo.findOne.mockResolvedValue({
        id: 'assignment-1',
        organization_id: orgId,
      });
      mockStatusQuery([{ status: 'approved', count: '1' }]);
      dataSource.query.mockResolvedValue([{ prescribed: '1', completed: '1' }]);

      await service.getProgressForAssignment(orgId, 'assignment-1');

      const [sql, params] = dataSource.query.mock.calls[0];
      expect(sql).toContain('pd.assignment_id = $1');
      expect(sql).toContain('pd.organization_id = $2');
      expect(sql).toContain('pd.is_rest_day = false');
      expect(params).toEqual(['assignment-1', orgId]);
    });
  });

  describe('getSequence', () => {
    it('selects the first non-approved, non-rest day as the current workout', async () => {
      tenant.requireMemberInOrganization.mockResolvedValue({ id: memberId });
      assignmentRepo.find.mockResolvedValue([
        { id: 'assignment-1', organization_id: orgId, member_id: memberId },
      ]);
      prescribedDayRepo.find.mockResolvedValue([
        {
          id: 'rest-1',
          sequence_order: 1,
          is_rest_day: true,
          status: PlanDayStatus.PENDING,
        },
        {
          id: 'day-2',
          sequence_order: 2,
          is_rest_day: false,
          status: PlanDayStatus.PENDING,
        },
        {
          id: 'day-3',
          sequence_order: 3,
          is_rest_day: false,
          status: PlanDayStatus.APPROVED,
        },
      ]);
      jest.spyOn(service, 'getProgressForAssignment').mockResolvedValue({
        completed: 1,
        prescribed: 2,
        percentage: 50,
        status_counts: {
          pending: 1,
          submitted: 0,
          remaining_required: 0,
          approved: 1,
        },
        exercise_completion: { completed: 0, prescribed: 0, percentage: 0 },
      });

      const sequence = await service.getSequence(orgId, memberId);

      expect(sequence).toHaveLength(1);
      expect(sequence[0].current_day_id).toBe('day-2');
    });
  });
});
