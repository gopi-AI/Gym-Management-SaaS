/**
 * Real-Postgres proof for the meal-template surface (`v1/meal-templates`)
 * behind `DietService.createMealTemplate` / `findAllMealTemplates` /
 * `findMealTemplateById` / `updateMealTemplate` / `deleteMealTemplate`.
 *
 * WHY THIS EXISTS ALONGSIDE `diet.service.spec.ts` AND THE CONTROLLER SPEC
 * The hermetic specs assert the `where` predicates and the delegation, but a
 * mock hands the service whatever the test wants. Two behaviours this task
 * adds cannot be proven that way:
 *   - the 409 delete guard depends on a row that ACTUALLY exists in
 *     `DIET_NUTRITION_LOGS`, whose FK to `DIET_MEAL_TEMPLATES` is
 *     `ON DELETE SET NULL` — a mock cannot show that the guard, and not the FK,
 *     is what keeps the referenced row alive;
 *   - cross-organization isolation only becomes concrete when a real query can
 *     return another org's row. Here a leak surfaces as a named foreign value
 *     (`ORG-B-SHAKE`), not as a count that happens to match.
 *
 * CONCURRENCY (F2) — why two connections are mandatory here
 * The delete's `FOR UPDATE` lock exists to stop a nutrition-log INSERT from
 * committing between the reference count and the DELETE. That is a property of
 * PostgreSQL's row-lock conflict rules, not of the TypeScript, so it can only be
 * measured with two real connections: one transaction inserts a referencing log
 * and holds the FK's `FOR KEY SHARE` lock while the delete is issued, and the
 * delete must BLOCK and then answer 409 rather than 204. MEASURED control: with
 * the `lock: { mode: 'pessimistic_write' }` line removed from
 * `deleteMealTemplate`, the very same test observes the delete returning
 * normally and the log silently orphaned by `ON DELETE SET NULL`.
 *
 * RUNNING IT
 *   RUN_DB_INTEGRATION=1 \
 *     DB_HOST=<host> DB_PORT=<port> DB_USERNAME=<user> DB_PASSWORD=<password> \
 *     DB_DATABASE=<scratch> \
 *     npx jest src/diet/services/diet-meal-templates.integration
 * The database must already be migrated (same `src/data-source.ts` glob and
 * the same five variables). Jest does not load `.env` (`jest.config.js`
 * declares no setupFiles), so all five are passed explicitly. Without
 * `RUN_DB_INTEGRATION=1` the block reports as SKIPPED and the hermetic
 * `npm test` never needs a database.
 *
 * Point it at a THROWAWAY database. Every row it writes carries one of two
 * freshly generated organization ids and is deleted in `afterAll`, but that
 * clean-up is a courtesy, not a substitute for an isolated database.
 *
 * MEASURED: `DIET_DIET_PLANS`, `DIET_MEAL_TEMPLATES` and `DIET_NUTRITION_LOGS`
 * carry no FK on `organization_id`/`member_id`
 * (`1788965263247-CreateDietTables.ts`), so this spec seeds no organization,
 * branch or member rows.
 */
import { randomUUID } from 'crypto';
import { DataSource, In } from 'typeorm';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ValidationPipe,
} from '@nestjs/common';
import { DietService } from './diet.service';
import { DietPlan } from '../entities/diet-plan.entity';
import { MealTemplate } from '../entities/meal-template.entity';
import { DietPlanAssignment } from '../entities/diet-plan-assignment.entity';
import { NutritionLog } from '../entities/nutrition-log.entity';
import { MealType } from '../entities/meal-type.enum';
import { UpdateMealTemplateDto } from '../dto/update-meal-template.dto';
import { TenantContextService } from '../../shared/tenant/tenant-context.service';
import { OutboxService } from '../../shared/outbox/outbox.service';

const RUN = process.env.RUN_DB_INTEGRATION === '1';
const describeIntegration = RUN ? describe : describe.skip;

// Distinct, greppable names so a tenant leak is visible in the assertion itself.
const A_SHAKE = 'ORG-A-SHAKE';
const A_OATS = 'ORG-A-OATS';
const A_REFERENCED = 'ORG-A-REFERENCED';
const B_SHAKE = 'ORG-B-SHAKE';

/**
 * The columns every seeded template shares. Also the exact shape a templated
 * nutrition log copies (`template_value × servings`) at log time, which is why
 * the concurrency fixtures below reuse it.
 */
const TEMPLATE_BASE = {
  meal_type: MealType.SNACK,
  description: null,
  calories: 250,
  protein_g: '30.00',
  carbs_g: '10.00',
  fat_g: '5.00',
  serving_size: '1.00',
};


describeIntegration('DietService meal templates (real Postgres)', () => {
  let dataSource: DataSource;
  let service: DietService;
  let currentOrg: string;

  const ids = {
    orgA: randomUUID(),
    orgB: randomUUID(),
    planA: randomUUID(),
    planA2: randomUUID(),
    planB: randomUUID(),
    templateA: randomUUID(),
    templateA2: randomUUID(),
    templateReferencedA: randomUUID(),
    templateB: randomUUID(),
    logReferencingA: randomUUID(),
  };

  // The diet domain resolves its tenant from this service only; the authorized
  // organization is never read from a request body.
  const tenant = {
    getCurrentOrganizationId: jest.fn(async () => currentOrg),
    getRequestedOrganizationId: jest.fn(async () => null),
    requireOrganizationAccess: jest.fn(async (orgId: string) => orgId),
  } as unknown as TenantContextService;

  // No path under test emits an event (D5), so a stub keeps this suite off
  // `shared.outbox` entirely — which is what lets it run beside the other
  // gated specs without touching their correlation-id-scoped assertions.
  const outbox = {
    saveEventEnvelope: jest.fn().mockResolvedValue(undefined),
    saveEvent: jest.fn().mockResolvedValue({}),
  } as unknown as OutboxService;

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432', 10),
      username: process.env.DB_USERNAME || 'postgres',
      password: process.env.DB_PASSWORD || 'postgres',
      database: process.env.DB_DATABASE || 'gym_management',
      // Same glob as `src/data-source.ts`, so this spec can never drift from
      // the entities the application actually maps.
      entities: [__dirname + '/../../**/*.entity{.ts,.js}'],
      synchronize: false,
    });
    await dataSource.initialize();

    const plans = dataSource.getRepository(DietPlan);
    await plans.save([
      {
        id: ids.planA,
        organization_id: ids.orgA,
        name: 'Org A Cutting',
        is_active: true,
      },
      {
        id: ids.planA2,
        organization_id: ids.orgA,
        name: 'Org A Maintenance',
        is_active: true,
      },
      {
        id: ids.planB,
        organization_id: ids.orgB,
        name: 'Org B Cutting',
        is_active: true,
      },
    ]);

    const templates = dataSource.getRepository(MealTemplate);
    await templates.save([
      {
        ...TEMPLATE_BASE,
        id: ids.templateA,
        organization_id: ids.orgA,
        diet_plan_id: ids.planA,
        name: A_SHAKE,
      },
      {
        ...TEMPLATE_BASE,
        id: ids.templateA2,
        organization_id: ids.orgA,
        diet_plan_id: ids.planA,
        name: A_OATS,
        calories: 300,
      },
      // Referenced by a nutrition log in the SAME org; the only row standing
      // between `templateReferencedA` and a silent `ON DELETE SET NULL`.
      {
        ...TEMPLATE_BASE,
        id: ids.templateReferencedA,
        organization_id: ids.orgA,
        diet_plan_id: ids.planA,
        name: A_REFERENCED,
        calories: 500,
      },
      {
        ...TEMPLATE_BASE,
        id: ids.templateB,
        organization_id: ids.orgB,
        diet_plan_id: ids.planB,
        name: B_SHAKE,
      },
    ]);

    const logs = dataSource.getRepository(NutritionLog);
    await logs.save({
      id: ids.logReferencingA,
      organization_id: ids.orgA,
      member_id: randomUUID(),
      assignment_id: null,
      meal_template_id: ids.templateReferencedA,
      meal_description: null,
      log_date: '2026-10-15',
      servings: 2,
      logged_at: new Date('2026-10-15T08:00:00.000Z'),
      calories: 1000,
      protein_g: '60.00',
      carbs_g: '20.00',
      fat_g: '10.00',
    });

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
    await dataSource
      .getRepository(MealTemplate)
      .delete({ organization_id: orgFilter });
    await dataSource
      .getRepository(DietPlan)
      .delete({ organization_id: orgFilter });
    await dataSource.destroy();
  }, 30000);

  // --- reads ---------------------------------------------------------------
  it('lists only the caller organization’s templates', async () => {
    const list = await service.findAllMealTemplates();
    const idList = list.map((t) => t.id);

    expect(idList).toEqual(
      expect.arrayContaining([
        ids.templateA,
        ids.templateA2,
        ids.templateReferencedA,
      ]),
    );
    // Org B's template must never appear, whatever the ordering.
    expect(idList).not.toContain(ids.templateB);
    expect(list.map((t) => t.name)).not.toContain(B_SHAKE);
  });

  it('filters by dietPlanId inside the organization only', async () => {
    const planOne = await service.findAllMealTemplates(ids.planA);
    expect(planOne.map((t) => t.name).sort()).toEqual(
      [A_SHAKE, A_OATS, A_REFERENCED].sort(),
    );

    // A foreign plan id is a filter that matches nothing (D4): 200/[] rather
    // than a 404 that would confirm the plan exists elsewhere.
    await expect(service.findAllMealTemplates(ids.planB)).resolves.toEqual([]);
    await expect(
      service.findAllMealTemplates(randomUUID()),
    ).resolves.toEqual([]);
  });

  it('reads a template in the caller org and 404s one outside it', async () => {
    const own = await service.findMealTemplateById(ids.templateA);
    expect(own).toMatchObject({
      id: ids.templateA,
      organization_id: ids.orgA,
      name: A_SHAKE,
    });

    await expect(
      service.findMealTemplateById(ids.templateB),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  // --- create --------------------------------------------------------------
  it('creates a template in the authorized org even when the caller states another one', async () => {
    const created = await service.createMealTemplate({
      dietPlanId: ids.planA,
      name: 'ORG-A-NEW-SHAKE',
      mealType: MealType.BREAKFAST,
      calories: 400,
      proteinG: '20.00',
      carbsG: '30.00',
      fatG: '10.00',
      servingSize: '1.00',
      // A body that bypassed ValidationPipe still cannot pick its tenant.
      organization_id: ids.orgB,
    } as never);

    expect(created.organization_id).toBe(ids.orgA);
    const reread = await dataSource
      .getRepository(MealTemplate)
      .findOneByOrFail({ id: created.id });
    expect(reread.organization_id).toBe(ids.orgA);
    expect(reread.name).toBe('ORG-A-NEW-SHAKE');

    await dataSource.getRepository(MealTemplate).delete({ id: created.id });
  });

  it('rejects creating a template against a plan from another organization', async () => {
    const before = await dataSource
      .getRepository(MealTemplate)
      .count({ where: { organization_id: ids.orgA } });

    await expect(
      service.createMealTemplate({
        dietPlanId: ids.planB,
        name: 'ORG-A-CROSS-PLAN',
        mealType: MealType.LUNCH,
        calories: 100,
        proteinG: '1.00',
        carbsG: '1.00',
        fatG: '1.00',
        servingSize: '1.00',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);

    const after = await dataSource
      .getRepository(MealTemplate)
      .count({ where: { organization_id: ids.orgA } });
    expect(after).toBe(before);
    const leaked = await dataSource
      .getRepository(MealTemplate)
      .findOne({ where: { name: 'ORG-A-CROSS-PLAN' } });
    expect(leaked).toBeNull();
  });

  // --- update --------------------------------------------------------------
  it('updates only the supplied fields of the caller’s own template', async () => {
    const updated = await service.updateMealTemplate(ids.templateA, {
      name: 'ORG-A-SHAKE-RENAMED',
      calories: 275,
    });

    expect(updated).toMatchObject({
      id: ids.templateA,
      organization_id: ids.orgA,
      name: 'ORG-A-SHAKE-RENAMED',
      calories: 275,
      protein_g: '30.00',
    });

    const reread = await dataSource
      .getRepository(MealTemplate)
      .findOneByOrFail({ id: ids.templateA });
    expect(reread.name).toBe('ORG-A-SHAKE-RENAMED');

    await dataSource
      .getRepository(MealTemplate)
      .update({ id: ids.templateA }, { name: A_SHAKE, calories: 250 });
  });

  it('moves a template to another plan of the SAME organization (D3) and back', async () => {
    const moved = await service.updateMealTemplate(ids.templateA, {
      dietPlanId: ids.planA2,
    });
    expect(moved.diet_plan_id).toBe(ids.planA2);

    const inPlanTwo = await service.findAllMealTemplates(ids.planA2);
    expect(inPlanTwo.map((t) => t.id)).toContain(ids.templateA);
    const inPlanOne = await service.findAllMealTemplates(ids.planA);
    expect(inPlanOne.map((t) => t.id)).not.toContain(ids.templateA);

    await service.updateMealTemplate(ids.templateA, { dietPlanId: ids.planA });
  });

  it('refuses a move to a plan in another organization and leaves the row untouched', async () => {
    const repo = dataSource.getRepository(MealTemplate);
    const before = await repo.findOneByOrFail({ id: ids.templateA });

    await expect(
      service.updateMealTemplate(ids.templateA, { dietPlanId: ids.planB }),
    ).rejects.toBeInstanceOf(NotFoundException);

    const after = await repo.findOneByOrFail({ id: ids.templateA });
    // Byte-identical, not merely "not obviously changed".
    expect(after).toEqual(before);
    expect(after.diet_plan_id).toBe(ids.planA);
  });

  it('404s a PATCH of another organization’s template and changes nothing', async () => {
    const repo = dataSource.getRepository(MealTemplate);
    const before = await repo.findOneByOrFail({ id: ids.templateB });

    await expect(
      service.updateMealTemplate(ids.templateB, { name: 'Hijacked by A' }),
    ).rejects.toBeInstanceOf(NotFoundException);

    const after = await repo.findOneByOrFail({ id: ids.templateB });
    expect(after).toEqual(before);
    expect(after.name).toBe(B_SHAKE);
  });

  it('a PATCH body carrying organization_id / diet_plan_id / unknown keys cannot re-home the row', async () => {
    const repo = dataSource.getRepository(MealTemplate);
    const body = {
      name: 'ORG-A-PIPE-NAME',
      organization_id: ids.orgB,
      diet_plan_id: ids.planB,
      calories: 999,
      made_up_field: 'x',
    };

    // The DTO setup itself: with the same pipe config as `src/main.ts`
    // (`whitelist: true`), only declared, valid fields survive.
    const piped = await new ValidationPipe({
      whitelist: true,
      transform: true,
    }).transform(body, { type: 'body', metatype: UpdateMealTemplateDto });
    expect(Object.keys(piped).sort()).toEqual(['calories', 'name']);

    await service.updateMealTemplate(ids.templateA, piped);
    const reread = await repo.findOneByOrFail({ id: ids.templateA });
    expect(reread.organization_id).toBe(ids.orgA);
    expect(reread.diet_plan_id).toBe(ids.planA);
    expect(reread.name).toBe('ORG-A-PIPE-NAME');

    // Even a body that bypasses the pipe (a raw object) cannot re-home it.
    await service.updateMealTemplate(ids.templateA, body as never);
    const raw = await repo.findOneByOrFail({ id: ids.templateA });
    expect(raw.organization_id).toBe(ids.orgA);
    expect(raw.diet_plan_id).toBe(ids.planA);

    await repo.update({ id: ids.templateA }, { name: A_SHAKE, calories: 250 });
  });

  // --- delete --------------------------------------------------------------
  it('409s deleting a referenced template and leaves both the template and the log snapshot intact', async () => {
    const templates = dataSource.getRepository(MealTemplate);
    const logs = dataSource.getRepository(NutritionLog);
    const templateBefore = await templates.findOneByOrFail({
      id: ids.templateReferencedA,
    });
    const logBefore = await logs.findOneByOrFail({ id: ids.logReferencingA });

    await expect(
      service.deleteMealTemplate(ids.templateReferencedA),
    ).rejects.toBeInstanceOf(ConflictException);

    const templateAfter = await templates.findOneByOrFail({
      id: ids.templateReferencedA,
    });
    const logAfter = await logs.findOneByOrFail({ id: ids.logReferencingA });
    expect(templateAfter).toEqual(templateBefore);
    expect(logAfter).toEqual(logBefore);
    // The FK is ON DELETE SET NULL, so an unguarded delete would have blanked
    // these two columns instead of failing: the guard is what preserves them.
    expect(logAfter.meal_template_id).toBe(ids.templateReferencedA);
    expect(logAfter.calories).toBe(1000);
  });

  it('deletes an unreferenced template scoped to the organization, then 404s on a second delete', async () => {
    const repo = dataSource.getRepository(MealTemplate);
    const created = await service.createMealTemplate({
      dietPlanId: ids.planA,
      name: 'ORG-A-DELETABLE',
      mealType: MealType.DINNER,
      calories: 600,
      proteinG: '40.00',
      carbsG: '50.00',
      fatG: '20.00',
      servingSize: '1.00',
    });

    await expect(
      service.deleteMealTemplate(created.id),
    ).resolves.toBeUndefined();

    expect(await repo.findOne({ where: { id: created.id } })).toBeNull();
    // The second call is no longer a success path: the row is gone.
    await expect(
      service.deleteMealTemplate(created.id),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('404s deleting another organization’s template and leaves the row in place', async () => {
    const repo = dataSource.getRepository(MealTemplate);
    const before = await repo.findOneByOrFail({ id: ids.templateB });

    await expect(
      service.deleteMealTemplate(ids.templateB),
    ).rejects.toBeInstanceOf(NotFoundException);

    const after = await repo.findOneByOrFail({ id: ids.templateB });
    expect(after).toEqual(before);
    expect(after.organization_id).toBe(ids.orgB);
  });

  it('answers 404 — not 409 — for a referenced template outside the caller’s organization', async () => {
    // Org scoping runs first: org B cannot even learn that org A's template is
    // referenced, and the row survives untouched.
    currentOrg = ids.orgB;

    await expect(
      service.deleteMealTemplate(ids.templateReferencedA),
    ).rejects.toBeInstanceOf(NotFoundException);

    currentOrg = ids.orgA;
    const still = await dataSource
      .getRepository(MealTemplate)
      .findOne({ where: { id: ids.templateReferencedA } });
    expect(still).not.toBeNull();
  });

  it('keeps an existing nutrition-log macro snapshot intact across a template edit (Q10)', async () => {
    const logs = dataSource.getRepository(NutritionLog);
    const logBefore = await logs.findOneByOrFail({ id: ids.logReferencingA });

    await service.updateMealTemplate(ids.templateReferencedA, {
      calories: 999,
    });

    const logAfter = await logs.findOneByOrFail({ id: ids.logReferencingA });
    expect(logAfter).toEqual(logBefore);
    expect(logAfter.calories).toBe(1000);

    // ...while the template itself did change.
    const templateAfter = await dataSource
      .getRepository(MealTemplate)
      .findOneByOrFail({ id: ids.templateReferencedA });
    expect(templateAfter.calories).toBe(999);

    await service.updateMealTemplate(ids.templateReferencedA, {
      calories: 500,
    });
  });

  // --- explicit null on a NOT NULL column (F1) ------------------------------
  describe('explicit null on a NOT NULL column (F1)', () => {
    const pipe = new ValidationPipe({ whitelist: true, transform: true });
    const patchMeta = { type: 'body' as const, metatype: UpdateMealTemplateDto };

    it('rejects null for every NOT NULL column at the pipe AND at the service', async () => {
      const repo = dataSource.getRepository(MealTemplate);
      const before = await repo.findOneByOrFail({ id: ids.templateA });

      for (const field of [
        'dietPlanId',
        'name',
        'mealType',
        'calories',
        'proteinG',
        'carbsG',
        'fatG',
        'servingSize',
      ]) {
        // HTTP path: the production pipe config answers 400 before the handler.
        await expect(
          pipe.transform({ [field]: null }, patchMeta),
        ).rejects.toBeInstanceOf(BadRequestException);
        // Direct service path (no pipe in front): the single write path refuses
        // it too, so no caller can reach the column with `null`.
        await expect(
          service.updateMealTemplate(ids.templateA, { [field]: null } as never),
        ).rejects.toBeInstanceOf(BadRequestException);
      }

      // Nothing reached the table: not one column, plan id included.
      expect(await repo.findOneByOrFail({ id: ids.templateA })).toEqual(before);
    });

    it('MEASURED: the value the guard refuses is a real PostgreSQL 23502', async () => {
      // Not cosmetic: the exact statement the service used to emit fails on the
      // live NOT NULL column, which is the 500 the 400 now replaces.
      await expect(
        dataSource
          .getRepository(MealTemplate)
          .update({ id: ids.templateA }, { calories: null as never }),
      ).rejects.toMatchObject({ code: '23502' });

      const after = await dataSource
        .getRepository(MealTemplate)
        .findOneByOrFail({ id: ids.templateA });
      expect(after.calories).toBe(250);
    });

    it('still clears the nullable description with null', async () => {
      const repo = dataSource.getRepository(MealTemplate);
      await repo.update({ id: ids.templateA }, { description: 'to be cleared' });
      expect(
        (await repo.findOneByOrFail({ id: ids.templateA })).description,
      ).toBe('to be cleared');

      await service.updateMealTemplate(ids.templateA, { description: null });

      expect(
        (await repo.findOneByOrFail({ id: ids.templateA })).description,
      ).toBeNull();
    });

    it('answers an empty PATCH with the row instead of a 500 on an empty UPDATE', async () => {
      const result = await service.updateMealTemplate(ids.templateA, {});
      expect(result).toMatchObject({ id: ids.templateA, name: A_SHAKE });
    });
  });

  // --- update scoping (F5) --------------------------------------------------
  describe('update scoping (F5)', () => {
    it('the org-scoped UPDATE predicate itself matches nothing across tenants', async () => {
      // The pre-read already 404s for a foreign row; this measures the WRITE
      // predicate, which is what keeps the UPDATE inside the organization if the
      // row is deleted or re-homed between the read and the write.
      const scoped = await dataSource.getRepository(MealTemplate).update(
        { id: ids.templateB, organization_id: ids.orgA },
        { name: 'ORG-A-CROSS-ORG-UPDATE' },
      );
      expect(scoped.affected).toBe(0);

      const foreign = await dataSource
        .getRepository(MealTemplate)
        .findOneByOrFail({ id: ids.templateB });
      expect(foreign.name).toBe(B_SHAKE);
    });
  });

  // --- delete vs a concurrent referencing insert (F2) -----------------------
  describe('delete vs a concurrent referencing insert (F2)', () => {
    async function seedRaceTemplate(name: string): Promise<string> {
      const id = randomUUID();
      await dataSource.getRepository(MealTemplate).save({
        ...TEMPLATE_BASE,
        id,
        organization_id: ids.orgA,
        diet_plan_id: ids.planA,
        name,
      });
      return id;
    }

    /** The row `DietService.logMeal` writes for a templated meal. */
    function logRow(templateId: string) {
      return {
        organization_id: ids.orgA,
        member_id: randomUUID(),
        assignment_id: null,
        meal_template_id: templateId,
        meal_description: null,
        log_date: '2026-10-16',
        servings: 1,
        logged_at: new Date('2026-10-16T08:00:00.000Z'),
        calories: 250,
        protein_g: '30.00',
        carbs_g: '10.00',
        fat_g: '5.00',
      };
    }

    it('makes the delete WAIT for an in-flight insert, then 409s with the log intact', async () => {
      const templateId = await seedRaceTemplate('ORG-A-RACE-LOCK');

      // An INSERT that names the template takes PostgreSQL's `FOR KEY SHARE`
      // lock on that row and keeps it until the transaction ends.
      const inserter = dataSource.createQueryRunner();
      await inserter.connect();
      await inserter.startTransaction();
      await inserter.manager
        .getRepository(NutritionLog)
        .save(logRow(templateId));

      // The delete must block on its own `FOR UPDATE` rather than counting 0
      // and deleting underneath the uncommitted log.
      const deletion = service.deleteMealTemplate(templateId).then(
        () => 'settled' as const,
        (error: unknown) => error,
      );
      const raced = await Promise.race([
        deletion,
        new Promise<'pending'>((resolve) =>
          setTimeout(() => resolve('pending'), 400),
        ),
      ]);
      expect(raced).toBe('pending');

      await inserter.commitTransaction();
      await inserter.release();

      // Once the insert is visible the guard sees it and refuses.
      await expect(deletion).resolves.toBeInstanceOf(ConflictException);

      const logs = await dataSource
        .getRepository(NutritionLog)
        .find({ where: { meal_template_id: templateId } });
      expect(logs).toHaveLength(1);
      // Provenance NOT stripped — `ON DELETE SET NULL` would have done that
      // silently and left a row with neither a template nor a description.
      expect(logs[0].meal_template_id).toBe(templateId);
      // ...and the template itself survived.
      expect(
        await dataSource
          .getRepository(MealTemplate)
          .findOne({ where: { id: templateId } }),
      ).not.toBeNull();
    }, 30000);

    it('refuses an INSERT naming a deleted template (23503) instead of nulling the reference', async () => {
      const templateId = await seedRaceTemplate('ORG-A-RACE-AFTER-DELETE');

      await expect(
        service.deleteMealTemplate(templateId),
      ).resolves.toBeUndefined();

      const runner = dataSource.createQueryRunner();
      await runner.connect();
      await runner.startTransaction();
      let failure: { code?: string; constraint?: string } | null = null;
      try {
        await runner.manager.getRepository(NutritionLog).save(logRow(templateId));
      } catch (error) {
        failure = error as { code?: string; constraint?: string };
      } finally {
        await runner.rollbackTransaction();
        await runner.release();
      }

      // The insert cannot succeed and cannot downgrade itself into a free-text
      // row: a templated snapshot with no template is unreachable.
      expect(failure?.code).toBe('23503');
      expect(
        await dataSource
          .getRepository(NutritionLog)
          .count({ where: { meal_template_id: templateId } }),
      ).toBe(0);
    }, 30000);
  });
});
