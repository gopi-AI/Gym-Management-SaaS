import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { DataSource, FindOptionsWhere, In, Repository } from 'typeorm';
import { PlanDayReview } from '../entities/plan-day-review.entity';
import { PlanDaySubmission } from '../entities/plan-day-submission.entity';
import { PrescribedWorkoutDay } from '../entities/prescribed-workout-day.entity';
import { WorkoutPlanAssignment } from '../entities/workout-plan-assignment.entity';
import { WorkoutProgressReview } from '../entities/workout-progress-review.entity';
import { ProgressReviewMeasurement } from '../entities/progress-review-measurement.entity';
import { PlanDayStatus } from '../entities/plan-day-status.enum';
import { PlanDayReviewDecision } from '../entities/plan-day-review-decision.enum';
import { MeasurementLog } from '../../members/entities/measurement-log.entity';
import { AttendanceRecord } from '../../attendance/entities/attendance-record.entity';
import { ReviewPlanDayDto } from '../dto/review-plan-day.dto';
import { CreateProgressReviewDto } from '../dto/create-progress-review.dto';
import { ListProgressReviewsDto } from '../dto/list-progress-reviews.dto';
import { WorkoutsTenantService } from './workouts-tenant.service';
import { WorkoutAssignmentsService } from './workout-assignments.service';
import { OutboxService } from '../../shared/outbox/outbox.service';
import {
  WORKOUT_EVENT_TYPES,
  WORKOUT_EVENT_VERSION,
} from '../workouts.constants';

export interface ProgressReviewDetail extends WorkoutProgressReview {
  measurements: ProgressReviewMeasurement[];
}

export interface ProgressReviewComparison {
  member_id: string;
  reviews: Array<{
    id: string;
    review_date: string;
    period_start: string;
    period_end: string;
    approved_days: number;
    prescribed_days: number;
    progress_percentage: number;
    decision: string;
  }>;
  measurements: Array<{
    measurement_type: string;
    unit: string;
    points: Array<{
      review_id: string;
      review_date: string;
      measurement_id: string;
      value: number;
    }>;
  }>;
}

/**
 * Trainer review of prescribed days and 30–45-day progress reviews.
 *
 * The trainer decision is authoritative. A review is an append-only historical
 * row; later plan assignments or measurement changes never rewrite it.
 */
@Injectable()
export class WorkoutReviewsService {
  constructor(
    @InjectRepository(PlanDayReview)
    private readonly reviewRepository: Repository<PlanDayReview>,
    @InjectRepository(PlanDaySubmission)
    private readonly submissionRepository: Repository<PlanDaySubmission>,
    @InjectRepository(PrescribedWorkoutDay)
    private readonly prescribedDayRepository: Repository<PrescribedWorkoutDay>,
    @InjectRepository(WorkoutPlanAssignment)
    private readonly assignmentRepository: Repository<WorkoutPlanAssignment>,
    @InjectRepository(WorkoutProgressReview)
    private readonly progressReviewRepository: Repository<WorkoutProgressReview>,
    @InjectRepository(ProgressReviewMeasurement)
    private readonly reviewMeasurementRepository: Repository<ProgressReviewMeasurement>,
    @InjectRepository(MeasurementLog)
    private readonly measurementRepository: Repository<MeasurementLog>,
    /**
     * Read-only attendance source. The Workouts module reads the attendance
     * table directly instead of importing `AttendanceModule`: that module pulls
     * in Memberships → Finance → Members, and Members already imports Workouts,
     * so a service import would close a module cycle. No attendance row is ever
     * written here.
     */
    @InjectRepository(AttendanceRecord)
    private readonly attendanceRecordRepository: Repository<AttendanceRecord>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly tenant: WorkoutsTenantService,
    private readonly assignments: WorkoutAssignmentsService,
    private readonly outboxService: OutboxService,
  ) {}

  // ---------------------------------------------------------------------------
  // Plan-day review
  // ---------------------------------------------------------------------------

  /**
   * Approve a day, or ask the member to complete the remaining exercises.
   *
   * Approval requires no submission and no completion threshold: the trainer may
   * close a partially completed or entirely missed day. An already-approved day
   * is locked (409) so history is not silently rewritten.
   */
  async reviewDay(
    organizationId: string,
    dayId: string,
    dto: ReviewPlanDayDto,
    reviewedBy: string,
  ): Promise<{ review: PlanDayReview; day: PrescribedWorkoutDay }> {
    const day = await this.prescribedDayRepository.findOne({
      where: { id: dayId, organization_id: organizationId },
    });
    if (!day) {
      throw new NotFoundException('Prescribed workout day not found');
    }
    if (day.is_rest_day) {
      throw new BadRequestException('A rest day cannot be reviewed');
    }
    if (day.status === PlanDayStatus.APPROVED) {
      throw new ConflictException('This prescribed day is already approved');
    }

    const assignment = await this.assignmentRepository.findOne({
      where: { id: day.assignment_id, organization_id: organizationId },
    });
    if (!assignment) {
      throw new NotFoundException('Workout plan assignment not found');
    }

    const latestSubmission = await this.submissionRepository.findOne({
      where: {
        organization_id: organizationId,
        prescribed_day_id: day.id,
      },
      order: { submitted_at: 'DESC' },
    });

    const decidedAt = new Date();
    const approved = dto.decision === PlanDayReviewDecision.APPROVE;

    const result = await this.dataSource.transaction(async (manager) => {
      const reviewRepo = manager.getRepository(PlanDayReview);
      const dayRepo = manager.getRepository(PrescribedWorkoutDay);

      const review = await reviewRepo.save(
        reviewRepo.create({
          organization_id: organizationId,
          prescribed_day_id: day.id,
          submission_id: latestSubmission?.id ?? null,
          reviewed_by: reviewedBy,
          decision: dto.decision,
          notes: dto.notes ?? null,
          decided_at: decidedAt,
        }),
      );

      const nextStatus = approved
        ? PlanDayStatus.APPROVED
        : PlanDayStatus.REMAINING_REQUIRED;
      const patch: Partial<PrescribedWorkoutDay> = { status: nextStatus };
      if (approved) {
        patch.approved_at = decidedAt;
      }
      await dayRepo.update(
        { id: day.id, organization_id: organizationId },
        patch,
      );

      await this.outboxService.saveEventEnvelope(
        WORKOUT_EVENT_TYPES.WORKOUT_PLAN_DAY_REVIEWED,
        WORKOUT_EVENT_VERSION,
        organizationId,
        {
          reviewId: review.id,
          prescribedDayId: day.id,
          assignmentId: assignment.id,
          memberId: assignment.member_id,
          decision: dto.decision,
          submissionId: latestSubmission?.id ?? null,
          reviewedBy,
          decidedAt: decidedAt.toISOString(),
          status: nextStatus,
        },
        assignment.member_id,
        undefined,
        manager,
      );

      return {
        review,
        day: {
          ...day,
          status: nextStatus,
          approved_at: approved ? decidedAt : day.approved_at ?? null,
        },
      };
    });

    return result;
  }

  async listDayReviews(
    organizationId: string,
    dayId: string,
  ): Promise<PlanDayReview[]> {
    const day = await this.prescribedDayRepository.findOne({
      where: { id: dayId, organization_id: organizationId },
    });
    if (!day) {
      throw new NotFoundException('Prescribed workout day not found');
    }
    return this.reviewRepository.find({
      where: { organization_id: organizationId, prescribed_day_id: day.id },
      order: { decided_at: 'DESC' },
    });
  }

  // ---------------------------------------------------------------------------
  // 30–45-day progress review
  // ---------------------------------------------------------------------------

  /**
   * Record a trainer-led progress review.
   *
   * Progress, the pending/approved day counts, the attendance summary and every
   * referenced measurement are SNAPSHOTTED at review time. The active
   * assignment is not expired or advanced; a next plan is created only when the
   * caller explicitly supplies `next_assignment`, in the same transaction.
   */
  async createProgressReview(
    organizationId: string,
    memberId: string,
    dto: CreateProgressReviewDto,
    reviewedBy: string,
  ): Promise<{
    review: ProgressReviewDetail;
    resulting_assignment: WorkoutPlanAssignment | null;
  }> {
    await this.tenant.requireMemberInOrganization(memberId, organizationId);

    const assignment = await this.assignmentRepository.findOne({
      where: {
        id: dto.assignment_id,
        organization_id: organizationId,
        member_id: memberId,
      },
    });
    if (!assignment) {
      throw new NotFoundException('Workout plan assignment not found');
    }

    const periodStart = dto.period_start.slice(0, 10);
    const periodEnd = dto.period_end.slice(0, 10);
    if (periodStart > periodEnd) {
      throw new BadRequestException(
        'period_start must be on or before period_end',
      );
    }

    const progress = await this.assignments.getProgressForAssignment(
      organizationId,
      assignment.id,
    );
    const restDays = await this.prescribedDayRepository.count({
      where: {
        organization_id: organizationId,
        assignment_id: assignment.id,
        is_rest_day: true,
      },
    });

    const attendanceSummary = await this.buildAttendanceSummary(
      organizationId,
      memberId,
      periodStart,
      periodEnd,
    );

    const measurements =
      dto.measurement_ids && dto.measurement_ids.length > 0
        ? await this.measurementRepository.find({
            where: {
              id: In(dto.measurement_ids),
              organization_id: organizationId,
              member_id: memberId,
            },
          })
        : [];
    if (measurements.length !== (dto.measurement_ids?.length ?? 0)) {
      throw new NotFoundException(
        'One or more measurements were not found for this member',
      );
    }

    const reviewDate = dto.review_date.slice(0, 10);
    const planDaySummary = {
      ...progress.status_counts,
      rest_days: restDays,
    };

    return this.dataSource.transaction(async (manager) => {
      const reviewRepo = manager.getRepository(WorkoutProgressReview);
      const measurementRepo = manager.getRepository(ProgressReviewMeasurement);

      const review = await reviewRepo.save(
        reviewRepo.create({
          organization_id: organizationId,
          member_id: memberId,
          assignment_id: assignment.id,
          review_date: reviewDate,
          period_start: periodStart,
          period_end: periodEnd,
          approved_days: progress.completed,
          prescribed_days: progress.prescribed,
          progress_percentage: progress.percentage,
          plan_day_summary: planDaySummary,
          attendance_summary: attendanceSummary,
          results: dto.results ?? null,
          fitness_improvements: dto.fitness_improvements ?? null,
          goal_assessment: dto.goal_assessment ?? null,
          observations: dto.observations ?? null,
          recommendations: dto.recommendations ?? null,
          decision: dto.decision,
          reviewed_by: reviewedBy,
        }),
      );

      let measurementRows: ProgressReviewMeasurement[] = [];
      if (measurements.length > 0) {
        measurementRows = await measurementRepo.save(
          measurements.map((measurement) =>
            measurementRepo.create({
              review_id: review.id,
              measurement_id: measurement.id,
              measurement_type: measurement.measurement_type,
              value: measurement.value,
              unit: measurement.unit,
              measured_at: measurement.measured_at,
            }),
          ),
        );
      }

      let resultingAssignment: WorkoutPlanAssignment | null = null;
      if (dto.next_assignment) {
        resultingAssignment = await this.assignments.assignPlanTemplate(
          organizationId,
          memberId,
          {
            plan_template_id: dto.next_assignment.plan_template_id,
            start_date: dto.next_assignment.start_date,
            end_date: dto.next_assignment.end_date,
            notes: dto.next_assignment.notes,
            logging_mode: dto.next_assignment.logging_mode,
          },
          reviewedBy,
          { manager, progressReviewId: review.id },
        );
        await reviewRepo.update(
          { id: review.id, organization_id: organizationId },
          { resulting_assignment_id: resultingAssignment.id },
        );
        review.resulting_assignment_id = resultingAssignment.id;
      }

      await this.outboxService.saveEventEnvelope(
        WORKOUT_EVENT_TYPES.WORKOUT_PROGRESS_REVIEW_RECORDED,
        WORKOUT_EVENT_VERSION,
        organizationId,
        {
          reviewId: review.id,
          memberId,
          assignmentId: assignment.id,
          reviewDate,
          periodStart,
          periodEnd,
          approvedDays: progress.completed,
          prescribedDays: progress.prescribed,
          progressPercentage: progress.percentage,
          decision: dto.decision,
          reviewedBy,
          resultingAssignmentId: resultingAssignment?.id ?? null,
        },
        memberId,
        undefined,
        manager,
      );

      return {
        review: { ...review, measurements: measurementRows },
        resulting_assignment: resultingAssignment,
      };
    });
  }

  /**
   * Snapshot the member's REAL attendance records for the review period.
   *
   * Attendance is owned by the attendance/biometric source of truth; this is a
   * read-only aggregate. No row is created, edited or fabricated here, and a
   * member with no records yields zero counts.
   */
  private async buildAttendanceSummary(
    organizationId: string,
    memberId: string,
    periodStart: string,
    periodEnd: string,
  ): Promise<Record<string, unknown>> {
    const from = new Date(`${periodStart}T00:00:00.000Z`);
    const toExclusive = new Date(
      new Date(`${periodEnd}T00:00:00.000Z`).getTime() + 24 * 60 * 60 * 1000,
    );

    const summary: { total: string; days: string } | undefined =
      await this.attendanceRecordRepository
        .createQueryBuilder('record')
        .select('COUNT(*)', 'total')
        .addSelect(
          "COUNT(DISTINCT DATE(record.check_in_time AT TIME ZONE 'UTC'))",
          'days',
        )
        .where('record.organization_id = :organizationId', { organizationId })
        .andWhere('record.member_id = :memberId', { memberId })
        .andWhere('record.check_in_time >= :from', { from })
        .andWhere('record.check_in_time < :toExclusive', { toExclusive })
        .getRawOne();

    const methodRows: Array<{ method: string; count: string }> =
      await this.attendanceRecordRepository
        .createQueryBuilder('record')
        .select('record.check_in_method', 'method')
        .addSelect('COUNT(*)', 'count')
        .where('record.organization_id = :organizationId', { organizationId })
        .andWhere('record.member_id = :memberId', { memberId })
        .andWhere('record.check_in_time >= :from', { from })
        .andWhere('record.check_in_time < :toExclusive', { toExclusive })
        .groupBy('record.check_in_method')
        .getRawMany();

    const methods: Record<string, number> = {};
    for (const row of methodRows) {
      methods[row.method] = Number(row.count);
    }

    return {
      source: 'attendance_records',
      period_start: periodStart,
      period_end: periodEnd,
      total_check_ins: Number(summary?.total ?? 0),
      distinct_visit_days: Number(summary?.days ?? 0),
      methods,
    };
  }

  async listProgressReviews(
    organizationId: string,
    memberId: string,
    query: ListProgressReviewsDto = {},
  ): Promise<ProgressReviewDetail[]> {
    await this.tenant.requireMemberInOrganization(memberId, organizationId);

    const where: FindOptionsWhere<WorkoutProgressReview> = {
      organization_id: organizationId,
      member_id: memberId,
    };
    if (query.assignment_id) {
      where.assignment_id = query.assignment_id;
    }

    const reviews = await this.progressReviewRepository.find({
      where,
      order: { review_date: 'DESC', created_at: 'DESC' },
    });
    if (reviews.length === 0) {
      return [];
    }
    const measurements = await this.reviewMeasurementRepository.find({
      where: { review_id: In(reviews.map((review) => review.id)) },
    });
    const byReview = new Map<string, ProgressReviewMeasurement[]>();
    for (const measurement of measurements) {
      const rows = byReview.get(measurement.review_id) ?? [];
      rows.push(measurement);
      byReview.set(measurement.review_id, rows);
    }
    return reviews.map((review) => ({
      ...review,
      measurements: byReview.get(review.id) ?? [],
    }));
  }

  async getProgressReview(
    organizationId: string,
    reviewId: string,
  ): Promise<ProgressReviewDetail> {
    const review = await this.progressReviewRepository.findOne({
      where: { id: reviewId, organization_id: organizationId },
    });
    if (!review) {
      throw new NotFoundException('Workout progress review not found');
    }
    const measurements = await this.reviewMeasurementRepository.find({
      where: { review_id: review.id },
    });
    return { ...review, measurements };
  }

  /**
   * Compare review snapshots across dates for one member.
   *
   * The series reference the historical measurement snapshots, so later
   * measurement writes cannot rewrite a past review.
   */
  async getComparison(
    organizationId: string,
    memberId: string,
  ): Promise<ProgressReviewComparison> {
    const reviews = await this.listProgressReviews(organizationId, memberId);
    const ordered = [...reviews].sort((a, b) =>
      a.review_date.localeCompare(b.review_date),
    );

    const series = new Map<
      string,
      {
        measurement_type: string;
        unit: string;
        points: Array<{
          review_id: string;
          review_date: string;
          measurement_id: string;
          value: number;
        }>;
      }
    >();

    for (const review of ordered) {
      for (const measurement of review.measurements) {
        const key = `${measurement.measurement_type}|${measurement.unit}`;
        const entry =
          series.get(key) ?? {
            measurement_type: measurement.measurement_type,
            unit: measurement.unit,
            points: [],
          };
        entry.points.push({
          review_id: review.id,
          review_date: review.review_date,
          measurement_id: measurement.measurement_id,
          value: Number(measurement.value),
        });
        series.set(key, entry);
      }
    }

    return {
      member_id: memberId,
      reviews: ordered.map((review) => ({
        id: review.id,
        review_date: review.review_date,
        period_start: review.period_start,
        period_end: review.period_end,
        approved_days: review.approved_days,
        prescribed_days: review.prescribed_days,
        progress_percentage: review.progress_percentage,
        decision: review.decision,
      })),
      measurements: [...series.values()],
    };
  }
}
