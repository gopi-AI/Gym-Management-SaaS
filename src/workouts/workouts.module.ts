import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TenancyModule } from '../tenancy/tenancy.module';
import { OutboxModule } from '../shared/outbox/outbox.module';
import { S3Module } from '../shared/storage/s3.module';
import { Member } from '../members/entities/member.entity';
import { MeasurementLog } from '../members/entities/measurement-log.entity';
import { AttendanceRecord } from '../attendance/entities/attendance-record.entity';
import { Exercise } from './entities/exercise.entity';
import { WorkoutTemplate } from './entities/workout-template.entity';
import { WorkoutTemplateExercise } from './entities/workout-template-exercise.entity';
import { WorkoutPlanAssignment } from './entities/workout-plan-assignment.entity';
import { WorkoutSession } from './entities/workout-session.entity';
import { WorkoutSessionExercise } from './entities/workout-session-exercise.entity';
import { WorkoutDayTemplate } from './entities/workout-day-template.entity';
import { WorkoutDayTemplateExercise } from './entities/workout-day-template-exercise.entity';
import { WorkoutPlanTemplate } from './entities/workout-plan-template.entity';
import { WorkoutPlanTemplateDay } from './entities/workout-plan-template-day.entity';
import { PrescribedWorkoutDay } from './entities/prescribed-workout-day.entity';
import { PrescribedWorkoutDayExercise } from './entities/prescribed-workout-day-exercise.entity';
import { PlanDaySubmission } from './entities/plan-day-submission.entity';
import { PlanDaySubmissionExercise } from './entities/plan-day-submission-exercise.entity';
import { PlanDayReview } from './entities/plan-day-review.entity';
import { WorkoutProgressReview } from './entities/workout-progress-review.entity';
import { ProgressReviewMeasurement } from './entities/progress-review-measurement.entity';
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

/**
 * Workouts domain module.
 *
 * Owns ALL exercise/template/session/assignment content per the §11 Risk 1
 * naming-collision resolution. The PT module depends on calling
 * `WorkoutsService.assignPlan()` — this module does NOT depend on PT.
 *
 * **Single-write-path encapsulation**:
 * Only `WorkoutsService` is exported. No repository is exported. The PT module
 * and the REST API controller both call the same exported assignment method,
 * guaranteeing identical validation, org-scoping, transaction safety, and
 * outbox event emission regardless of caller.
 *
 * The module reads three foreign tables directly, each read-only:
 *   - `MEMBERS_MEMBERS` — prove the route member belongs to the authorized org
 *     (importing `MembersModule` would close a cycle: Members → Workouts);
 *   - `MEMBERS_MEMBER_MEASUREMENTS` — validate and snapshot the measurements a
 *     progress review reuses (no second measurement source of truth);
 *   - `ATTENDANCE_ATTENDANCE_RECORDS` — snapshot the real attendance summary
 *     (importing `AttendanceModule` would close Memberships/Finance/Members
 *     cycle). Trainers never write attendance.
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
      WorkoutDayTemplate,
      WorkoutDayTemplateExercise,
      WorkoutPlanTemplate,
      WorkoutPlanTemplateDay,
      PrescribedWorkoutDay,
      PrescribedWorkoutDayExercise,
      PlanDaySubmission,
      PlanDaySubmissionExercise,
      PlanDayReview,
      WorkoutProgressReview,
      ProgressReviewMeasurement,
      Member,
      MeasurementLog,
      AttendanceRecord,
    ]),
    OutboxModule,
    TenancyModule,
    S3Module,
  ],
  controllers: [
    WorkoutsTabController,
    ExercisesController,
    WorkoutDayTemplatesController,
    WorkoutPlanTemplatesController,
    WorkoutAssignmentsController,
    PrescribedDaysController,
    WorkoutSessionsController,
    WorkoutProgressReviewsController,
  ],
  providers: [
    WorkoutsTenantService,
    ExerciseLibraryService,
    WorkoutTemplatesService,
    WorkoutAssignmentsService,
    WorkoutSessionsService,
    WorkoutReviewsService,
    WorkoutsService,
  ],
  exports: [WorkoutsService],
})
export class WorkoutsModule {}
