import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { WorkoutReviewsService } from './workout-reviews.service';
import { WorkoutsTenantService } from './workouts-tenant.service';
import { WorkoutAssignmentsService } from './workout-assignments.service';
import { OutboxService } from '../../shared/outbox/outbox.service';
import { PlanDayReview } from '../entities/plan-day-review.entity';
import { PlanDaySubmission } from '../entities/plan-day-submission.entity';
import { PrescribedWorkoutDay } from '../entities/prescribed-workout-day.entity';
import { WorkoutPlanAssignment } from '../entities/workout-plan-assignment.entity';
import { WorkoutProgressReview } from '../entities/workout-progress-review.entity';
import { ProgressReviewMeasurement } from '../entities/progress-review-measurement.entity';
import { MeasurementLog } from '../../members/entities/measurement-log.entity';
import { AttendanceRecord } from '../../attendance/entities/attendance-record.entity';
import { PlanDayStatus } from '../entities/plan-day-status.enum';
import { PlanDayReviewDecision } from '../entities/plan-day-review-decision.enum';
import { ProgressReviewDecision } from '../entities/progress-review-decision.enum';

describe('WorkoutReviewsService', () => {
  const orgId = 'org-1';
  const memberId = 'member-1';
  const userId = 'trainer-user-1';

  let service: WorkoutReviewsService;
  let reviewRepo: Record<string, jest.Mock>;
  let submissionRepo: Record<string, jest.Mock>;
  let prescribedDayRepo: Record<string, jest.Mock>;
  let assignmentRepo: Record<string, jest.Mock>;
  let progressReviewRepo: Record<string, jest.Mock>;
  let reviewMeasurementRepo: Record<string, jest.Mock>;
  let measurementRepo: Record<string, jest.Mock>;
  let attendanceRepo: Record<string, jest.Mock>;
  let manager: EntityManager;
  let managerReviewRepo: Record<string, jest.Mock>;
  let managerProgressReviewRepo: Record<string, jest.Mock>;
  let managerMeasurementRepo: Record<string, jest.Mock>;
  let managerDayRepo: Record<string, jest.Mock>;
  let dataSource: { transaction: jest.Mock };
  let tenant: Record<string, jest.Mock>;
  let assignments: Record<string, jest.Mock>;
  let outbox: Record<string, jest.Mock>;

  const dayFixture = {
    id: 'day-1',
    organization_id: orgId,
    assignment_id: 'assignment-1',
    is_rest_day: false,
    status: PlanDayStatus.SUBMITTED,
    approved_at: null,
  };

  const assignmentFixture = {
    id: 'assignment-1',
    organization_id: orgId,
    member_id: memberId,
  };

  const progressFixture = {
    completed: 1,
    prescribed: 3,
    percentage: 33,
    status_counts: {
      pending: 1,
      submitted: 1,
      remaining_required: 0,
      approved: 1,
    },
    exercise_completion: { completed: 2, prescribed: 4, percentage: 50 },
  };

  beforeEach(() => {
    reviewRepo = {
      find: jest.fn().mockResolvedValue([]),
    };
    submissionRepo = { findOne: jest.fn().mockResolvedValue(null) };
    prescribedDayRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      count: jest.fn().mockResolvedValue(1),
    };
    assignmentRepo = { findOne: jest.fn().mockResolvedValue(null) };
    progressReviewRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      find: jest.fn().mockResolvedValue([]),
    };
    reviewMeasurementRepo = { find: jest.fn().mockResolvedValue([]) };
    measurementRepo = { find: jest.fn().mockResolvedValue([]) };
    attendanceRepo = { createQueryBuilder: jest.fn() };

    managerReviewRepo = {
      create: jest.fn((input) => ({ ...input })),
      save: jest.fn(async (input) => ({ id: 'review-1', ...input })),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    managerProgressReviewRepo = {
      create: jest.fn((input) => ({ ...input })),
      save: jest.fn(async (input) => ({ id: 'progress-review-1', ...input })),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    managerMeasurementRepo = {
      create: jest.fn((input) => ({ ...input })),
      save: jest.fn(async (input) => input),
    };
    managerDayRepo = { update: jest.fn().mockResolvedValue({ affected: 1 }) };

    manager = {
      getRepository: jest.fn((target: unknown) => {
        if (target === PlanDayReview) return managerReviewRepo;
        if (target === WorkoutProgressReview) return managerProgressReviewRepo;
        if (target === ProgressReviewMeasurement) return managerMeasurementRepo;
        if (target === PrescribedWorkoutDay) return managerDayRepo;
        throw new Error('unexpected repository');
      }),
    } as unknown as EntityManager;

    dataSource = {
      transaction: jest.fn(async (cb: (m: EntityManager) => unknown) => cb(manager)),
    };
    tenant = {
      requireMemberInOrganization: jest.fn().mockResolvedValue({ id: memberId }),
    };
    assignments = {
      getProgressForAssignment: jest.fn().mockResolvedValue(progressFixture),
      assignPlanTemplate: jest.fn().mockResolvedValue({
        id: 'next-assignment-1',
        organization_id: orgId,
        member_id: memberId,
      }),
    };
    outbox = {
      saveEventEnvelope: jest.fn().mockResolvedValue({ id: 'outbox-1' }),
    };

    service = new WorkoutReviewsService(
      reviewRepo as never,
      submissionRepo as never,
      prescribedDayRepo as never,
      assignmentRepo as never,
      progressReviewRepo as never,
      reviewMeasurementRepo as never,
      measurementRepo as never,
      attendanceRepo as never,
      dataSource as never,
      tenant as unknown as WorkoutsTenantService,
      assignments as unknown as WorkoutAssignmentsService,
      outbox as unknown as OutboxService,
    );
  });

  describe('reviewDay', () => {
    it('approves a missed day with no submission and marks it approved', async () => {
      prescribedDayRepo.findOne.mockResolvedValue(dayFixture);
      assignmentRepo.findOne.mockResolvedValue(assignmentFixture);
      submissionRepo.findOne.mockResolvedValue(null);

      const result = await service.reviewDay(
        orgId,
        'day-1',
        { decision: PlanDayReviewDecision.APPROVE, notes: 'closed next day' },
        userId,
      );

      expect(managerReviewRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          prescribed_day_id: 'day-1',
          submission_id: null,
          decision: PlanDayReviewDecision.APPROVE,
          reviewed_by: userId,
        }),
      );
      expect(managerDayRepo.update).toHaveBeenCalledWith(
        { id: 'day-1', organization_id: orgId },
        expect.objectContaining({
          status: PlanDayStatus.APPROVED,
          approved_at: expect.any(Date),
        }),
      );
      expect(result.day.status).toBe(PlanDayStatus.APPROVED);
      expect(outbox.saveEventEnvelope).toHaveBeenCalledWith(
        'WorkoutPlanDayReviewed',
        'v1',
        orgId,
        expect.objectContaining({
          decision: PlanDayReviewDecision.APPROVE,
          status: PlanDayStatus.APPROVED,
          memberId,
        }),
        memberId,
        undefined,
        manager,
      );
    });

    it('asks for the remaining exercises and keeps the day open', async () => {
      prescribedDayRepo.findOne.mockResolvedValue(dayFixture);
      assignmentRepo.findOne.mockResolvedValue(assignmentFixture);
      submissionRepo.findOne.mockResolvedValue({ id: 'submission-1' });

      const result = await service.reviewDay(
        orgId,
        'day-1',
        { decision: PlanDayReviewDecision.REQUEST_REMAINING },
        userId,
      );

      expect(managerDayRepo.update).toHaveBeenCalledWith(
        { id: 'day-1', organization_id: orgId },
        { status: PlanDayStatus.REMAINING_REQUIRED },
      );
      expect(result.day.status).toBe(PlanDayStatus.REMAINING_REQUIRED);
      expect(result.review.submission_id).toBe('submission-1');
    });

    it('rejects reviewing an already-approved day', async () => {
      prescribedDayRepo.findOne.mockResolvedValue({
        ...dayFixture,
        status: PlanDayStatus.APPROVED,
      });

      await expect(
        service.reviewDay(
          orgId,
          'day-1',
          { decision: PlanDayReviewDecision.APPROVE },
          userId,
        ),
      ).rejects.toThrow(ConflictException);
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });
  });

  describe('createProgressReview', () => {
    function mockAttendance() {
      attendanceRepo.createQueryBuilder
        .mockReturnValueOnce({
          select: jest.fn().mockReturnThis(),
          addSelect: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          getRawOne: jest.fn().mockResolvedValue({ total: '4', days: '3' }),
        })
        .mockReturnValueOnce({
          select: jest.fn().mockReturnThis(),
          addSelect: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          groupBy: jest.fn().mockReturnThis(),
          getRawMany: jest
            .fn()
            .mockResolvedValue([{ method: 'manual', count: '4' }]),
        });
    }

    function baseDto() {
      return {
        assignment_id: 'assignment-1',
        review_date: '2026-11-01',
        period_start: '2026-09-15',
        period_end: '2026-11-01',
        decision: ProgressReviewDecision.CONTINUE,
      };
    }

    it('snapshots progress, attendance and existing measurements', async () => {
      assignmentRepo.findOne.mockResolvedValue(assignmentFixture);
      mockAttendance();
      measurementRepo.find.mockResolvedValue([
        {
          id: 'measurement-1',
          organization_id: orgId,
          member_id: memberId,
          measurement_type: 'weight',
          value: 82,
          unit: 'kg',
          measured_at: new Date('2026-10-01T09:00:00Z'),
        },
      ]);

      const result = await service.createProgressReview(
        orgId,
        memberId,
        { ...baseDto(), measurement_ids: ['measurement-1'] },
        userId,
      );

      expect(managerProgressReviewRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          approved_days: 1,
          prescribed_days: 3,
          progress_percentage: 33,
          plan_day_summary: {
            pending: 1,
            submitted: 1,
            remaining_required: 0,
            approved: 1,
            rest_days: 1,
          },
          attendance_summary: expect.objectContaining({
            source: 'attendance_records',
            total_check_ins: 4,
            distinct_visit_days: 3,
            methods: { manual: 4 },
          }),
          decision: ProgressReviewDecision.CONTINUE,
        }),
      );
      expect(managerMeasurementRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          review_id: 'progress-review-1',
          measurement_id: 'measurement-1',
          measurement_type: 'weight',
          value: 82,
          unit: 'kg',
        }),
      );
      expect(outbox.saveEventEnvelope).toHaveBeenCalledWith(
        'WorkoutProgressReviewRecorded',
        'v1',
        orgId,
        expect.objectContaining({
          reviewId: 'progress-review-1',
          memberId,
          assignmentId: 'assignment-1',
          approvedDays: 1,
          prescribedDays: 3,
          progressPercentage: 33,
        }),
        memberId,
        undefined,
        manager,
      );
      expect(result.resulting_assignment).toBeNull();
    });

    it('creates and links the next assignment in the same transaction', async () => {
      assignmentRepo.findOne.mockResolvedValue(assignmentFixture);
      mockAttendance();

      const result = await service.createProgressReview(
        orgId,
        memberId,
        {
          ...baseDto(),
          decision: ProgressReviewDecision.NEW_PLAN,
          next_assignment: {
            plan_template_id: 'plan-2',
            start_date: '2026-11-02',
          },
        },
        userId,
      );

      expect(assignments.assignPlanTemplate).toHaveBeenCalledWith(
        orgId,
        memberId,
        expect.objectContaining({
          plan_template_id: 'plan-2',
          start_date: '2026-11-02',
        }),
        userId,
        { manager, progressReviewId: 'progress-review-1' },
      );
      expect(managerProgressReviewRepo.update).toHaveBeenCalledWith(
        { id: 'progress-review-1', organization_id: orgId },
        { resulting_assignment_id: 'next-assignment-1' },
      );
      expect(result.resulting_assignment?.id).toBe('next-assignment-1');
    });

    it('rejects a measurement that is not the member\'s in this organization', async () => {
      assignmentRepo.findOne.mockResolvedValue(assignmentFixture);
      mockAttendance();
      measurementRepo.find.mockResolvedValue([]);

      await expect(
        service.createProgressReview(
          orgId,
          memberId,
          { ...baseDto(), measurement_ids: ['foreign-measurement'] },
          userId,
        ),
      ).rejects.toThrow(NotFoundException);
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('rejects an inverted review period before reading anything else', async () => {
      assignmentRepo.findOne.mockResolvedValue(assignmentFixture);

      await expect(
        service.createProgressReview(
          orgId,
          memberId,
          {
            ...baseDto(),
            period_start: '2026-11-02',
            period_end: '2026-11-01',
          },
          userId,
        ),
      ).rejects.toThrow(BadRequestException);
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });
  });

  describe('getComparison', () => {
    it('groups historical measurement snapshots by type and unit', async () => {
      jest.spyOn(service, 'listProgressReviews').mockResolvedValue([
        {
          id: 'review-1',
          review_date: '2026-09-01',
          period_start: '2026-08-01',
          period_end: '2026-09-01',
          approved_days: 2,
          prescribed_days: 4,
          progress_percentage: 50,
          decision: ProgressReviewDecision.CONTINUE,
          measurements: [
            {
              measurement_id: 'm-1',
              measurement_type: 'weight',
              unit: 'kg',
              value: 82,
            },
          ],
        },
        {
          id: 'review-2',
          review_date: '2026-10-15',
          period_start: '2026-09-01',
          period_end: '2026-10-15',
          approved_days: 3,
          prescribed_days: 4,
          progress_percentage: 75,
          decision: ProgressReviewDecision.MODIFY,
          measurements: [
            {
              measurement_id: 'm-2',
              measurement_type: 'weight',
              unit: 'kg',
              value: 79,
            },
          ],
        },
      ] as never);

      const comparison = await service.getComparison(orgId, memberId);

      expect(comparison.reviews.map((review) => review.progress_percentage)).toEqual([
        50, 75,
      ]);
      expect(comparison.measurements).toEqual([
        {
          measurement_type: 'weight',
          unit: 'kg',
          points: [
            {
              review_id: 'review-1',
              review_date: '2026-09-01',
              measurement_id: 'm-1',
              value: 82,
            },
            {
              review_id: 'review-2',
              review_date: '2026-10-15',
              measurement_id: 'm-2',
              value: 79,
            },
          ],
        },
      ]);
    });
  });
});
