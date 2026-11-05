import { WorkoutsModule } from './workouts.module';
import { WorkoutsTabController } from './controllers/workouts-tab.controller';
import { ExercisesController } from './controllers/exercises.controller';
import { WorkoutDayTemplatesController } from './controllers/workout-day-templates.controller';
import { WorkoutPlanTemplatesController } from './controllers/workout-plan-templates.controller';
import { WorkoutAssignmentsController } from './controllers/workout-assignments.controller';
import { PrescribedDaysController } from './controllers/prescribed-days.controller';
import { WorkoutSessionsController } from './controllers/workout-sessions.controller';
import { WorkoutProgressReviewsController } from './controllers/workout-progress-reviews.controller';
import { WorkoutsService } from './services/workouts.service';
import { WorkoutsTenantService } from './services/workouts-tenant.service';
import { ExerciseLibraryService } from './services/exercise-library.service';
import { WorkoutTemplatesService } from './services/workout-templates.service';
import { WorkoutAssignmentsService } from './services/workout-assignments.service';
import { WorkoutSessionsService } from './services/workout-sessions.service';
import { WorkoutReviewsService } from './services/workout-reviews.service';

function moduleMetadata(key: string, target: object): unknown[] {
  return (Reflect.getMetadata(key, target) as unknown[]) ?? [];
}

describe('WorkoutsModule', () => {
  it('registers every P2-05 controller', () => {
    expect(moduleMetadata('controllers', WorkoutsModule)).toEqual([
      WorkoutsTabController,
      ExercisesController,
      WorkoutDayTemplatesController,
      WorkoutPlanTemplatesController,
      WorkoutAssignmentsController,
      PrescribedDaysController,
      WorkoutSessionsController,
      WorkoutProgressReviewsController,
    ]);
  });

  it('registers the focused services plus the PT-facing facade', () => {
    expect(moduleMetadata('providers', WorkoutsModule)).toEqual([
      WorkoutsTenantService,
      ExerciseLibraryService,
      WorkoutTemplatesService,
      WorkoutAssignmentsService,
      WorkoutSessionsService,
      WorkoutReviewsService,
      WorkoutsService,
    ]);
  });

  it('exports only WorkoutsService — no repository and no TypeOrmModule', () => {
    expect(moduleMetadata('exports', WorkoutsModule)).toEqual([WorkoutsService]);
  });
});
