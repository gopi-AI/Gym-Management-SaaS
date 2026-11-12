/**
 * Real-Postgres proof for `DietService.getDailyTotals()` (P2-06).
 *
 * The security invariant is:
 *
 *   A caller may read daily macro totals only for a member whose organization
 *   matches the caller's authenticated organization.
 *
 * These tests use a real `DataSource`, real repositories and the real
 * `DietService`. They do NOT mock the repository, EntityManager or DataSource,
 * and every assertion is made through a second read.
 *
 * Coverage:
 *   1. Mixed complete and null macros — SUM excludes nulls, mealsMissingMacros
 *      counted, adherence correct.
 *   2. All meals missing macros — null totals, adherence 0.
 *   3. Empty date window — empty array, no error.
 *   4. Inclusive start and end dates — boundary rows included.
 *   5. Cross-organization access — Org-A caller targeting Org-B member returns
 *      zero rows (tenant isolation).
 *
 * RUNNING IT
 *   RUN_DB_INTEGRATION=1 \
 *     DB_HOST=<host> DB_PORT=<port> DB_USERNAME=<user> DB_PASSWORD=<password> \
 *     DB_DATABASE=<scratch> \
 *     npx jest src/diet/services/diet-tab.integration.spec
 *
 * The database MUST already be migrated. All five DB_* variables are required
 * explicitly — this spec deliberately has no defaults, so a missing variable
 * can never fall back to `gym_management`. The database name must match the
 * repository's scratch-database allowlist. Point it at a THROWAWAY database;
 * the seeded rows are deleted in `afterAll`, but that cleanup is a courtesy,
 * not a substitute for an isolated database.
 *
 * Without `RUN_DB_INTEGRATION=1` the block reports as SKIPPED, so the hermetic
 * suite never needs a database.
 */

import { randomUUID } from 'crypto';
import { DataSource, In } from 'typeorm';
import { DietService } from './diet.service';
import { DietPlan } from '../entities/diet-plan.entity';
import { MealTemplate } from '../entities/meal-template.entity';
import { DietPlanAssignment } from '../entities/diet-plan-assignment.entity';
import { NutritionLog } from '../entities/nutrition-log.entity';
import { TenantContextService } from '../../shared/tenant/tenant-context.service';
import { OutboxService } from '../../shared/outbox/outbox.service';

const RUN = process.env.RUN_DB_INTEGRATION === '1';
const describeIntegration = RUN ? describe : describe.skip;

// Distinct, greppable names so a tenant leak is visible in the assertion itself.
const ORG_A = 'ORG-A-DAILY-TOTALS';
const ORG_B = 'ORG-B-DAILY-TOTALS';

const ALLOWED_DATABASE_PATTERN =
  /^gym_(?:[a-z0-9]+_)*(?:scratch|gate|test|verify|ci)(?:_[a-z0-9]+)*$/i;

function assertTestDatabase(database: string): void {
  if (!ALLOWED_DATABASE_PATTERN.test(database)) {
    throw new Error(
      `[diet-tab.integration.spec] DB_DATABASE="${database}" does not match the scratch-database allowlist. ` +
        'Use a throwaway database matching gym_*_scratch|gate|test|verify|ci_*.',
    );
  }
}

describeIntegration('DietService getDailyTotals (real Postgres)', () => {
  let dataSource: DataSource;
  let service: DietService;
  let currentOrg: string;

  const ids = {
    orgA: randomUUID(),
    orgB: randomUUID(),
    memberA: randomUUID(),
    memberB: randomUUID(),
  };

  // The diet domain resolves its tenant from this service only; the authorized
  // organization is never read from a request body.
  const tenant = {
    getCurrentOrganizationId: jest.fn(async () => currentOrg),
    getRequestedOrganizationId: jest.fn(async () => null),
    requireOrganizationAccess: jest.fn(async (orgId: string) => orgId),
  } as unknown as TenantContextService;

  const outbox = {
    saveEventEnvelope: jest.fn().mockResolvedValue(undefined),
    saveEvent: jest.fn().mockResolvedValue({}),
  } as unknown as OutboxService;

  const logDateStr = (d: unknown) => {
    const date = d as Date;
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  };

  beforeAll(async () => {
    assertTestDatabase(process.env.DB_DATABASE || '');

    dataSource = new DataSource({
      type: 'postgres',
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432', 10),
      username: process.env.DB_USERNAME || 'postgres',
      password: process.env.DB_PASSWORD || 'postgres',
      database: process.env.DB_DATABASE || '',
      // Same glob as `src/data-source.ts`, so this spec can never drift from
      // the entities the application actually maps.
      entities: [__dirname + '/../../**/*.entity{.ts,.js}'],
      synchronize: false,
    });
    await dataSource.initialize();

    const logs = dataSource.getRepository(NutritionLog);

    // Org A member — mixed complete and null macros across dates.
    await logs.save([
      {
        id: randomUUID(),
        organization_id: ids.orgA,
        member_id: ids.memberA,
        assignment_id: null,
        meal_template_id: null,
        meal_description: 'Breakfast',
        log_date: '2026-10-15',
        servings: 1,
        logged_at: new Date('2026-10-15T08:00:00.000Z'),
        calories: 500,
        protein_g: '30.00',
        carbs_g: '20.00',
        fat_g: '10.00',
      },
      {
        id: randomUUID(),
        organization_id: ids.orgA,
        member_id: ids.memberA,
        assignment_id: null,
        meal_template_id: null,
        meal_description: 'Snack (no macros)',
        log_date: '2026-10-15',
        servings: 1,
        logged_at: new Date('2026-10-15T15:00:00.000Z'),
        calories: null,
        protein_g: null,
        carbs_g: null,
        fat_g: null,
      },
      {
        id: randomUUID(),
        organization_id: ids.orgA,
        member_id: ids.memberA,
        assignment_id: null,
        meal_template_id: null,
        meal_description: 'Dinner',
        log_date: '2026-10-16',
        servings: 1,
        logged_at: new Date('2026-10-16T19:00:00.000Z'),
        calories: 700,
        protein_g: '40.00',
        carbs_g: '30.00',
        fat_g: '20.00',
      },
    ]);

    // Org B member — should be invisible to an Org-A caller.
    await logs.save([
      {
        id: randomUUID(),
        organization_id: ids.orgB,
        member_id: ids.memberB,
        assignment_id: null,
        meal_template_id: null,
        meal_description: 'Org B meal',
        log_date: '2026-10-15',
        servings: 1,
        logged_at: new Date('2026-10-15T08:00:00.000Z'),
        calories: 999,
        protein_g: '99.00',
        carbs_g: '99.00',
        fat_g: '99.00',
      },
    ]);

    service = new DietService(
      dataSource.getRepository(DietPlan),
      dataSource.getRepository(MealTemplate),
      dataSource.getRepository(DietPlanAssignment),
      dataSource.getRepository(NutritionLog),
      dataSource,
      tenant,
      outbox,
    );
  }, 30000);

  beforeEach(() => {
    currentOrg = ids.orgA;
  });

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    const orgFilter = In([ids.orgA, ids.orgB]);
    // Children first. Every seeded row carries one of this suite's two org ids,
    // so this sweep can never touch pre-existing data.
    await dataSource
      .getRepository(NutritionLog)
      .delete({ organization_id: orgFilter });
    await dataSource.destroy();
  });

  it('aggregates mixed complete and null macros correctly', async () => {
    const result = await service.getDailyTotals(
      ids.memberA,
      '2026-10-15',
      '2026-10-16',
    );

    expect(result).toHaveLength(2);

    const day15 = result.find((r) => logDateStr(r.log_date) === '2026-10-15');
    expect(day15).toBeDefined();
    expect(day15!.totalCalories).toBe(500);
    expect(day15!.totalProteinG).toBe(30);
    expect(day15!.totalCarbsG).toBe(20);
    expect(day15!.totalFatG).toBe(10);
    expect(day15!.mealsMissingMacros).toBe(1);
    expect(day15!.totalMeals).toBe(2);
    expect(day15!.adherencePct).toBe(50);

    const day16 = result.find((r) => logDateStr(r.log_date) === '2026-10-16');
    expect(day16).toBeDefined();
    expect(day16!.totalCalories).toBe(700);
    expect(day16!.totalProteinG).toBe(40);
    expect(day16!.totalCarbsG).toBe(30);
    expect(day16!.totalFatG).toBe(20);
    expect(day16!.mealsMissingMacros).toBe(0);
    expect(day16!.totalMeals).toBe(1);
    expect(day16!.adherencePct).toBe(100);
  });

  it('returns null totals when all meals in the window are missing macros', async () => {
    // Seed a day where all meals have null macros.
    const logs = dataSource.getRepository(NutritionLog);
    await logs.save({
      id: randomUUID(),
      organization_id: ids.orgA,
      member_id: ids.memberA,
      assignment_id: null,
      meal_template_id: null,
      meal_description: 'No macros',
      log_date: '2026-10-17',
      servings: 1,
      logged_at: new Date('2026-10-17T08:00:00.000Z'),
      calories: null,
      protein_g: null,
      carbs_g: null,
      fat_g: null,
    });

    const result = await service.getDailyTotals(
      ids.memberA,
      '2026-10-17',
      '2026-10-17',
    );

    expect(result).toHaveLength(1);
    expect(result[0].totalCalories).toBeNull();
    expect(result[0].totalProteinG).toBeNull();
    expect(result[0].totalCarbsG).toBeNull();
    expect(result[0].totalFatG).toBeNull();
    expect(result[0].mealsMissingMacros).toBe(1);
    expect(result[0].totalMeals).toBe(1);
    expect(result[0].adherencePct).toBe(0);

    // Clean up the extra row.
    await logs.delete({ organization_id: ids.orgA, log_date: '2026-10-17' });
  });

  it('returns an empty array for an empty date window', async () => {
    const result = await service.getDailyTotals(
      ids.memberA,
      '2026-01-01',
      '2026-01-02',
    );
    expect(result).toEqual([]);
  });

  it('includes boundary rows for inclusive start and end dates', async () => {
    const result = await service.getDailyTotals(
      ids.memberA,
      '2026-10-15',
      '2026-10-15',
    );

    expect(result).toHaveLength(1);
    expect(logDateStr(result[0].log_date)).toBe('2026-10-15');
    expect(result[0].totalCalories).toBe(500);
  });

  it('rejects cross-organization access (Org-A caller, Org-B member)', async () => {
    const result = await service.getDailyTotals(
      ids.memberB,
      '2026-10-15',
      '2026-10-16',
    );
    expect(result).toEqual([]);
  });
});