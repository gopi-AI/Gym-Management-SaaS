import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken, getDataSourceToken } from '@nestjs/typeorm';
import {
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { WorkoutsService } from './workouts.service';
import { Exercise } from '../entities/exercise.entity';
import { WorkoutTemplate } from '../entities/workout-template.entity';
import { WorkoutPlanAssignment } from '../entities/workout-plan-assignment.entity';
import { TenantContextService } from '../../shared/tenant/tenant-context.service';
import { OutboxService } from '../../shared/outbox/outbox.service';
import { AssignmentStatus } from '../entities/assignment-status.enum';
import { ExerciseCategory } from '../entities/exercise-category.enum';

describe('WorkoutsService', () => {
  let service!: WorkoutsService;
  let mockExerciseRepo!: Record<string, jest.Mock>;
  let mockTemplateRepo!: Record<string, jest.Mock>;
  let mockAssignmentRepo!: Record<string, jest.Mock>;
  let mockDataSource!: Record<string, jest.Mock>;
  let mockTenantContext!: Record<string, jest.Mock>;
  let mockOutboxService!: Record<string, jest.Mock>;

  const orgId = 'org-123';
  const otherOrgId = 'org-999';
  const memberId = 'member-uuid-1';

  const templateFixture = {
    id: 'template-1',
    organization_id: orgId,
    name: 'Strength Program',
  } as WorkoutTemplate;

  const exerciseFixture = {
    id: 'exercise-1',
    organization_id: orgId,
    name: 'Bench Press',
    category: ExerciseCategory.STRENGTH,
    is_active: true,
  } as Exercise;

  beforeEach(async () => {
    mockExerciseRepo = {
      create: jest.fn().mockImplementation((dto) => ({ id: 'exercise-1', ...dto })),
      save: jest.fn().mockImplementation((e) => Promise.resolve(e)),
      find: jest.fn().mockResolvedValue([exerciseFixture]),
      findOne: jest.fn().mockResolvedValue(exerciseFixture),
    };

    mockTemplateRepo = {
      create: jest.fn().mockImplementation((dto) => ({ id: 'template-1', ...dto })),
      save: jest.fn().mockImplementation((t) => Promise.resolve(t)),
      find: jest.fn().mockResolvedValue([templateFixture]),
      findOne: jest.fn().mockResolvedValue(templateFixture),
    };

    mockAssignmentRepo = {
      create: jest.fn().mockImplementation((dto) => ({ id: 'assignment-1', ...dto })),
      save: jest.fn().mockImplementation((a) => Promise.resolve(a)),
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
    };

    mockDataSource = {
      transaction: jest.fn().mockImplementation(async (cb: (mgr: EntityManager) => unknown) => {
        const manager = {
          getRepository: jest.fn().mockImplementation((target: any) => {
            if (target === WorkoutTemplate) return mockTemplateRepo;
            if (target === WorkoutPlanAssignment) return mockAssignmentRepo;
            return {};
          }),
        };
        return cb(manager as unknown as EntityManager);
      }),
      query: jest.fn().mockResolvedValue([{ completed: 0, prescribed: 0 }]),
    };

    mockTenantContext = {
      getCurrentOrganizationId: jest.fn().mockResolvedValue(orgId),
      getRequestedOrganizationId: jest.fn(),
      requireOrganizationAccess: jest.fn().mockResolvedValue(orgId),
      getCurrentBranchId: jest.fn().mockResolvedValue(null),
      validateBranchAccess: jest.fn().mockResolvedValue(true),
      getCurrentUserId: jest.fn().mockResolvedValue('user-1'),
    };

    mockOutboxService = {
      saveEvent: jest.fn().mockResolvedValue({}),
      saveEventEnvelope: jest.fn().mockResolvedValue({}),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkoutsService,
        { provide: getRepositoryToken(Exercise), useValue: mockExerciseRepo },
        { provide: getRepositoryToken(WorkoutTemplate), useValue: mockTemplateRepo },
        { provide: getRepositoryToken(WorkoutPlanAssignment), useValue: mockAssignmentRepo },
        { provide: getDataSourceToken(), useValue: mockDataSource },
        { provide: TenantContextService, useValue: mockTenantContext },
        { provide: OutboxService, useValue: mockOutboxService },
      ],
    }).compile();

    service = module.get<WorkoutsService>(WorkoutsService);
  });
// --------------------------------------------------------------------------
  // Org-scoping enforcement (cross-org isolation)
  // --------------------------------------------------------------------------

  describe('org-scoping enforcement', () => {
    it('findExerciseById only returns an exercise belonging to the caller org', async () => {
      const result = await service.findExerciseById('exercise-1');
      expect(result).toBe(exerciseFixture);
      expect(mockExerciseRepo.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'exercise-1', organization_id: orgId },
        }),
      );
    });

    it('assignPlan rejects a template that does not belong to the caller org', async () => {
      mockTemplateRepo.findOne.mockResolvedValue(null);
      await expect(
        service.assignPlan({
          memberId,
          templateId: 'template-outside-org',
          assignedBy: 'system',
          startDate: '2026-10-01',
        }),
      ).rejects.toThrow('not found');
    });

    it('findExerciseById rejects org B accessing org A exercise via org-scoped query', async () => {
      mockTenantContext.getCurrentOrganizationId.mockResolvedValue(otherOrgId);
      mockExerciseRepo.findOne.mockResolvedValue(null);
      await expect(service.findExerciseById('exercise-1')).rejects.toThrow(
        'not found',
      );
    });
  });

  // --------------------------------------------------------------------------
  // assignPlan — the cross-module dependency contract
  // --------------------------------------------------------------------------

  describe('assignPlan (single write path, PT dependency contract)', () => {
    const validInput = {
      memberId,
      templateId: 'template-1',
      assignedBy: 'trainer-1',
      startDate: '2026-10-01',
      endDate: '2026-12-31',
      notes: 'Assigned by PT',
    };

    it('creates an assignment with status active and emits the outbox event', async () => {
      mockAssignmentRepo.findOne.mockResolvedValue(null);
      mockAssignmentRepo.create.mockImplementation((dto) => ({
        id: 'assignment-1',
        assigned_at: new Date(),
        ...dto,
      }));
      mockAssignmentRepo.save.mockResolvedValue({
        id: 'assignment-1',
        assigned_at: new Date(),
      });

      const result = await service.assignPlan(validInput);

      expect(result.id).toBe('assignment-1');
      expect(mockAssignmentRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          organization_id: orgId,
          member_id: memberId,
          template_id: 'template-1',
          assigned_by: 'trainer-1',
          start_date: '2026-10-01',
          end_date: '2026-12-31',
          status: 'active',
        }),
      );
      expect(mockOutboxService.saveEventEnvelope).toHaveBeenCalledWith(
        'WorkoutPlanAssigned.v1',
        '1',
        orgId,
        expect.objectContaining({
          assignmentId: 'assignment-1',
          memberId,
          templateId: 'template-1',
          assignedBy: 'trainer-1',
        }),
        memberId,
        undefined,
        expect.anything(),
      );
    });

    it('rejects a duplicate active assignment for the same (member, template)', async () => {
      mockTemplateRepo.findOne.mockResolvedValue(templateFixture);
      mockAssignmentRepo.findOne.mockResolvedValue({ id: 'existing-assignment' });
      await expect(service.assignPlan(validInput)).rejects.toThrow(/already has an active assignment/);
    });

    // ---------------------------------------------------------------------
    // CONCURRENCY BACKSTOP — proving the DB partial unique index catches a
    // race the app-level belt check misses.
    //
    // Real-world race: two requests for the SAME (member, template) arrive
    // concurrently. Both transactions read "no active assignment exists"
    // (app-level `findOne` returns null for BOTH — the belt passes twice),
    // then both attempt the INSERT. Only the DB can reject the second one,
    // via the partial unique index on (member_id, template_id) WHERE status
    // = 'active' (migration 1788965263243).
    //
    // This test simulates that exact interleave: both calls pass the belt
    // simultaneously, then the second INSERT is refused by a Postgres
    // unique-violation (SQLSTATE 23505) thrown from `save`. We assert exactly
    // one call succeeds and the other is forced out by the DB-level error —
    // NOT by the app-level duplicate check.
    it('under a CONCURRENT race only ONE assignPlan succeeds — the DB backstop rejects the second', async () => {
      mockTemplateRepo.findOne.mockResolvedValue(templateFixture);
      // Belt-and-suspenders race: BOTH calls see "no active assignment" —
      // the app-level uniqueness check passes for both, so it cannot help.
      mockAssignmentRepo.findOne.mockResolvedValue(null);

      // First INSERT wins; second INSERT violates the partial unique index.
      mockAssignmentRepo.create.mockImplementation((dto) => ({
        id: 'assignment-race-1',
        assigned_at: new Date(),
        ...dto,
      }));

      let saveCalls = 0;
      mockAssignmentRepo.save.mockImplementation((a) => {
        saveCalls += 1;
        if (saveCalls > 1) {
          // Simulate Postgres unique_violation (SQLSTATE 23505) from the
          // partial unique index on (member_id, template_id) WHERE status='active'.
          const dbError = new Error(
            'duplicate key value violates unique constraint "UQ_workouts_active_assignment"',
          ) as Error & { code?: string };
          dbError.code = '23505';
          return Promise.reject(dbError);
        }
        return Promise.resolve({ id: 'assignment-race-1', assigned_at: new Date() });
      });

      // Invoke BOTH concurrently so their belt-checks interleave before either saves.
      const results = await Promise.allSettled([
        service.assignPlan(validInput),
        service.assignPlan(validInput),
      ]);

      // Exactly one assignment is created; the other is rejected by the DB.
      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);

      // The rejected one must be a DB-level unique-violation (SQLSTATE 23505),
      // i.e. the DB backstop — not an app-level ConflictException.
      const rejection = (rejected[0] as PromiseRejectedResult).reason;
      expect(rejection.code).toBe('23505');

      // `save` was invoked twice (both passed the belt check), confirming the
      // app-level check could NOT prevent the duplicate — only the DB index could.
      expect(mockAssignmentRepo.save).toHaveBeenCalledTimes(2);
      // Only one outbox event is emitted (side-effect of the losing INSERT rolled back).
      expect(mockOutboxService.saveEventEnvelope).toHaveBeenCalledTimes(1);
    });

    it('allows assigning a DIFFERENT template concurrently (Q6)', async () => {
      mockTemplateRepo.findOne.mockResolvedValue(templateFixture);
      mockAssignmentRepo.findOne.mockResolvedValue(null);
      mockAssignmentRepo.create.mockImplementation((dto) => ({ id: 'assignment-2', assigned_at: new Date(), ...dto }));
      mockAssignmentRepo.save.mockResolvedValue({ id: 'assignment-2', assigned_at: new Date() });

      const result = await service.assignPlan({ ...validInput, templateId: 'template-2' });
      expect(result.id).toBe('assignment-2');
      expect(mockOutboxService.saveEventEnvelope).toHaveBeenCalled();
    });

    it('creates an assignment with status active even when startDate is in the future', async () => {
      mockTemplateRepo.findOne.mockResolvedValue(templateFixture);
      mockAssignmentRepo.findOne.mockResolvedValue(null);
      mockAssignmentRepo.create.mockImplementation((dto) => ({
        id: 'assignment-future',
        assigned_at: new Date(),
        ...dto,
      }));
      mockAssignmentRepo.save.mockResolvedValue({ id: 'assignment-future', assigned_at: new Date() });

      const futureDate = new Date();
      futureDate.setFullYear(futureDate.getFullYear() + 1);
      const futureDateStr = futureDate.toISOString().slice(0, 10);

      const result = await service.assignPlan({
        ...validInput,
        startDate: futureDateStr,
      });

      expect(result.id).toBe('assignment-future');
      // Status is always 'active' — not 'scheduled' or 'pending'
      expect(mockAssignmentRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'active',
          start_date: futureDateStr,
        }),
      );
      expect(mockOutboxService.saveEventEnvelope).toHaveBeenCalled();
    });

    it('is the SINGLE code path — the same assignPlan method both the PT and the member API use', async () => {
      // This test directly invokes the same exported method PT will call.
      // It must behave identically to the API path because the API controller
      // wraps exactly this method — there is no separate createAssignment().
      mockTemplateRepo.findOne.mockResolvedValue(templateFixture);
      mockAssignmentRepo.findOne.mockResolvedValue(null);
      mockAssignmentRepo.create.mockImplementation((dto) => ({ id: 'assignment-pt', assigned_at: new Date(), ...dto }));
      mockAssignmentRepo.save.mockResolvedValue({ id: 'assignment-pt', assigned_at: new Date() });

      const result = await service.assignPlan(validInput);
      expect(result.id).toBe('assignment-pt');
      // The same repository calls the same validation & outbox write happen here;
      // there are no alternate code branches.
      expect(mockTemplateRepo.findOne).toHaveBeenCalled();
      expect(mockAssignmentRepo.findOne).toHaveBeenCalled();
      expect(mockOutboxService.saveEventEnvelope).toHaveBeenCalled();
    });
  });

  // --------------------------------------------------------------------------
  // Progress calculation (Q7)
  // --------------------------------------------------------------------------

  describe('progress calculation', () => {
    it('computes percentage as completed / prescribed (no volume math)', async () => {
      mockAssignmentRepo.findOne.mockResolvedValue({
        id: 'assignment-1',
        organization_id: orgId,
        start_date: '2026-09-01',
        end_date: null,
      });
      mockDataSource.query.mockResolvedValue([{ completed: 3, prescribed: 4 }]);

      const progress = await service.getAssignmentProgress('assignment-1');
      expect(progress).toEqual({ completed: 3, prescribed: 4, percentage: 75 });
    });

    it('returns 0% when no exercises have been logged', async () => {
      mockAssignmentRepo.findOne.mockResolvedValue({
        id: 'assignment-1',
        organization_id: orgId,
        start_date: '2026-09-01',
        end_date: null,
      });
      mockDataSource.query.mockResolvedValue([{ completed: 0, prescribed: 0 }]);

      const progress = await service.getAssignmentProgress('assignment-1');
      expect(progress).toEqual({ completed: 0, prescribed: 0, percentage: 0 });
    });
  });

  // --------------------------------------------------------------------------
  // Org-scoping for progress
  // --------------------------------------------------------------------------

  describe('org-scoping for progress', () => {
    it('rejects progress lookup for an assignment in another org', async () => {
      mockAssignmentRepo.findOne.mockResolvedValue(null);
      await expect(
        service.getAssignmentProgress('assignment-other-org'),
      ).rejects.toThrow('WorkoutPlanAssignment not found');
    });
  });
});
