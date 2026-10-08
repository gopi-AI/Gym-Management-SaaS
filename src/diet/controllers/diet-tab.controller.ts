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