import {
  Controller,
  Get,
  Param,
  Query,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { RequirePermissions } from '../../shared/auth/permissions.guard';
import { DietService } from '../services/diet.service';
import { DietPlan } from '../entities/diet-plan.entity';
import { DietPlanAssignment } from '../entities/diet-plan-assignment.entity';
import { NutritionLog } from '../entities/nutrition-log.entity';
import { IsISO8601, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Query DTO for the diet tab's date window.
 *
 * Declared ABOVE `DietTabController` deliberately. `emitDecoratorMetadata` is on
 * (`tsconfig.json:17`), so TypeScript emits a `design:paramtypes` entry for
 * `getDiet` that references this class, and that array is evaluated at
 * module-load time inside the controller's `__decorate` call. A `class` binding
 * sits in its temporal dead zone until its own declaration executes, so
 * declaring this *below* the controller threw
 * `ReferenceError: Cannot access 'ListDietTabQuery' before initialization` on
 * import — which took down every suite that transitively imports this module,
 * with `Tests: 0 total`. It is a declaration-order bug, not an import cycle:
 * `diet.module.ts` is the only importer of this file.
 */
class ListDietTabQuery {
  @IsISO8601()
  @Type(() => String)
  @IsOptional()
  startDate?: string;

  @IsISO8601()
  @Type(() => String)
  @IsOptional()
  endDate?: string;
}

/**
 * Diet tab API (Phase 2, P2-06).
 *
 * Route layer only — wires the already-complete `DietService` read methods to
 * HTTP. The domain entities and read logic were implemented in Phase 2; this
 * controller adds no new queries or writes.
 *
 * Response:
 *   - `dietPlans`: diet plan assignments for the member (P2-06)
 *   - `nutritionLogs`: nutrition log entries (P2-06)
 *   - `dailyTotals`: per-day macro totals with adherence (P2-06)
 */
@Controller('v1/members/:memberId/diet')
export class DietTabController {
  constructor(private readonly dietService: DietService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @RequirePermissions({ resource: 'diet', action: 'plan-read' })
  async getDiet(
    @Param('memberId', new ParseUUIDPipe({ version: '4' })) memberId: string,
    @Query() query: ListDietTabQuery,
  ): Promise<{
    dietPlans: DietPlanAssignment[];
    nutritionLogs: NutritionLog[];
    dailyTotals: Array<{
      log_date: string;
      totalCalories: number | null;
      totalProteinG: number | null;
      totalCarbsG: number | null;
      totalFatG: number | null;
      mealsMissingMacros: number;
      totalMeals: number;
      adherencePct: number;
    }>;
  }> {
    const start = query.startDate
      ? new Date(query.startDate)
      : new Date();
    start.setDate(start.getDate() - 30);
    const end = query.endDate ? new Date(query.endDate) : new Date();

    return {
      dietPlans: await this.dietService.findAllAssignments(memberId),
      nutritionLogs: await this.dietService.findAllLogs(memberId),
      dailyTotals: await this.dietService.getDailyTotals(
        memberId,
        start.toISOString().slice(0, 10),
        end.toISOString().slice(0, 10),
      ),
    };
  }
}