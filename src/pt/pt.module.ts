import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TenancyModule } from '../tenancy/tenancy.module';
import { OutboxModule } from '../shared/outbox/outbox.module';
import { MembersModule } from '../members/members.module';
import { WorkoutsModule } from '../workouts/workouts.module';
import { PTPackage } from './entities/pt-package.entity';
import { PersonalTrainer } from './entities/personal-trainer.entity';
import { PTEnrollment } from './entities/pt-enrollment.entity';
import { PTSession } from './entities/pt-session.entity';
import { TrainerCommission } from './entities/trainer-commission.entity';
import { PtPackagesService } from './services/pt-packages.service';
import { PersonalTrainersService } from './services/personal-trainers.service';
import { PtEnrollmentsService } from './services/pt-enrollments.service';
import { PtSessionsService } from './services/pt-sessions.service';
import { TrainerCommissionsService } from './services/trainer-commissions.service';

/**
 * Personal Training domain module (Phase 2, Module 4 of 8).
 *
 * **Single-write-path encapsulation**: only the SERVICES are exported — never a
 * repository — so no other module can bypass the service-layer invariants:
 *   - `PTEnrollment.sessions_used` is only ever incremented by
 *     `PtSessionsService.completeSession()` (§12 Q1).
 *   - A `TrainerCommission` row is only ever created by
 *     `PtEnrollmentsService.create()` (§12 Q2), and its `status` never
 *     transitions in Phase 2.
 *
 * **Naming-collision resolution (one-directional)**: this module owns NO
 * exercise/template/assignment content and NO `PT_` workout tables. Workout plan
 * assignment is delegated to the exported `WorkoutsService.assignPlan()` via
 * `WorkoutsModule` — which is why `WorkoutPlanAssignment` is deliberately NOT
 * registered in `TypeOrmModule.forFeature` below: no assignment repository exists
 * inside the PT module, so a parallel assignment write path cannot be
 * reintroduced by accident.
 *
 * `MembersModule` supplies `MembersService` for org-scoped member validation
 * (§1 "Phase 1 dependencies"). PT does not depend on Attendance in any way
 * (§12 Q3), so no attendance module is imported.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      PTPackage,
      PersonalTrainer,
      PTEnrollment,
      PTSession,
      TrainerCommission,
    ]),
    OutboxModule,
    TenancyModule,
    forwardRef(() => MembersModule),
    WorkoutsModule,
  ],
  providers: [
    PtPackagesService,
    PersonalTrainersService,
    PtEnrollmentsService,
    PtSessionsService,
    TrainerCommissionsService,
  ],
  exports: [
    PtPackagesService,
    PersonalTrainersService,
    PtEnrollmentsService,
    PtSessionsService,
    TrainerCommissionsService,
  ],
})
export class PtModule {}