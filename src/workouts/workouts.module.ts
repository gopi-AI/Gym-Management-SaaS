import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TenancyModule } from '../tenancy/tenancy.module';
import { OutboxModule } from '../shared/outbox/outbox.module';
import { Exercise } from './entities/exercise.entity';
import { WorkoutTemplate } from './entities/workout-template.entity';
import { WorkoutTemplateExercise } from './entities/workout-template-exercise.entity';
import { WorkoutPlanAssignment } from './entities/workout-plan-assignment.entity';
import { WorkoutSession } from './entities/workout-session.entity';
import { WorkoutSessionExercise } from './entities/workout-session-exercise.entity';
import { WorkoutsService } from './services/workouts.service';

/**
 * Workouts domain module (Phase 2, Module 3 of 8).
 *
 * Owns ALL exercise/template/session/assignment content per the §11 Risk 1
 * naming-collision resolution. The PT module (built next) depends on calling
 * `WorkoutsService.assignPlan()` — this module does NOT depend on PT.
 *
 * **Single-write-path encapsulation**:
 * Only `WorkoutsService` is exported. No repository is exported. The PT module
 * and the REST API controller both call the same `WorkoutsService.assignPlan()`
 * method, guaranteeing identical validation, org-scoping, transaction safety,
 * and outbox event emission regardless of caller.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      Exercise,
      WorkoutTemplate,
      WorkoutTemplateExercise,
      WorkoutPlanAssignment,
      WorkoutSession,
      WorkoutSessionExercise,
    ]),
    OutboxModule,
    TenancyModule,
  ],
  providers: [WorkoutsService],
  exports: [WorkoutsService],
})
export class WorkoutsModule {}