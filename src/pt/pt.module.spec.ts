import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { PtModule } from './pt.module';
import { PtPackagesService } from './services/pt-packages.service';
import { PersonalTrainersService } from './services/personal-trainers.service';
import { PtEnrollmentsService } from './services/pt-enrollments.service';
import { PtSessionsService } from './services/pt-sessions.service';
import { TrainerCommissionsService } from './services/trainer-commissions.service';
import { PTPackage } from './entities/pt-package.entity';
import { PersonalTrainer } from './entities/personal-trainer.entity';
import { PTEnrollment } from './entities/pt-enrollment.entity';
import { PTSession } from './entities/pt-session.entity';
import { TrainerCommission } from './entities/trainer-commission.entity';
import { MembersModule } from '../members/members.module';
import { WorkoutsModule } from '../workouts/workouts.module';
import { MembersService } from '../members/services/members.service';
import { WorkoutsService } from '../workouts/services/workouts.service';
import { TenantContextService } from '../shared/tenant/tenant-context.service';
import { OutboxService } from '../shared/outbox/outbox.service';
import { WorkoutPlanAssignment } from '../workouts/entities/workout-plan-assignment.entity';
import { WorkoutSession } from '../workouts/entities/workout-session.entity';
import { Exercise } from '../workouts/entities/exercise.entity';

/**
 * Structural verification of the PT module boundary (Phase 2, Module 4 of 8).
 *
 * The unit specs prove behaviour; this file proves the *shape* of the module —
 * what it registers, what it exports and which cross-module dependency is a hard
 * requirement. Both are needed to keep the naming-collision resolution from
 * being quietly reintroduced.
 */
function moduleMetadata(key: string, target: object): unknown[] {
  return (Reflect.getMetadata(key, target) as unknown[]) ?? [];
}

/** Repository tokens contributed by every `TypeOrmModule.forFeature([...])`. */
function registeredRepositoryTokens(target: object): unknown[] {
  return moduleMetadata('imports', target)
    .flatMap((entry) => {
      const providers = (entry as { providers?: Array<{ provide?: unknown }> })
        ?.providers;
      return Array.isArray(providers) ? providers : [];
    })
    .map((provider) => provider.provide)
    .filter((token) => token !== undefined);
}

describe('PtModule', () => {
  describe('single-write-path encapsulation', () => {
    it('exports ONLY the five domain services — no repository, no TypeOrmModule', () => {
      expect(moduleMetadata('exports', PtModule)).toEqual([
        PtPackagesService,
        PersonalTrainersService,
        PtEnrollmentsService,
        PtSessionsService,
        TrainerCommissionsService,
      ]);
    });

    it('provides exactly the five services', () => {
      expect(moduleMetadata('providers', PtModule)).toEqual([
        PtPackagesService,
        PersonalTrainersService,
        PtEnrollmentsService,
        PtSessionsService,
        TrainerCommissionsService,
      ]);
    });

    it('does not export any of its own repository tokens', () => {
      const exported = moduleMetadata('exports', PtModule);
      const tokens = registeredRepositoryTokens(PtModule);

      expect(tokens.length).toBeGreaterThan(0);
      for (const token of tokens) {
        expect(exported).not.toContain(token);
      }
    });
  });

  describe('naming-collision resolution: PT owns no workout/assignment tables', () => {
    it('registers only its own five entities', () => {
      expect(registeredRepositoryTokens(PtModule)).toEqual([
        getRepositoryToken(PTPackage),
        getRepositoryToken(PersonalTrainer),
        getRepositoryToken(PTEnrollment),
        getRepositoryToken(PTSession),
        getRepositoryToken(TrainerCommission),
      ]);
    });

    it('does NOT register a WorkoutPlanAssignment (or any Workouts) repository', () => {
      const tokens = registeredRepositoryTokens(PtModule);

      expect(tokens).not.toContain(getRepositoryToken(WorkoutPlanAssignment));
      expect(tokens).not.toContain(getRepositoryToken(WorkoutSession));
      expect(tokens).not.toContain(getRepositoryToken(Exercise));
    });

    it('imports WorkoutsModule for assignPlan(), plus MembersModule for member validation', () => {
      const imports = moduleMetadata('imports', PtModule);

      expect(imports).toContain(WorkoutsModule);
      expect(imports).toContain(MembersModule);
    });
  });

  describe('workout plan assignment is a hard, injected dependency', () => {
    const baseProviders = [
      PtEnrollmentsService,
      { provide: getRepositoryToken(PTEnrollment), useValue: {} },
      { provide: getRepositoryToken(PTPackage), useValue: {} },
      { provide: getRepositoryToken(PersonalTrainer), useValue: {} },
      { provide: getDataSourceToken(), useValue: {} },
      { provide: TenantContextService, useValue: {} },
      { provide: OutboxService, useValue: {} },
      { provide: MembersService, useValue: {} },
    ];

    it('cannot be constructed without WorkoutsService', async () => {
      await expect(
        Test.createTestingModule({ providers: [...baseProviders] }).compile(),
      ).rejects.toThrow(/WorkoutsService/);
    });

    it('constructs once WorkoutsService is provided', async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          ...baseProviders,
          { provide: WorkoutsService, useValue: { assignPlan: jest.fn() } },
        ],
      }).compile();

      expect(module.get(PtEnrollmentsService)).toBeDefined();
    });
  });
});