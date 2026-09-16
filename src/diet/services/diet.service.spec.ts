import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken, getDataSourceToken } from '@nestjs/typeorm';
import { EntityManager } from 'typeorm';
import { DietService } from './diet.service';
import { DietPlan } from '../entities/diet-plan.entity';
import { MealTemplate } from '../entities/meal-template.entity';
import { DietPlanAssignment } from '../entities/diet-plan-assignment.entity';
import { NutritionLog } from '../entities/nutrition-log.entity';
import { TenantContextService } from '../../shared/tenant/tenant-context.service';
import { OutboxService } from '../../shared/outbox/outbox.service';
import { AssignmentStatus } from '../entities/assignment-status.enum';
import { MealType } from '../entities/meal-type.enum';

describe('DietService', () => {
  let service!: DietService;
  let mockDietPlanRepo!: Record<string, jest.Mock>;
  let mockTemplateRepo!: Record<string, jest.Mock>;
  let mockAssignmentRepo!: Record<string, jest.Mock>;
  let mockLogRepo!: Record<string, jest.Mock>;
  let mockDataSource!: Record<string, jest.Mock>;
  let mockTenantContext!: Record<string, jest.Mock>;
  let mockOutboxService!: Record<string, jest.Mock>;

  const orgId = 'org-123';
  const otherOrgId = 'org-999';
  const memberId = 'member-uuid-1';

  const dietPlanFixture = {
    id: 'plan-1',
    organization_id: orgId,
    name: 'Weight Loss',
    total_calories_per_day: 2000,
    is_active: true,
  } as DietPlan;

  const templateFixture = {
    id: 'template-1',
    organization_id: orgId,
    diet_plan_id: 'plan-1',
    name: 'Protein Shake',
    meal_type: MealType.SNACK,
    calories: 250,
    protein_g: '30.00',
    carbs_g: '10.00',
    fat_g: '5.00',
    serving_size: '1.00',
  } as MealTemplate;

  const assignmentFixture = {
    id: 'assignment-1',
    organization_id: orgId,
    member_id: memberId,
    diet_plan_id: 'plan-1',
    assigned_by: 'trainer-1',
    assigned_at: new Date(),
    start_date: '2026-10-01',
    end_date: null,
    status: AssignmentStatus.ACTIVE,
  } as DietPlanAssignment;

  beforeEach(async () => {
    mockDietPlanRepo = {
      create: jest.fn().mockImplementation((dto) => ({ id: 'plan-1', ...dto })),
      save: jest.fn().mockImplementation((d) => Promise.resolve(d)),
      find: jest.fn().mockResolvedValue([dietPlanFixture]),
      findOne: jest.fn().mockResolvedValue(dietPlanFixture),
    };

    mockTemplateRepo = {
      create: jest.fn().mockImplementation((dto) => ({ id: 'template-1', ...dto })),
      save: jest.fn().mockImplementation((t) => Promise.resolve(t)),
      find: jest.fn().mockResolvedValue([templateFixture]),
      findOne: jest.fn().mockResolvedValue(templateFixture),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      createQueryBuilder: jest.fn(),
    };

    mockAssignmentRepo = {
      create: jest.fn().mockImplementation((dto) => ({ id: 'assignment-1', ...dto })),
      save: jest.fn().mockImplementation((a) => Promise.resolve(a)),
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
    };

    mockLogRepo = {
      create: jest.fn().mockImplementation((dto) => ({ id: 'log-1', ...dto })),
      save: jest.fn().mockImplementation((l) => Promise.resolve(l)),
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      query: jest.fn().mockResolvedValue([]),
      createQueryBuilder: jest.fn(),
    };

    mockDataSource = {
      transaction: jest.fn().mockImplementation(async (cb: (mgr: EntityManager) => unknown) => {
        const manager = {
          getRepository: jest.fn().mockImplementation((target: any) => {
            if (target === DietPlan) return mockDietPlanRepo;
            if (target === MealTemplate) return mockTemplateRepo;
            if (target === DietPlanAssignment) return mockAssignmentRepo;
            if (target === NutritionLog) return mockLogRepo;
            return {};
          }),
        };
        return cb(manager as unknown as EntityManager);
      }),
      query: jest.fn().mockResolvedValue([]),
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
        DietService,
        { provide: getRepositoryToken(DietPlan), useValue: mockDietPlanRepo },
        { provide: getRepositoryToken(MealTemplate), useValue: mockTemplateRepo },
        { provide: getRepositoryToken(DietPlanAssignment), useValue: mockAssignmentRepo },
        { provide: getRepositoryToken(NutritionLog), useValue: mockLogRepo },
        { provide: getDataSourceToken(), useValue: mockDataSource },
        { provide: TenantContextService, useValue: mockTenantContext },
        { provide: OutboxService, useValue: mockOutboxService },
      ],
    }).compile();

    service = module.get<DietService>(DietService);
  });

  // --------------------------------------------------------------------------
  // Org-scoping enforcement (cross-org isolation)
  // --------------------------------------------------------------------------

  describe('org-scoping enforcement', () => {
    it('findDietPlanById only returns a plan belonging to the caller org', async () => {
      const result = await service.findDietPlanById('plan-1');
      expect(result).toBe(dietPlanFixture);
      expect(mockDietPlanRepo.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'plan-1', organization_id: orgId },
        }),
      );
    });

    it('findDietPlanById rejects a plan that does not belong to the caller org', async () => {
      mockDietPlanRepo.findOne.mockResolvedValue(null);
      await expect(
        service.findDietPlanById('plan-outside-org'),
      ).rejects.toThrow('DietPlan not found');
    });

    it('findMealTemplateById only returns a template belonging to the caller org', async () => {
      const result = await service.findMealTemplateById('template-1');
      expect(result).toBe(templateFixture);
      expect(mockTemplateRepo.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'template-1', organization_id: orgId },
        }),
      );
    });

    it('createMealTemplate rejects a diet plan that does not belong to the caller org', async () => {
      mockDietPlanRepo.findOne.mockResolvedValue(null);
      await expect(
        service.createMealTemplate({
          dietPlanId: 'plan-outside-org',
          name: 'Bad Shake',
          mealType: MealType.SNACK,
          calories: 100,
          proteinG: '10.00',
          carbsG: '5.00',
          fatG: '2.00',
          servingSize: '1.00',
        }),
      ).rejects.toThrow('not found');
    });

    it('findAssignmentById rejects a cross-org assignment', async () => {
      mockAssignmentRepo.findOne.mockResolvedValue(null);
      await expect(
        service.findAssignmentById('assignment-other-org'),
      ).rejects.toThrow('DietPlanAssignment not found');
    });
  });
// --------------------------------------------------------------------------
  // assignPlan — Q8 (multi-plan per member, same-plan uniqueness)
  // --------------------------------------------------------------------------

  describe('assignPlan', () => {
    const validInput = {
      memberId,
      dietPlanId: 'plan-1',
      assignedBy: 'trainer-1',
      startDate: '2026-10-01',
      endDate: '2026-12-31',
    };

    it('creates an assignment with status active and emits the outbox event', async () => {
      mockDietPlanRepo.findOne.mockResolvedValue(dietPlanFixture);
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
          diet_plan_id: 'plan-1',
          assigned_by: 'trainer-1',
          start_date: '2026-10-01',
          end_date: '2026-12-31',
          status: 'active',
        }),
      );
      expect(mockOutboxService.saveEventEnvelope).toHaveBeenCalledWith(
        'DietPlanAssigned.v1',
        '1',
        orgId,
        expect.objectContaining({
          assignmentId: 'assignment-1',
          memberId,
          dietPlanId: 'plan-1',
          assignedBy: 'trainer-1',
        }),
        memberId,
        undefined,
        expect.anything(),
      );
    });

    it('rejects a duplicate active assignment for the same (member, dietPlan)', async () => {
      mockDietPlanRepo.findOne.mockResolvedValue(dietPlanFixture);
      mockAssignmentRepo.findOne.mockResolvedValue({
        id: 'existing-assignment',
      });
      await expect(service.assignPlan(validInput)).rejects.toThrow(
        /already has an active assignment/,
      );
    });

    it('allows assigning a DIFFERENT diet plan concurrently (Q8)', async () => {
      mockDietPlanRepo.findOne.mockResolvedValue(dietPlanFixture);
      mockAssignmentRepo.findOne.mockResolvedValue(null);
      mockAssignmentRepo.create.mockImplementation((dto) => ({
        id: 'assignment-2',
        assigned_at: new Date(),
        ...dto,
      }));
      mockAssignmentRepo.save.mockResolvedValue({
        id: 'assignment-2',
        assigned_at: new Date(),
      });

      const result = await service.assignPlan({
        ...validInput,
        dietPlanId: 'plan-2',
      });
      expect(result.id).toBe('assignment-2');
      expect(mockOutboxService.saveEventEnvelope).toHaveBeenCalled();
    });

    it('rejects assigning a plan that does not belong to the caller org', async () => {
      mockDietPlanRepo.findOne.mockResolvedValue(null);
      await expect(service.assignPlan(validInput)).rejects.toThrow('not found');
    });

    // -------------------------------------------------------------------
    // CONCURRENCY BACKSTOP — proving the DB partial unique index catches a
    // race the app-level belt check misses.
    it('lets the DB partial unique index reject a concurrent duplicate (SQLSTATE 23505)', async () => {
      // Belt check: findOne returns null for BOTH (they run before either saves)
      mockDietPlanRepo.findOne.mockResolvedValue(dietPlanFixture);
      mockAssignmentRepo.findOne.mockResolvedValue(null);

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
          // partial unique index on (member_id, diet_plan_id) WHERE status='active'.
          const dbError = new Error(
            'duplicate key value violates unique constraint "UQ_diet_active_assignment"',
          ) as Error & { code?: string };
          dbError.code = '23505';
          return Promise.reject(dbError);
        }
        return Promise.resolve({
          id: 'assignment-race-1',
          assigned_at: new Date(),
        });
      });

      const results = await Promise.allSettled([
        service.assignPlan(validInput),
        service.assignPlan(validInput),
      ]);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);

      const rejection = (rejected[0] as PromiseRejectedResult).reason;
      expect(rejection.code).toBe('23505');

      // Both passed the belt check; only the DB index could reject the second.
      expect(mockAssignmentRepo.save).toHaveBeenCalledTimes(2);
      // Only one outbox event is emitted.
      expect(mockOutboxService.saveEventEnvelope).toHaveBeenCalledTimes(1);
    });
  });
// --------------------------------------------------------------------------
  // logMeal — Q9 (free-text / templated) & Q10 (macro snapshot)
  // --------------------------------------------------------------------------

  describe('logMeal', () => {
    const templatedInput = {
      memberId,
      mealTemplateId: 'template-1',
      logDate: '2026-10-15',
      servings: 2,
    };

    const freeTextInput = {
      memberId,
      logDate: '2026-10-15',
      servings: 1,
      mealDescription: 'Custom keto meal',
    };

    const freeTextWithMacrosInput = {
      memberId,
      logDate: '2026-10-15',
      servings: 1,
      mealDescription: 'Custom meal with macros',
      calories: 500,
      proteinG: '40.00',
      carbsG: '20.00',
      fatG: '15.00',
    };

    it('templated: snapshots macros as template_value x servings (Q10)', async () => {
      mockTemplateRepo.findOne.mockResolvedValue(templateFixture);
      mockLogRepo.create.mockImplementation((dto) => ({ id: 'log-1', ...dto }));
      mockLogRepo.save.mockImplementation((l) => Promise.resolve(l));

      const result = await service.logMeal(templatedInput);

      // template: cals=250, protein=30g, carbs=10g, fat=5g × 2 servings
      expect(result.calories).toBe(500);
      expect(result.protein_g).toBe('60.00');
      expect(result.carbs_g).toBe('20.00');
      expect(result.fat_g).toBe('10.00');
      // meal_description must be null for templated meals
      expect(result.meal_description).toBeNull();
      expect(result.meal_template_id).toBe('template-1');
    });

    it('templated: emits NutritionLogRecorded.v1 outbox event', async () => {
      mockTemplateRepo.findOne.mockResolvedValue(templateFixture);
      mockLogRepo.create.mockImplementation((dto) => ({ id: 'log-1', ...dto }));
      mockLogRepo.save.mockImplementation((l) => Promise.resolve({ ...l, id: 'log-1' }));

      await service.logMeal(templatedInput);

      expect(mockOutboxService.saveEventEnvelope).toHaveBeenCalledWith(
        'NutritionLogRecorded.v1',
        '1',
        orgId,
        expect.objectContaining({
          mealTemplateId: 'template-1',
          mealDescription: null,
          logDate: '2026-10-15',
        }),
        memberId,
        undefined,
        expect.anything(),
      );
    });

    it('templated: macro snapshot is immutable — template changes do not retroactively alter logged values', async () => {
      mockTemplateRepo.findOne.mockResolvedValue(templateFixture);
      mockLogRepo.create.mockImplementation((dto) => ({ id: 'log-1', ...dto }));
      mockLogRepo.save.mockImplementation((l) => Promise.resolve(l));

      const result = await service.logMeal(templatedInput);
      expect(result.calories).toBe(500);
      expect(result.protein_g).toBe('60.00');

      // Simulate a subsequent template edit (changes template but logged meal is unchanged)
      const updatedTemplate = { ...templateFixture, calories: 300, protein_g: '40.00' };
      mockTemplateRepo.findOne.mockResolvedValue(updatedTemplate);
      mockLogRepo.create.mockImplementation((dto) => ({ id: 'log-2', ...dto }));
      mockLogRepo.save.mockImplementation((l) => Promise.resolve(l));

      const secondLog = await service.logMeal({
        ...templatedInput,
        servings: 1,
      });

      // The NEW log uses the UPDATED template values
      expect(secondLog.calories).toBe(300);
      expect(secondLog.protein_g).toBe('40.00');

      // The OLD log retains its original snapshot (proven by calories: 500)
      expect(result.calories).toBe(500);
    });

    it('templated: rejects a template not found in the org', async () => {
      mockTemplateRepo.findOne.mockResolvedValue(null);
      await expect(service.logMeal(templatedInput)).rejects.toThrow('not found');
    });

    it('free-text: stores meal_description with null macros (Q9)', async () => {
      mockLogRepo.create.mockImplementation((dto) => ({ id: 'log-ft', ...dto }));
      mockLogRepo.save.mockImplementation((l) => Promise.resolve(l));

      const result = await service.logMeal(freeTextInput);

      expect(result.meal_template_id).toBeNull();
      expect(result.meal_description).toBe('Custom keto meal');
      expect(result.calories).toBeNull();
      expect(result.protein_g).toBeNull();
      expect(result.carbs_g).toBeNull();
      expect(result.fat_g).toBeNull();
    });

    it('free-text: stores user-supplied macros when provided', async () => {
      mockLogRepo.create.mockImplementation((dto) => ({ id: 'log-ftm', ...dto }));
      mockLogRepo.save.mockImplementation((l) => Promise.resolve(l));

      const result = await service.logMeal(freeTextWithMacrosInput);

      expect(result.meal_template_id).toBeNull();
      expect(result.calories).toBe(500);
      expect(result.protein_g).toBe('40.00');
      expect(result.carbs_g).toBe('20.00');
      expect(result.fat_g).toBe('15.00');
    });

    it('free-text: emits NutritionLogRecorded.v1 with null mealTemplateId', async () => {
      mockLogRepo.create.mockImplementation((dto) => ({ id: 'log-ft', ...dto }));
      mockLogRepo.save.mockImplementation((l) => Promise.resolve({ ...l, id: 'log-ft' }));

      await service.logMeal(freeTextInput);

      expect(mockOutboxService.saveEventEnvelope).toHaveBeenCalledWith(
        'NutritionLogRecorded.v1',
        '1',
        orgId,
        expect.objectContaining({
          mealTemplateId: null,
          mealDescription: 'Custom keto meal',
          logDate: '2026-10-15',
        }),
        memberId,
        undefined,
        expect.anything(),
      );
    });
  });
// --------------------------------------------------------------------------
  // getDailyTotals — Q9/Q10 null-macro aggregation exclusion
  // --------------------------------------------------------------------------

  describe('getDailyTotals', () => {
    // NOTE: SUM() on an all-null column set returns NULL (since SUM ignores
    // NULLs but returns NULL when there are no non-null rows). The query never
    // uses COALESCE(x,0) — nulls are genuinely excluded.
    it('excludes null macros from sums and surfaces mealsMissingMacros', async () => {
      mockLogRepo.query.mockResolvedValue([
        {
          log_date: '2026-10-15',
          totalCalories: 500,
          totalProteinG: '60.00',
          totalCarbsG: '20.00',
          totalFatG: '10.00',
          mealsMissingMacros: 1,
          totalMeals: 2,
        },
      ]);

      const result = await service.getDailyTotals(
        memberId,
        '2026-10-15',
        '2026-10-15',
      );

      expect(result).toHaveLength(1);
      expect(result[0].log_date).toBe('2026-10-15');
      // 1 complete meal + 1 missing → totals only reflect the complete one
      expect(result[0].totalCalories).toBe(500);
      expect(result[0].totalProteinG).toBe(60);
      expect(result[0].totalCarbsG).toBe(20);
      expect(result[0].totalFatG).toBe(10);
      expect(result[0].mealsMissingMacros).toBe(1);
      expect(result[0].totalMeals).toBe(2);
      expect(result[0].adherencePct).toBe(50);

      // The SQL must NOT apply COALESCE to any macro column.
      const sql = mockLogRepo.query.mock.calls[0][0] as string;
      expect(sql).toContain('SUM(nl.calories)');
      expect(sql.toLowerCase()).not.toContain('coalesce');
    });

    it('returns null totals when ALL meals in the window are missing macros', async () => {
      mockLogRepo.query.mockResolvedValue([
        {
          log_date: '2026-10-16',
          totalCalories: null,
          totalProteinG: null,
          totalCarbsG: null,
          totalFatG: null,
          mealsMissingMacros: 2,
          totalMeals: 2,
        },
      ]);

      const result = await service.getDailyTotals(
        memberId,
        '2026-10-16',
        '2026-10-16',
      );

      expect(result[0].totalCalories).toBeNull();
      expect(result[0].totalProteinG).toBeNull();
      expect(result[0].totalCarbsG).toBeNull();
      expect(result[0].totalFatG).toBeNull();
      expect(result[0].mealsMissingMacros).toBe(2);
      expect(result[0].totalMeals).toBe(2);
      expect(result[0].adherencePct).toBe(0);
    });

    it('returns 100% adherence for a fully-complete day', async () => {
      mockLogRepo.query.mockResolvedValue([
        {
          log_date: '2026-10-17',
          totalCalories: 1800,
          totalProteinG: '150.00',
          totalCarbsG: '120.00',
          totalFatG: '60.00',
          mealsMissingMacros: 0,
          totalMeals: 3,
        },
      ]);

      const result = await service.getDailyTotals(
        memberId,
        '2026-10-17',
        '2026-10-17',
      );

      expect(result[0].adherencePct).toBe(100);
      expect(result[0].mealsMissingMacros).toBe(0);
    });

    it('passes org-scoped and date-range parameters to the query', async () => {
      mockLogRepo.query.mockResolvedValue([]);

      await service.getDailyTotals(memberId, '2026-10-01', '2026-10-31');

      const [sql, params] = mockLogRepo.query.mock.calls[0];
      expect(sql).toContain('nl.organization_id = $1');
      expect(sql).toContain('nl.member_id = $2');
      expect(sql).toContain('nl.log_date >= $3');
      expect(sql).toContain('nl.log_date <= $4');
      expect(params).toEqual([orgId, memberId, '2026-10-01', '2026-10-31']);
    });
  });

  // --------------------------------------------------------------------------
  // DietPlan CRUD
  // --------------------------------------------------------------------------

  describe('DietPlan CRUD', () => {
    it('creates a plan org-scoped and active by default', async () => {
      mockDietPlanRepo.create.mockImplementation((dto) => ({ id: 'plan-new', ...dto }));
      mockDietPlanRepo.save.mockImplementation((p) => Promise.resolve(p));

      const result = await service.createDietPlan({
        name: 'Keto',
        total_calories_per_day: 1800,
      });

      expect(result.organization_id).toBe(orgId);
      expect(result.name).toBe('Keto');
      expect(result.is_active).toBe(true);
      expect(result.total_calories_per_day).toBe(1800);
    });

    it('findAllDietPlans scopes to the caller org', async () => {
      mockDietPlanRepo.find.mockResolvedValue([dietPlanFixture]);
      const result = await service.findAllDietPlans();
      expect(result).toHaveLength(1);
      expect(mockDietPlanRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { organization_id: orgId },
        }),
      );
    });
  });
});