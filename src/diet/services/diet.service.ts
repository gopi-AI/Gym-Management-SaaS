import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { DietPlan } from '../entities/diet-plan.entity';
import { MealTemplate } from '../entities/meal-template.entity';
import { DietPlanAssignment } from '../entities/diet-plan-assignment.entity';
import { NutritionLog } from '../entities/nutrition-log.entity';
import { CreateDietPlanDto } from '../dto/create-diet-plan.dto';
import { CreateMealTemplateDto } from '../dto/create-meal-template.dto';
import { AssignPlanInput } from '../dto/assign-plan.input';
import { LogMealInput } from '../dto/log-meal.input';
import { TenantContextService } from '../../shared/tenant/tenant-context.service';
import { OutboxService } from '../../shared/outbox/outbox.service';
import { AssignmentStatus } from '../entities/assignment-status.enum';

/**
 * Single-write-path service for the Diet/Nutrition domain.
 *
 * All write operations (diet plan CRUD, meal template CRUD, plan assignments,
 * meal logging) flow through THIS service. No repository is exported from the
 * module — only `DietService` is. This guarantees identical validation,
 * org-scoping, transaction safety, and outbox event emission regardless of
 * caller (API controller, test harness, or future consumer).
 *
 * Core invariants this service enforces:
 *   1. Org-scoping — every read and write is isolated to the caller's org.
 *   2. Q8 — Multiple active diet plans allowed for the same member, but the
 *      SAME plan cannot be double-assigned (belt-and-suspenders).
 *   3. Q9 — Free-text meal logging: when `meal_template_id` is null,
 *      `meal_description` holds the free-text entry.
 *   4. Q10 — Templated meals: macros are computed as `template_value × servings`
 *      at log time and SNAPSHOTTED onto the row (immutable).
 *   5. Aggregation: null macros ARE EXCLUDED from totals, never treated as zero.
 */
@Injectable()
export class DietService {
  constructor(
    @InjectRepository(DietPlan)
    private readonly dietPlanRepository: Repository<DietPlan>,
    @InjectRepository(MealTemplate)
    private readonly mealTemplateRepository: Repository<MealTemplate>,
    @InjectRepository(DietPlanAssignment)
    private readonly assignmentRepository: Repository<DietPlanAssignment>,
    @InjectRepository(NutritionLog)
    private readonly nutritionLogRepository: Repository<NutritionLog>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly tenantContextService: TenantContextService,
    private readonly outboxService: OutboxService,
  ) {}

  private async getOrganizationId(): Promise<string> {
    const currentOrgId =
      await this.tenantContextService.getCurrentOrganizationId();
    if (currentOrgId) {
      return currentOrgId;
    }
    const requestedOrgId =
      await this.tenantContextService.getRequestedOrganizationId();
    if (!requestedOrgId) {
      throw new NotFoundException('Organization context not found');
    }
    return this.tenantContextService.requireOrganizationAccess(requestedOrgId);
  }

  // ---------------------------------------------------------------------------
  // DietPlan CRUD
  // ---------------------------------------------------------------------------

  async createDietPlan(dto: CreateDietPlanDto): Promise<DietPlan> {
    const orgId = await this.getOrganizationId();
    const plan = this.dietPlanRepository.create({
      organization_id: orgId,
      name: dto.name,
      description: dto.description ?? null,
      total_calories_per_day: dto.total_calories_per_day ?? null,
      is_active: dto.is_active ?? true,
    });
    return this.dietPlanRepository.save(plan);
  }

  async findAllDietPlans(): Promise<DietPlan[]> {
    const orgId = await this.getOrganizationId();
    return this.dietPlanRepository.find({
      where: { organization_id: orgId },
      order: { name: 'ASC' },
    });
  }

  async findDietPlanById(id: string): Promise<DietPlan> {
    const orgId = await this.getOrganizationId();
    const plan = await this.dietPlanRepository.findOne({
      where: { id, organization_id: orgId },
    });
    if (!plan) {
      throw new NotFoundException('DietPlan not found');
    }
    return plan;
  }

  // ---------------------------------------------------------------------------
  // MealTemplate CRUD
  // ---------------------------------------------------------------------------

  async createMealTemplate(dto: CreateMealTemplateDto): Promise<MealTemplate> {
    const orgId = await this.getOrganizationId();

    // Validate the referenced DietPlan exists and belongs to this org
    const plan = await this.dietPlanRepository.findOne({
      where: { id: dto.dietPlanId, organization_id: orgId },
    });
    if (!plan) {
      throw new NotFoundException(
        `DietPlan "${dto.dietPlanId}" not found in organization`,
      );
    }

    const template = this.mealTemplateRepository.create({
      organization_id: orgId,
      diet_plan_id: dto.dietPlanId,
      name: dto.name,
      meal_type: dto.mealType,
      description: dto.description ?? null,
      calories: dto.calories,
      protein_g: dto.proteinG,
      carbs_g: dto.carbsG,
      fat_g: dto.fatG,
      serving_size: dto.servingSize,
    });
    return this.mealTemplateRepository.save(template);
  }

  async findAllMealTemplates(dietPlanId?: string): Promise<MealTemplate[]> {
    const orgId = await this.getOrganizationId();
    const where: Record<string, unknown> = { organization_id: orgId };
    if (dietPlanId) {
      where.diet_plan_id = dietPlanId;
    }
    return this.mealTemplateRepository.find({
      where,
      order: { name: 'ASC' },
    });
  }

  async findMealTemplateById(id: string): Promise<MealTemplate> {
    const orgId = await this.getOrganizationId();
    const template = await this.mealTemplateRepository.findOne({
      where: { id, organization_id: orgId },
    });
    if (!template) {
      throw new NotFoundException('MealTemplate not found');
    }
    return template;
  }

  async updateMealTemplate(
    id: string,
    dto: Partial<CreateMealTemplateDto>,
  ): Promise<MealTemplate> {
    const orgId = await this.getOrganizationId();
    const template = await this.mealTemplateRepository.findOne({
      where: { id, organization_id: orgId },
    });
    if (!template) {
      throw new NotFoundException('MealTemplate not found');
    }

    if (dto.dietPlanId && dto.dietPlanId !== template.diet_plan_id) {
      // Validate new plan belongs to this org
      const plan = await this.dietPlanRepository.findOne({
        where: { id: dto.dietPlanId, organization_id: orgId },
      });
      if (!plan) {
        throw new NotFoundException(
          `DietPlan "${dto.dietPlanId}" not found in organization`,
        );
      }
    }

    const updates: Record<string, unknown> = {};
    if (dto.name !== undefined) updates.name = dto.name;
    if (dto.mealType !== undefined) updates.meal_type = dto.mealType;
    if (dto.description !== undefined) updates.description = dto.description;
    if (dto.calories !== undefined) updates.calories = dto.calories;
    if (dto.proteinG !== undefined) updates.protein_g = dto.proteinG;
    if (dto.carbsG !== undefined) updates.carbs_g = dto.carbsG;
    if (dto.fatG !== undefined) updates.fat_g = dto.fatG;
    if (dto.servingSize !== undefined) updates.serving_size = dto.servingSize;
    if (dto.dietPlanId !== undefined) updates.diet_plan_id = dto.dietPlanId;

    await this.mealTemplateRepository.update(id, updates);
    return this.mealTemplateRepository.findOne({
      where: { id, organization_id: orgId },
    }) as Promise<MealTemplate>;
  }

  // ---------------------------------------------------------------------------
  // DietPlanAssignment — assignPlan (Q8 belt-and-suspenders)
  // ---------------------------------------------------------------------------

  /**
   * Assign a diet plan to a member (single legal write path).
   *
   * Enforces, in order:
   *   1. Org-scoping — plan must exist in the caller's org.
   *   2. App-level unique constraint — no active assignment for same
   *      (member, diet_plan) pair (belt).
   *   3. DB-level partial unique index — final backstop (suspenders).
   *   4. Transactional outbox event — `DietPlanAssigned.v1`.
   */
  async assignPlan(input: AssignPlanInput): Promise<DietPlanAssignment> {
    const orgId = await this.getOrganizationId();

    return this.dataSource.transaction(async (manager) => {
      // 1. Validate the diet plan exists and belongs to this org
      const planRepo = manager.getRepository(DietPlan);
      const plan = await planRepo.findOne({
        where: { id: input.dietPlanId, organization_id: orgId },
      });
      if (!plan) {
        throw new NotFoundException(
          `DietPlan "${input.dietPlanId}" not found in organization`,
        );
      }

      // 2. App-level unique constraint check (belt)
      const assignmentRepo = manager.getRepository(DietPlanAssignment);
      const existing = await assignmentRepo.findOne({
        where: {
          member_id: input.memberId,
          diet_plan_id: input.dietPlanId,
          status: AssignmentStatus.ACTIVE,
        },
      });
      if (existing) {
        throw new ConflictException(
          `Member "${input.memberId}" already has an active assignment for diet plan "${input.dietPlanId}"`,
        );
      }

      // 3. Create the assignment
      const assignment = assignmentRepo.create({
        organization_id: orgId,
        member_id: input.memberId,
        diet_plan_id: input.dietPlanId,
        assigned_by: input.assignedBy,
        assigned_at: new Date(),
        start_date: input.startDate,
        end_date: input.endDate ?? null,
        status: AssignmentStatus.ACTIVE,
      });

      const saved = await assignmentRepo.save(assignment);

      // 4. Outbox event inside the same transaction
      await this.outboxService.saveEventEnvelope(
        'DietPlanAssigned.v1',
        '1',
        orgId,
        {
          assignmentId: saved.id,
          memberId: input.memberId,
          dietPlanId: input.dietPlanId,
          assignedBy: input.assignedBy,
          startDate: input.startDate,
          endDate: input.endDate ?? null,
        },
        input.memberId,
        undefined,
        manager,
      );

      return saved;
    });
  }

  async findAllAssignments(memberId: string): Promise<DietPlanAssignment[]> {
    const orgId = await this.getOrganizationId();
    return this.assignmentRepository.find({
      where: { organization_id: orgId, member_id: memberId },
      order: { created_at: 'DESC' },
    });
  }

  async findAssignmentById(id: string): Promise<DietPlanAssignment> {
    const orgId = await this.getOrganizationId();
    const assignment = await this.assignmentRepository.findOne({
      where: { id, organization_id: orgId },
    });
    if (!assignment) {
      throw new NotFoundException('DietPlanAssignment not found');
    }
    return assignment;
  }

  // ---------------------------------------------------------------------------
  // NutritionLog — logMeal (Q9, Q10 snapshot)
  // ---------------------------------------------------------------------------

  /**
   * Log a meal for a member (single legal write path).
   *
   * Two mutually exclusive forms:
   *   1. TEMPLATED (`mealTemplateId` set): validates the template belongs to
   *      this org, then snapshots macros as `template_value × servings`.
   *   2. FREE-TEXT (`mealTemplateId` null): stores `mealDescription` and
   *      optionally the user-supplied macro values (which may be null).
   */
  async logMeal(input: LogMealInput): Promise<NutritionLog> {
    const orgId = await this.getOrganizationId();

    return this.dataSource.transaction(async (manager) => {
      const logRepo = manager.getRepository(NutritionLog);

      if (input.mealTemplateId) {
        // TEMPLATED meal — compute macros from the template
        const templateRepo = manager.getRepository(MealTemplate);
        const template = await templateRepo.findOne({
          where: { id: input.mealTemplateId, organization_id: orgId },
        });
        if (!template) {
          throw new NotFoundException(
            `MealTemplate "${input.mealTemplateId}" not found in organization`,
          );
        }

        const log = logRepo.create({
          organization_id: orgId,
          member_id: input.memberId,
          assignment_id: input.assignmentId ?? null,
          meal_template_id: input.mealTemplateId,
          meal_description: null,
          log_date: input.logDate,
          servings: input.servings,
          logged_at: new Date(),
          calories: template.calories * input.servings,
          protein_g: (Number(template.protein_g) * input.servings).toFixed(2),
          carbs_g: (Number(template.carbs_g) * input.servings).toFixed(2),
          fat_g: (Number(template.fat_g) * input.servings).toFixed(2),
        });

        const saved = await logRepo.save(log);

        // Outbox event
        await this.outboxService.saveEventEnvelope(
          'NutritionLogRecorded.v1',
          '1',
          orgId,
          {
            logId: saved.id,
            memberId: input.memberId,
            assignmentId: input.assignmentId ?? null,
            mealTemplateId: input.mealTemplateId,
            mealDescription: null,
            logDate: input.logDate,
            calories: saved.calories ?? null,
            protein: saved.protein_g ?? null,
            carbs: saved.carbs_g ?? null,
            fat: saved.fat_g ?? null,
          },
          input.memberId,
          undefined,
          manager,
        );

        return saved;
      } else {
        // FREE-TEXT meal
        const log = logRepo.create({
          organization_id: orgId,
          member_id: input.memberId,
          assignment_id: input.assignmentId ?? null,
          meal_template_id: null,
          meal_description: input.mealDescription ?? null,
          log_date: input.logDate,
          servings: input.servings,
          logged_at: new Date(),
          calories: input.calories ?? null,
          protein_g: input.proteinG ?? null,
          carbs_g: input.carbsG ?? null,
          fat_g: input.fatG ?? null,
        });
        const saved = await logRepo.save(log);

        await this.outboxService.saveEventEnvelope(
          'NutritionLogRecorded.v1',
          '1',
          orgId,
          {
            logId: saved.id,
            memberId: input.memberId,
            assignmentId: input.assignmentId ?? null,
            mealTemplateId: null,
            mealDescription: input.mealDescription ?? null,
            logDate: input.logDate,
            calories: saved.calories ?? null,
            protein: saved.protein_g ?? null,
            carbs: saved.carbs_g ?? null,
            fat: saved.fat_g ?? null,
          },
          input.memberId,
          undefined,
          manager,
        );
        return saved;
      }
    });
  }

  async findAllLogs(memberId: string): Promise<NutritionLog[]> {
    const orgId = await this.getOrganizationId();
    return this.nutritionLogRepository.find({
      where: { organization_id: orgId, member_id: memberId },
      order: { log_date: 'DESC' },
    });
  }

  /**
   * Retrieve daily macro totals for a member.
   *
   * Null macro columns are explicitly excluded from SUM aggregation.
   * Returns totals per log_date together with a count of meals that were
   * missing macro data and an adherence percentage.
   */
  async getDailyTotals(
    memberId: string,
    startDate: string,
    endDate: string,
  ): Promise<
    Array<{
      log_date: string;
      totalCalories: number | null;
      totalProteinG: number | null;
      totalCarbsG: number | null;
      totalFatG: number | null;
      mealsMissingMacros: number;
      totalMeals: number;
      adherencePct: number;
    }>
  > {
    const orgId = await this.getOrganizationId();
    const results: Array<Record<string, unknown>> =
      await this.nutritionLogRepository.query(
        `SELECT
          nl.log_date,
          SUM(nl.calories)::numeric AS "totalCalories",
          SUM(nl.protein_g)::numeric AS "totalProteinG",
          SUM(nl.carbs_g)::numeric AS "totalCarbsG",
          SUM(nl.fat_g)::numeric AS "totalFatG",
          COUNT(*) FILTER (
            WHERE nl.calories IS NULL
              AND nl.protein_g IS NULL
              AND nl.carbs_g IS NULL
              AND nl.fat_g IS NULL
          ) AS "mealsMissingMacros",
          COUNT(*) AS "totalMeals"
        FROM nutrition_log nl
        WHERE nl.organization_id = $1
          AND nl.member_id = $2
          AND nl.log_date >= $3
          AND nl.log_date <= $4
        GROUP BY nl.log_date
        ORDER BY nl.log_date`,
        [orgId, memberId, startDate, endDate],
      );

    return results.map((row) => {
      const mealsMissingMacros = Number(row.mealsMissingMacros) || 0;
      const totalMeals = Number(row.totalMeals) || 0;
      const completeMeals = totalMeals - mealsMissingMacros;
      const adherencePct =
        totalMeals === 0
          ? 100
          : parseFloat(
              ((completeMeals / totalMeals) * 100).toFixed(2),
            );

      return {
        log_date: row.log_date as string,
        totalCalories:
          row.totalCalories !== null ? Number(row.totalCalories) : null,
        totalProteinG:
          row.totalProteinG !== null ? Number(row.totalProteinG) : null,
        totalCarbsG:
          row.totalCarbsG !== null ? Number(row.totalCarbsG) : null,
        totalFatG:
          row.totalFatG !== null ? Number(row.totalFatG) : null,
        mealsMissingMacros,
        totalMeals,
        adherencePct,
      };
    });
  }
}