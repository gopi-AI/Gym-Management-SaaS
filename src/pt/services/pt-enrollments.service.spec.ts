import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken, getDataSourceToken } from '@nestjs/typeorm';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import * as fs from 'fs';
import * as path from 'path';
import { PtEnrollmentsService } from './pt-enrollments.service';
import { PTEnrollment } from '../entities/pt-enrollment.entity';
import { PTPackage } from '../entities/pt-package.entity';
import { PersonalTrainer } from '../entities/personal-trainer.entity';
import { TrainerCommission } from '../entities/trainer-commission.entity';
import { PTEnrollmentStatus } from '../entities/pt-enrollment-status.enum';
import { TrainerCommissionStatus } from '../entities/trainer-commission-status.enum';
import { TenantContextService } from '../../shared/tenant/tenant-context.service';
import { OutboxService } from '../../shared/outbox/outbox.service';
import { MembersService } from '../../members/services/members.service';
import { WorkoutsService } from '../../workouts/services/workouts.service';
import { WorkoutPlanAssignment } from '../../workouts/entities/workout-plan-assignment.entity';
import { computeCommissionAmount } from '../pt.constants';

/**
 * Recursively list the module's production TypeScript sources (spec files
 * excluded — a spec may legitimately name the symbols it forbids).
 *
 * Used by the source-level guards below: some requirements are structural rather
 * than behavioural ("no code path transitions a commission status", "PT never
 * imports attendance"), and those are best asserted against the actual files.
 */
function listTypeScriptFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return listTypeScriptFiles(full);
    }
    return entry.isFile() &&
      entry.name.endsWith('.ts') &&
      !entry.name.endsWith('.spec.ts')
      ? [full]
      : [];
  });
}

describe('PtEnrollmentsService', () => {
  let service!: PtEnrollmentsService;
  let mockEnrollmentRepo!: Record<string, jest.Mock>;
  let mockPackageRepo!: Record<string, jest.Mock>;
  let mockTrainerRepo!: Record<string, jest.Mock>;
  let mockCommissionRepo!: Record<string, jest.Mock>;
  let mockDataSource!: Record<string, jest.Mock>;
  let mockTenantContext!: Record<string, jest.Mock>;
  let mockOutbox!: Record<string, jest.Mock>;
  let mockMembersService!: Record<string, jest.Mock>;
  let mockWorkoutsService!: Record<string, jest.Mock>;

  const orgId = 'org-123';
  const otherOrgId = 'org-999';
  const memberId = 'member-uuid-1';

  const packageFixture = {
    id: 'package-1',
    organization_id: orgId,
    name: '10 Session Pack',
    session_count: 10,
    price: '500.00',
    currency: 'USD',
    commission_percent: '10.00',
    is_active: true,
  } as PTPackage;

  const trainerFixture = {
    id: 'trainer-1',
    organization_id: orgId,
    branch_id: 'branch-1',
    is_active: true,
  } as PersonalTrainer;

  const enrollmentFixture = {
    id: 'enrollment-1',
    organization_id: orgId,
    member_id: memberId,
    package_id: 'package-1',
    trainer_id: 'trainer-1',
    commission_percent: null,
    start_date: '2026-09-01',
    end_date: null,
    sessions_used: 0,
    session_count: 10,
    status: PTEnrollmentStatus.ACTIVE,
  } as PTEnrollment;

  beforeEach(async () => {
    mockEnrollmentRepo = {
      create: jest.fn().mockImplementation((dto) => ({ id: 'enrollment-1', ...dto })),
      save: jest.fn().mockImplementation((e) => Promise.resolve(e)),
      find: jest.fn().mockResolvedValue([enrollmentFixture]),
      findOne: jest.fn().mockResolvedValue(enrollmentFixture),
    };

    mockPackageRepo = {
      create: jest.fn().mockImplementation((dto) => ({ id: 'package-1', ...dto })),
      save: jest.fn().mockImplementation((p) => Promise.resolve(p)),
      find: jest.fn().mockResolvedValue([packageFixture]),
      findOne: jest.fn().mockResolvedValue(packageFixture),
    };

    mockTrainerRepo = {
      create: jest.fn().mockImplementation((dto) => ({ id: 'trainer-1', ...dto })),
      save: jest.fn().mockImplementation((t) => Promise.resolve(t)),
      find: jest.fn().mockResolvedValue([trainerFixture]),
      findOne: jest.fn().mockResolvedValue(trainerFixture),
    };

    mockCommissionRepo = {
      create: jest.fn().mockImplementation((dto) => ({ id: 'commission-1', ...dto })),
      save: jest.fn().mockImplementation((c) => Promise.resolve(c)),
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
    };

    // Any repository this flow requests other than its own entities fails the test
    // loudly — this is what stops a parallel workout-assignment write path from
    // being reintroduced inside PT.
    mockDataSource = {
      getRepository: jest.fn().mockImplementation((target: unknown) => {
        if (target === PTEnrollment) return mockEnrollmentRepo;
        if (target === TrainerCommission) return mockCommissionRepo;
        throw new Error(
          `PtEnrollmentsService requested an unexpected repository: ${
            (target as { name?: string })?.name ?? String(target)
          }`,
        );
      }),
      transaction: jest
        .fn()
        .mockImplementation(async (cb: (mgr: EntityManager) => unknown) =>
          cb({
            getRepository: mockDataSource.getRepository,
          } as unknown as EntityManager),
        ),
    };

    mockTenantContext = {
      getCurrentOrganizationId: jest.fn().mockResolvedValue(orgId),
      getRequestedOrganizationId: jest.fn(),
      requireOrganizationAccess: jest.fn().mockResolvedValue(orgId),
      getCurrentBranchId: jest.fn().mockResolvedValue(null),
      validateBranchAccess: jest.fn().mockResolvedValue(true),
      getCurrentUserId: jest.fn().mockResolvedValue('user-1'),
    };

    mockOutbox = { saveEventEnvelope: jest.fn().mockResolvedValue(undefined) };

    mockMembersService = {
      findOne: jest.fn().mockResolvedValue({ id: memberId, organization_id: orgId }),
    };

    mockWorkoutsService = { assignPlan: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PtEnrollmentsService,
        {
          provide: getRepositoryToken(PTEnrollment),
          useValue: mockEnrollmentRepo,
        },
        { provide: getRepositoryToken(PTPackage), useValue: mockPackageRepo },
        {
          provide: getRepositoryToken(PersonalTrainer),
          useValue: mockTrainerRepo,
        },
        { provide: getDataSourceToken(), useValue: mockDataSource },
        { provide: TenantContextService, useValue: mockTenantContext },
        { provide: OutboxService, useValue: mockOutbox },
        { provide: MembersService, useValue: mockMembersService },
        { provide: WorkoutsService, useValue: mockWorkoutsService },
      ],
    }).compile();

    service = module.get(PtEnrollmentsService);
  });

  // ---------------------------------------------------------------------------
  // THE cross-module dependency: PT -> WorkoutsService.assignPlan() (Module 4's
  // reason for existing after Workouts). This is the test that has to fail if PT
  // ever grows its own parallel assignment write path.
  // ---------------------------------------------------------------------------

  describe('workout plan assignment (naming-collision resolution)', () => {
    const assignmentFixture = {
      id: 'assignment-1',
      organization_id: orgId,
      member_id: memberId,
      template_id: 'template-1',
      assigned_by: 'trainer-user-1',
      assigned_at: new Date('2026-09-01T10:00:00Z'),
      start_date: '2026-09-01',
      end_date: null,
      status: 'active',
    } as WorkoutPlanAssignment;

    const assignDto = {
      template_id: 'template-1',
      assigned_by: 'trainer-user-1',
    };

    it('calls the REAL WorkoutsService.assignPlan() with enrollment-derived arguments', async () => {
      mockWorkoutsService.assignPlan.mockResolvedValue(assignmentFixture);

      const result = await service.assignWorkoutPlan('enrollment-1', assignDto);

      expect(mockWorkoutsService.assignPlan).toHaveBeenCalledTimes(1);
      expect(mockWorkoutsService.assignPlan).toHaveBeenCalledWith({
        memberId: memberId,
        templateId: 'template-1',
        assignedBy: 'trainer-user-1',
        startDate: '2026-09-01',
        endDate: undefined,
        notes: undefined,
      });
      // Pass-through: the row returned is Workouts' row, never one PT built.
      expect(result).toBe(assignmentFixture);
    });

    it('forwards explicit dates and notes when the caller supplies them', async () => {
      mockWorkoutsService.assignPlan.mockResolvedValue(assignmentFixture);

      await service.assignWorkoutPlan('enrollment-1', {
        template_id: 'template-2',
        assigned_by: 'staff-1',
        start_date: '2026-10-01',
        end_date: '2026-12-31',
        notes: 'Strength block',
      });

      expect(mockWorkoutsService.assignPlan).toHaveBeenCalledWith({
        memberId: memberId,
        templateId: 'template-2',
        assignedBy: 'staff-1',
        startDate: '2026-10-01',
        endDate: '2026-12-31',
        notes: 'Strength block',
      });
    });

    it('does NO write of its own — no transaction, no WorkoutPlanAssignment repository', async () => {
      mockWorkoutsService.assignPlan.mockResolvedValue(assignmentFixture);

      await service.assignWorkoutPlan('enrollment-1', assignDto);

      // The mock DataSource throws for any repository other than PTEnrollment and
      // TrainerCommission, so a hand-rolled createAssignment() would blow up here.
      expect(mockDataSource.transaction).not.toHaveBeenCalled();
      expect(mockDataSource.getRepository).not.toHaveBeenCalled();
      expect(mockDataSource.getRepository).not.toHaveBeenCalledWith(
        WorkoutPlanAssignment,
      );
      expect(mockEnrollmentRepo.save).not.toHaveBeenCalled();
    });

    it('refuses plan assignment on a completed enrollment, before Workouts is called', async () => {
      mockEnrollmentRepo.findOne.mockResolvedValue({
        ...enrollmentFixture,
        status: PTEnrollmentStatus.COMPLETED,
      });

      await expect(
        service.assignWorkoutPlan('enrollment-1', assignDto),
      ).rejects.toThrow(ConflictException);
      expect(mockWorkoutsService.assignPlan).not.toHaveBeenCalled();
    });

    it('is org-scoped: an enrollment id from another organization is not found', async () => {
      mockEnrollmentRepo.findOne.mockResolvedValue(null);

      await expect(
        service.assignWorkoutPlan('enrollment-other-org', assignDto),
      ).rejects.toThrow('PTEnrollment not found');
      expect(mockWorkoutsService.assignPlan).not.toHaveBeenCalled();
      expect(mockEnrollmentRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'enrollment-other-org', organization_id: orgId },
      });
    });
  });

  // ---------------------------------------------------------------------------
  // Q2 — commission is computed ONCE, at enrollment creation
  // ---------------------------------------------------------------------------

  describe('commission (Q2)', () => {
    const createDto = {
      member_id: memberId,
      package_id: 'package-1',
      trainer_id: 'trainer-1',
      start_date: '2026-09-01',
    };

    it('computes amount = package.price × commission_percent / 100, status defaults to earned', async () => {
      await service.create(createDto);

      expect(mockCommissionRepo.create).toHaveBeenCalledTimes(1);
      expect(mockCommissionRepo.create.mock.calls[0][0]).toMatchObject({
        organization_id: orgId,
        pt_enrollment_id: 'enrollment-1',
        trainer_id: 'trainer-1',
        amount: '50.00', // 500.00 × 10.00 / 100
        currency: 'USD', // copied from the package (Q4), never inferred
        status: TrainerCommissionStatus.EARNED,
      });
      expect(mockCommissionRepo.save).toHaveBeenCalledTimes(1);
    });

    it('uses the enrollment-level override instead of the package default', async () => {
      await service.create({ ...createDto, commission_percent: 25 });

      const created = mockCommissionRepo.create.mock.calls[0][0];
      expect(created.amount).toBe('125.00'); // 500.00 × 25 / 100
      expect(created.status).toBe(TrainerCommissionStatus.EARNED);
    });

    it('treats an explicit 0% override as a real override (nullish, not falsy)', async () => {
      await service.create({ ...createDto, commission_percent: 0 });

      const created = mockCommissionRepo.create.mock.calls[0][0];
      expect(created.amount).toBe('0.00');
    });

    it('resolves a missing percent on both package and enrollment to 0.00', async () => {
      mockPackageRepo.findOne.mockResolvedValue({
        ...packageFixture,
        commission_percent: null,
      });

      await service.create(createDto);

      const created = mockCommissionRepo.create.mock.calls[0][0];
      expect(created.amount).toBe('0.00');
      expect(created.status).toBe(TrainerCommissionStatus.EARNED);
    });

    it('snapshots session_count from the package and starts at 0 used / active', async () => {
      await service.create(createDto);

      expect(mockEnrollmentRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          organization_id: orgId,
          member_id: memberId,
          package_id: 'package-1',
          trainer_id: 'trainer-1',
          sessions_used: 0,
          session_count: 10,
          status: PTEnrollmentStatus.ACTIVE,
          commission_percent: null,
        }),
      );
    });

    it('writes enrollment + commission + both contract events in ONE transaction', async () => {
      await service.create(createDto);

      expect(mockDataSource.transaction).toHaveBeenCalledTimes(1);
      expect(mockOutbox.saveEventEnvelope.mock.calls.map((c) => c[0])).toEqual([
        'PTEnrollmentCreated.v1',
        'TrainerCommissionEarned.v1',
      ]);
      // Both events ride the transaction's manager, so they commit/roll back with
      // the domain writes (never an orphan event).
      for (const call of mockOutbox.saveEventEnvelope.mock.calls) {
        const manager = call[6];
        expect(manager).toBeDefined();
        expect(typeof manager.getRepository).toBe('function');
      }
    });

    it('emits the commission event with the computed amount and the enrollment id', async () => {
      await service.create(createDto);

      const commissionEvent = mockOutbox.saveEventEnvelope.mock.calls[1];
      expect(commissionEvent[3]).toMatchObject({
        commissionId: 'commission-1',
        enrollmentId: 'enrollment-1',
        trainerId: 'trainer-1',
        amount: '50.00',
      });
    });

    it('is never recomputed or re-written on later reads', async () => {
      await service.create(createDto);
      mockCommissionRepo.create.mockClear();
      mockCommissionRepo.save.mockClear();

      await service.findOne('enrollment-1');
      await service.findAll({});
      mockWorkoutsService.assignPlan.mockResolvedValue({ id: 'assignment-1' });
      await service.assignWorkoutPlan('enrollment-1', {
        template_id: 'template-1',
        assigned_by: 'staff-1',
      });

      expect(mockCommissionRepo.create).not.toHaveBeenCalled();
      expect(mockCommissionRepo.save).not.toHaveBeenCalled();
    });

    it('has NO code path in src/pt that transitions a commission status (Q2 addendum)', () => {
      const ptDir = path.join(__dirname, '..');
      const files = listTypeScriptFiles(ptDir);

      // 1. The two states Phase 2 must never write are only DEFINED (in the enum),
      //    never referenced by code. A transition would have to name
      //    `TrainerCommissionStatus.CLAWED_BACK` / `.PENDING` somewhere.
      const enumFile = path.join(ptDir, 'entities', 'trainer-commission-status.enum.ts');
      const referencing = files.filter(
        (file) =>
          file !== enumFile &&
          /TrainerCommissionStatus\.(PENDING|CLAWED_BACK)/.test(
            fs.readFileSync(file, 'utf8'),
          ),
      );
      expect(referencing).toEqual([]);

      // 2. No clawback / cancellation handler exists anywhere in the module
      //    (code-shaped match: an identifier/call, not a prose mention).
      for (const file of files) {
        expect(fs.readFileSync(file, 'utf8')).not.toMatch(
          /clawback\(|clawBack|clawedBack|Clawback\w*\(/,
        );
      }

      // 3. Single write path for commissions: exactly ONE production file writes
      //    a commission row, and it is the enrollment service that computes the
      //    amount once, at creation.
      const writers = files.filter((file) =>
        /commissionRepo(sitory)?\.(save|update|insert|delete)\(/.test(
          fs.readFileSync(file, 'utf8'),
        ),
      );
      expect(writers).toEqual([
        path.join(ptDir, 'services', 'pt-enrollments.service.ts'),
      ]);

      // 4. ...and the commission service itself exposes no write method at all.
      const commissionService = fs.readFileSync(
        path.join(__dirname, 'trainer-commissions.service.ts'),
        'utf8',
      );
      expect(commissionService).not.toMatch(
        /\.update\(|\.save\(|\.insert\(|\.delete\(/,
      );
      expect(commissionService).not.toMatch(/async (create|update|remove)/);
    });
  });

  // ---------------------------------------------------------------------------
  // Org-scoping
  // ---------------------------------------------------------------------------

  describe('org-scoping', () => {
    const createDto = {
      member_id: memberId,
      package_id: 'package-1',
      trainer_id: 'trainer-1',
      start_date: '2026-09-01',
    };

    it('rejects a package from another organization', async () => {
      mockPackageRepo.findOne.mockResolvedValue(null);

      await expect(service.create(createDto)).rejects.toThrow(
        'PTPackage not found',
      );
      expect(mockPackageRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'package-1', organization_id: orgId },
      });
      expect(mockDataSource.transaction).not.toHaveBeenCalled();
    });

    it('rejects a trainer from another organization', async () => {
      mockTrainerRepo.findOne.mockResolvedValue(null);

      await expect(service.create(createDto)).rejects.toThrow(
        'PersonalTrainer not found',
      );
      expect(mockTrainerRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'trainer-1', organization_id: orgId },
      });
      expect(mockDataSource.transaction).not.toHaveBeenCalled();
    });

    it('rejects a member of another organization via MembersService', async () => {
      mockMembersService.findOne.mockRejectedValue(
        new NotFoundException('Member not found'),
      );

      await expect(
        service.create({ ...createDto, member_id: otherOrgId }),
      ).rejects.toThrow('Member not found');
      expect(mockPackageRepo.findOne).not.toHaveBeenCalled();
    });

    it('scopes findAll to the authorized organization, with optional filters', async () => {
      await service.findAll({
        member_id: memberId,
        status: PTEnrollmentStatus.ACTIVE,
      });

      expect(mockEnrollmentRepo.find).toHaveBeenCalledWith({
        where: {
          organization_id: orgId,
          member_id: memberId,
          status: PTEnrollmentStatus.ACTIVE,
        },
        order: { created_at: 'DESC' },
      });
    });

    it('scopes findOne to the authorized organization', async () => {
      mockEnrollmentRepo.findOne.mockResolvedValue(null);

      await expect(service.findOne('enrollment-other-org')).rejects.toThrow(
        'PTEnrollment not found',
      );
      expect(mockEnrollmentRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'enrollment-other-org', organization_id: orgId },
      });
    });
  });

  // ---------------------------------------------------------------------------
  // Derived session accounting (§1 + §12 Q1, Q26)
  // ---------------------------------------------------------------------------

  describe('sessions_remaining', () => {
    it('is derived from session_count - sessions_used and is never persisted', () => {
      const enrollment = Object.assign(new PTEnrollment(), {
        sessions_used: 3,
        session_count: 10,
      });

      expect(enrollment.sessions_remaining).toBe(7);
      // Derived only: no persisted column/decorator exists for it on the entity.
      expect(
        Reflect.getMetadata(
          'design:type',
          PTEnrollment.prototype,
          'sessions_remaining',
        ),
      ).toBeUndefined();
    });

    it('never reports a negative remainder', () => {
      const enrollment = Object.assign(new PTEnrollment(), {
        sessions_used: 11,
        session_count: 10,
      });

      expect(enrollment.sessions_remaining).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Commission formula (unit-level, §12 Q2)
  // ---------------------------------------------------------------------------

  describe('commission amount formula', () => {
    it('matches price × percent / 100 with 2-decimal rounding', () => {
      expect(computeCommissionAmount('500.00', '10.00')).toBe('50.00');
      expect(computeCommissionAmount('199.99', 12.5)).toBe('25.00');
      expect(computeCommissionAmount('500.00', null)).toBe('0.00');
      expect(computeCommissionAmount('500.00', undefined)).toBe('0.00');
    });
  });
});