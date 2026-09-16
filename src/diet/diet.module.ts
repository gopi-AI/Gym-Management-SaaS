import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TenancyModule } from '../tenancy/tenancy.module';
import { OutboxModule } from '../shared/outbox/outbox.module';
import { DietPlan } from './entities/diet-plan.entity';
import { MealTemplate } from './entities/meal-template.entity';
import { DietPlanAssignment } from './entities/diet-plan-assignment.entity';
import { NutritionLog } from './entities/nutrition-log.entity';
import { DietService } from './services/diet.service';

/**
 * Diet/Nutrition domain module (Phase 2, Module 5 of 8).
 *
 * Owns ALL diet plan, meal template, assignment, and nutrition log content.
 * Single-write-path encapsulation: only `DietService` is exported. No
 * repository is exported. The REST controller and future consumers both call
 * the same `DietService` methods, guaranteeing identical validation,
 * org-scoping, transaction safety, and outbox event emission regardless of
 * caller.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      DietPlan,
      MealTemplate,
      DietPlanAssignment,
      NutritionLog,
    ]),
    OutboxModule,
    TenancyModule,
  ],
  providers: [DietService],
  exports: [DietService],
})
export class DietModule {}