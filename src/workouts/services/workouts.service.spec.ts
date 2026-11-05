import { NotFoundException } from '@nestjs/common';
import { WorkoutsService } from './workouts.service';
import { WorkoutsTenantService } from './workouts-tenant.service';
import { ExerciseLibraryService } from './exercise-library.service';
import { WorkoutAssignmentsService } from './workout-assignments.service';
import { WorkoutSessionsService } from './workout-sessions.service';

/**
 * Facade contract retained for the PT integration and the Member 360 tab.
 *
 * The behaviour under test lives in the focused services and is covered by
 * their own specs; this spec pins the delegation + tenant derivation so the
 * facade cannot silently grow a second implementation.
 */
describe('WorkoutsService facade', () => {
  const orgId = 'org-1';
  const memberId = 'member-1';

  let service: WorkoutsService;
  let exerciseRepo: Record<string, jest.Mock>;
  let templateRepo: Record<string, jest.Mock>;
  let tenant: Record<string, jest.Mock>;
  let exerciseLibrary: Record<string, jest.Mock>;
  let assignments: Record<string, jest.Mock>;
  let sessions: Record<string, jest.Mock>;

  beforeEach(() => {
    exerciseRepo = {};
    templateRepo = {
      create: jest.fn((input) => ({ ...input })),
      save: jest.fn(async (input) => ({ id: 'template-1', ...input })),
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
    };
    tenant = {
      getOrganizationId: jest.fn().mockResolvedValue(orgId),
    };
    exerciseLibrary = {
      create: jest.fn().mockResolvedValue({ id: 'exercise-1' }),
      findAll: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue({ id: 'exercise-1' }),
    };
    assignments = {
      assignLegacyPlan: jest.fn().mockResolvedValue({ id: 'assignment-1' }),
      listAssignmentsForMember: jest.fn().mockResolvedValue([]),
      getAssignment: jest.fn().mockResolvedValue({ id: 'assignment-1' }),
      getProgressForAssignment: jest.fn().mockResolvedValue({
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
      }),
    };
    sessions = {
      listMemberSessions: jest.fn().mockResolvedValue([]),
    };

    service = new WorkoutsService(
      exerciseRepo as never,
      templateRepo as never,
      tenant as unknown as WorkoutsTenantService,
      exerciseLibrary as unknown as ExerciseLibraryService,
      assignments as unknown as WorkoutAssignmentsService,
      sessions as unknown as WorkoutSessionsService,
    );
  });

  it('derives the organization and delegates exercise creation', async () => {
    await service.createExercise({ name: 'Squat' });

    expect(exerciseLibrary.create).toHaveBeenCalledWith(orgId, { name: 'Squat' });
  });

  it('scopes legacy template reads to the authorized organization', async () => {
    await expect(service.findTemplateById('foreign')).rejects.toThrow(
      NotFoundException,
    );
    expect(templateRepo.findOne).toHaveBeenCalledWith({
      where: { id: 'foreign', organization_id: orgId },
    });
  });

  it('delegates assignPlan to the single legacy assignment write path', async () => {
    const input = {
      memberId,
      templateId: 'template-1',
      assignedBy: 'system',
      startDate: '2026-11-01',
    };

    await service.assignPlan(input);

    expect(assignments.assignLegacyPlan).toHaveBeenCalledWith(input);
  });

  it('delegates member reads with the authorized organization', async () => {
    await service.findAllAssignments(memberId);
    await service.findAllSessions(memberId);
    await service.getAssignmentProgress('assignment-1');

    expect(assignments.listAssignmentsForMember).toHaveBeenCalledWith(
      orgId,
      memberId,
    );
    expect(sessions.listMemberSessions).toHaveBeenCalledWith(orgId, memberId);
    expect(assignments.getProgressForAssignment).toHaveBeenCalledWith(
      orgId,
      'assignment-1',
    );
  });
});
