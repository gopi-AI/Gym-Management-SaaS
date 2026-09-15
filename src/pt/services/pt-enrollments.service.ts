import {
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { DataSource, FindOptionsWhere, Repository } from 'typeorm';
import { PTEnrollment } from '../entities/pt-enrollment.entity';
import { PTPackage } from '../entities/pt-package.entity';
import { PersonalTrainer } from '../entities/personal-trainer.entity';
import { TrainerCommission } from '../entities/trainer-commission.entity';
import { PTEnrollmentStatus } from '../entities/pt-enrollment-status.enum';
import { TrainerCommissionStatus } from '../entities/trainer-commission-status.enum';
import { CreatePtEnrollmentDto } from '../dto/create-pt-enrollment.dto';
import { ListPtEnrollmentsDto } from '../dto/list-pt-enrollments.dto';
import { AssignEnrollmentWorkoutPlanDto } from '../dto/assign-enrollment-workout-plan.dto';
import { computeCommissionAmount, PT_EVENT_TYPES, PT_EVENT_VERSION } from '../pt.constants';
import { TenantContextService } from '../../shared/tenant/tenant-context.service';
import { OutboxService } from '../../shared/outbox/outbox.service';
import { MembersService } from '../../members/services/members.service';
import { WorkoutsService } from '../../workouts/services/workouts.service';
import { WorkoutPlanAssignment } from '../../workouts/entities/workout-plan-assignment.entity';
import { AssignPlanInput } from '../../workouts/dto/assign-plan.input';

/**
 * Single legal write path for `PTEnrollment` and `TrainerCommission` rows.
 *
 * Two invariants this service owns:
 *
 * 1. **Q2 — commission is computed once, at enrollment creation.** Both rows are
 *    written in ONE transaction, together with the `PTEnrollmentCreated.v1` and
 *    `TrainerCommissionEarned.v1` outbox events. Nothing else in this module ever
 *    writes a `TrainerCommission`, and no code path transitions its `status`
 *    (Phase 2 sets `earned` exactly once — no clawback API, no cancellation
 *    handler, no worker).
 *
 * 2. **PT owns no workout/assignment tables.** `assignWorkoutPlan()` delegates the
 *    entire write to `WorkoutsService.assignPlan()` — the same exported method the
 *    Workouts REST API calls. This service injects NO `WorkoutPlanAssignment`
 *    repository and constructs no assignment row (naming-collision resolution:
 *    `PT → WorkoutsService.assignPlan()`, one-directional).
 */
@Injectable()
export class PtEnrollmentsService {
  constructor(
    @InjectRepository(PTEnrollment)
    private readonly enrollmentRepository: Repository<PTEnrollment>,
    @InjectRepository(PTPackage)
    private readonly packageRepository: Repository<PTPackage>,
    @InjectRepository(PersonalTrainer)
    private readonly trainerRepository: Repository<PersonalTrainer>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly tenantContextService: TenantContextService,
    private readonly outboxService: OutboxService,
    private readonly membersService: MembersService,
    private readonly workoutsService: WorkoutsService,
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

  /**
   * Create a PT enrollment and its single `TrainerCommission` row (Q2).
   *
   * Steps, in order:
   *   1. Org-scoped validation of member, package and trainer.
   *   2. Effective commission percent = enrollment override ?? package default.
   *   3. One transaction: enrollment row + commission row + two outbox events.
   *
   * `session_count` is snapshotted from the package, `sessions_used` starts at 0
   * and `status` starts `active` (§1).
   */
  async create(dto: CreatePtEnrollmentDto): Promise<PTEnrollment> {
    const organizationId = await this.getOrganizationId();

    // 1. Org-scoped validation. MembersService.findOne() is itself org-scoped and
    //    throws NotFoundException for a member of another organization.
    const member = await this.membersService.findOne(dto.member_id);

    const pkg = await this.packageRepository.findOne({
      where: { id: dto.package_id, organization_id: organizationId },
    });
    if (!pkg) {
      throw new NotFoundException('PTPackage not found');
    }
    if (!pkg.is_active) {
      throw new BadRequestException('PTPackage is not active');
    }

    const trainer = await this.trainerRepository.findOne({
      where: { id: dto.trainer_id, organization_id: organizationId },
    });
    if (!trainer) {
      throw new NotFoundException('PersonalTrainer not found');
    }
    if (!trainer.is_active) {
      throw new BadRequestException('PersonalTrainer is not active');
    }

    // 2. Q2: the enrollment-level override wins over the package default. A
    //    missing percent on both resolves to 0 ("no commission configured"); the
    //    contract formula is applied literally and the
    //    one-row-per-enrollment invariant is preserved. Flagged in the report.
    const effectiveCommissionPercent =
      dto.commission_percent ?? pkg.commission_percent ?? null;
    const commissionAmount = computeCommissionAmount(
      pkg.price,
      effectiveCommissionPercent,
    );

    const startDate = dto.start_date ?? new Date().toISOString().slice(0, 10);

    return this.dataSource.transaction(async (manager) => {
      const enrollmentRepo = manager.getRepository(PTEnrollment);
      const commissionRepo = manager.getRepository(TrainerCommission);

      const enrollment = enrollmentRepo.create({
        organization_id: organizationId,
        member_id: member.id,
        package_id: pkg.id,
        trainer_id: trainer.id,
        commission_percent:
          dto.commission_percent === undefined
            ? null
            : String(dto.commission_percent),
        start_date: startDate,
        end_date: dto.end_date ?? null,
        sessions_used: 0,
        session_count: pkg.session_count,
        status: PTEnrollmentStatus.ACTIVE,
      });
      const saved = await enrollmentRepo.save(enrollment);

      // Q2: exactly one commission row per enrollment, computed once, here.
      const commission = commissionRepo.create({
        organization_id: organizationId,
        pt_enrollment_id: saved.id,
        trainer_id: trainer.id,
        amount: commissionAmount,
        currency: pkg.currency,
        status: TrainerCommissionStatus.EARNED,
        earned_at: new Date(),
      });
      const savedCommission = await commissionRepo.save(commission);

      // Contract events (§1), on the same transaction as the domain writes.
      await this.outboxService.saveEventEnvelope(
        PT_EVENT_TYPES.ENROLLMENT_CREATED,
        PT_EVENT_VERSION,
        organizationId,
        {
          enrollmentId: saved.id,
          memberId: saved.member_id,
          packageId: saved.package_id,
          trainerId: saved.trainer_id,
          startDate: saved.start_date,
          sessionCount: saved.session_count,
        },
        saved.id,
        undefined,
        manager,
      );

      await this.outboxService.saveEventEnvelope(
        PT_EVENT_TYPES.TRAINER_COMMISSION_EARNED,
        PT_EVENT_VERSION,
        organizationId,
        {
          commissionId: savedCommission.id,
          enrollmentId: saved.id,
          trainerId: savedCommission.trainer_id,
          amount: savedCommission.amount,
        },
        saved.id,
        undefined,
        manager,
      );

      return saved;
    });
  }

  async findAll(query: ListPtEnrollmentsDto): Promise<PTEnrollment[]> {
    const organizationId = await this.getOrganizationId();
    const where: FindOptionsWhere<PTEnrollment> = {
      organization_id: organizationId,
    };
    if (query.member_id) where.member_id = query.member_id;
    if (query.trainer_id) where.trainer_id = query.trainer_id;
    if (query.status) where.status = query.status;

    return this.enrollmentRepository.find({
      where,
      order: { created_at: 'DESC' },
    });
  }

  async findOne(id: string): Promise<PTEnrollment> {
    const organizationId = await this.getOrganizationId();
    const enrollment = await this.enrollmentRepository.findOne({
      where: { id, organization_id: organizationId },
    });
    if (!enrollment) {
      throw new NotFoundException('PTEnrollment not found');
    }
    return enrollment;
  }

  /**
   * Assign a Workouts template to the enrolled member, in the context of this
   * enrollment (naming-collision resolution).
   *
   * **Explicit action, never automatic.** Neither the §1 `PTEnrollment` schema nor
   * the `PTEnrollmentCreated.v1` payload carries a template reference, so
   * enrollment creation cannot trigger a plan assignment. Staff invoke this
   * operation deliberately when a package should come with a program.
   *
   * **No reimplementation.** PT owns no assignment table and this service injects
   * no assignment repository: org-scoping, the duplicate-active guard, the insert
   * and the `WorkoutPlanAssigned.v1` event all happen inside
   * `WorkoutsService.assignPlan()` — the same single write path the Workouts API
   * uses. The returned `WorkoutPlanAssignment` is Workouts' row, passed straight
   * through, never built here.
   *
   * This is deliberately a separate unit of work: `assignPlan()` opens its own
   * `dataSource.transaction()` (a fresh query runner), so calling it from inside
   * the enrollment transaction would commit independently of the enrollment and
   * break atomicity in both directions.
   */
  async assignWorkoutPlan(
    enrollmentId: string,
    dto: AssignEnrollmentWorkoutPlanDto,
  ): Promise<WorkoutPlanAssignment> {
    const enrollment = await this.findOne(enrollmentId);

    if (enrollment.status === PTEnrollmentStatus.COMPLETED) {
      throw new ConflictException(
        'PTEnrollment is completed — no workout plan can be assigned to it',
      );
    }
    if (enrollment.status === PTEnrollmentStatus.CANCELLED) {
      throw new ConflictException(
        'PTEnrollment is cancelled — no workout plan can be assigned to it',
      );
    }

    const input: AssignPlanInput = {
      memberId: enrollment.member_id,
      templateId: dto.template_id,
      assignedBy: dto.assigned_by,
      startDate: dto.start_date ?? enrollment.start_date,
      endDate: dto.end_date ?? enrollment.end_date ?? undefined,
      notes: dto.notes,
    };

    return this.workoutsService.assignPlan(input);
  }
}