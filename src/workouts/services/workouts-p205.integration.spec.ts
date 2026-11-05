/**
 * P2-05 Workouts — real-Postgres integration coverage.
 *
 * WHY THIS EXISTS BESIDE THE HERMETIC SPECS
 * The service specs mock repositories, so they cannot see a query that actually
 * returns another organization's rows, a snapshot that silently re-reads a
 * template, or an outbox event committed without its domain row. This suite
 * drives the real services against a migrated schema and re-reads every state
 * change through a second query.
 *
 * RUNNING IT
 *   RUN_DB_INTEGRATION=1 \
 *     DB_HOST=<host> DB_PORT=<port> DB_USERNAME=<user> DB_PASSWORD=<password> \
 *     DB_DATABASE=<scratch> \
 *     npx jest src/workouts/services/workouts-p205.integration
 * The database MUST already be migrated with all migrations. Export only the
 * DB_* variables (plus REDIS_* if a run needs Redis); do not export JWT_SECRET —
 * see CLAUDE.md rule 9.
 *
 * Point it at a THROWAWAY database. Every row belongs to the two freshly
 * generated organizations and is deleted in `afterAll`, but the cleanup is a
 * courtesy, not a substitute for an isolated database.
 */
import { randomUUID } from 'crypto';
import { DataSource, In } from 'typeorm';
import { ConflictException, NotFoundException, BadRequestException } from '@nestjs/common';
import { WorkoutsTenantService } from './workouts-tenant.service';
import { ExerciseLibraryService } from './exercise-library.service';
import { WorkoutTemplatesService } from './workout-templates.service';
import { WorkoutAssignmentsService } from './workout-assignments.service';
import { WorkoutSessionsService } from './workout-sessions.service';
import { WorkoutReviewsService } from './workout-reviews.service';
import { TenantContextService } from '../../shared/tenant/tenant-context.service';
import { OutboxService } from '../../shared/outbox/outbox.service';
import { S3Service } from '../../shared/storage/s3.service';
import { Organization } from '../../tenancy/entities/organization.entity';
import { Branch } from '../../tenancy/entities/branch.entity';
import { Member } from '../../members/entities/member.entity';
import { MeasurementLog, MeasurementType } from '../../members/entities/measurement-log.entity';
import { AttendanceRecord } from '../../attendance/entities/attendance-record.entity';
import { OutboxEntity } from '../../shared/outbox/outbox.entity';
import { Exercise } from '../entities/exercise.entity';
import { WorkoutTemplate } from '../entities/workout-template.entity';
import { WorkoutTemplateExercise } from '../entities/workout-template-exercise.entity';
import { WorkoutDayTemplate } from '../entities/workout-day-template.entity';
import { WorkoutDayTemplateExercise } from '../entities/workout-day-template-exercise.entity';
import { WorkoutPlanTemplate } from '../entities/workout-plan-template.entity';
import { WorkoutPlanTemplateDay } from '../entities/workout-plan-template-day.entity';
import { WorkoutPlanAssignment } from '../entities/workout-plan-assignment.entity';
import { PrescribedWorkoutDay } from '../entities/prescribed-workout-day.entity';
import { PrescribedWorkoutDayExercise } from '../entities/prescribed-workout-day-exercise.entity';
import { WorkoutSession } from '../entities/workout-session.entity';
import { WorkoutSessionExercise } from '../entities/workout-session-exercise.entity';
import { PlanDaySubmission } from '../entities/plan-day-submission.entity';
import { PlanDaySubmissionExercise } from '../entities/plan-day-submission-exercise.entity';
import { PlanDayReview } from '../entities/plan-day-review.entity';
import { WorkoutProgressReview } from '../entities/workout-progress-review.entity';
import { ProgressReviewMeasurement } from '../entities/progress-review-measurement.entity';
import { PlanDayStatus } from '../entities/plan-day-status.enum';
import { PlanDayReviewDecision } from '../entities/plan-day-review-decision.enum';
import { ProgressReviewDecision } from '../entities/progress-review-decision.enum';
import { WorkoutSessionStatus } from '../entities/workout-session-status.enum';
import { AssignmentStatus } from '../entities/assignment-status.enum';

jest.setTimeout(120_000);

const RUN = process.env.RUN_DB_INTEGRATION === '1';
const describeIntegration = RUN ? describe : describe.skip;

describeIntegration('P2-05 Workouts (real Postgres)', () => {
  let dataSource: DataSource;
  let tenantContext: Record<string, jest.Mock>;
  let tenant: WorkoutsTenantService;
  let exercises: ExerciseLibraryService;
  let templates: WorkoutTemplatesService;
  let assignments: WorkoutAssignmentsService;
  let sessions: WorkoutSessionsService;
  let reviews: WorkoutReviewsService;

  let currentOrg = '';
  let currentUser = '';

  const ids = {
    orgA: randomUUID(),
    orgB: randomUUID(),
    branchA: randomUUID(),
    branchB: randomUUID(),
    memberA1: randomUUID(),
    memberA2: randomUUID(),
    memberB1: randomUUID(),
    userA: randomUUID(),
    userB: randomUUID(),
  };

  const created = {
    assignments: [] as string[],
    dayTemplates: [] as string[],
    planTemplates: [] as string[],
    exercises: [] as string[],
    sessions: [] as string[],
    submissions: [] as string[],
    planDayReviews: [] as string[],
    progressReviews: [] as string[],
    measurements: [] as string[],
    attendance: [] as string[],
  };

  function useOrgA(): void {
    currentOrg = ids.orgA;
    currentUser = ids.userA;
  }

  function useOrgB(): void {
    currentOrg = ids.orgB;
    currentUser = ids.userB;
  }

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432', 10),
      username: process.env.DB_USERNAME || 'postgres',
      password: process.env.DB_PASSWORD || 'postgres',
      database: process.env.DB_DATABASE || 'gym_management',
      entities: [__dirname + '/../../**/*.entity{.ts,.js}'],
      synchronize: false,
    });
    await dataSource.initialize();

    await dataSource.getRepository(Organization).save([
      {
        id: ids.orgA,
        name: 'P2-05 Org A',
        timezone: 'UTC',
        locale: 'en-US',
        currency: 'USD',
      },
      {
        id: ids.orgB,
        name: 'P2-05 Org B',
        timezone: 'UTC',
        locale: 'en-US',
        currency: 'USD',
      },
    ]);
    await dataSource.getRepository(Branch).save([
      {
        id: ids.branchA,
        organization_id: ids.orgA,
        name: 'A Main',
        address: '1 A Street',
        phone: '+10000000001',
      },
      {
        id: ids.branchB,
        organization_id: ids.orgB,
        name: 'B Main',
        address: '1 B Street',
        phone: '+10000000002',
      },
    ]);
    await dataSource.getRepository(Member).save([
      {
        id: ids.memberA1,
        organization_id: ids.orgA,
        branch_id: ids.branchA,
        global_uuid: randomUUID(),
        local_id: 1,
        first_name: 'Alice',
        last_name: 'A',
      },
      {
        id: ids.memberA2,
        organization_id: ids.orgA,
        branch_id: ids.branchA,
        global_uuid: randomUUID(),
        local_id: 2,
        first_name: 'Ava',
        last_name: 'A',
      },
      {
        id: ids.memberB1,
        organization_id: ids.orgB,
        branch_id: ids.branchB,
        global_uuid: randomUUID(),
        local_id: 1,
        first_name: 'Bob',
        last_name: 'B',
      },
    ]);

    tenantContext = {
      getCurrentOrganizationId: jest.fn(async () => currentOrg),
      getRequestedOrganizationId: jest.fn(async () => null),
      requireOrganizationAccess: jest.fn(async (orgId: string) => orgId),
      assertAuthenticated: jest.fn(async () => currentUser),
      getCurrentUserId: jest.fn(async () => currentUser),
    };
    tenant = new WorkoutsTenantService(
      tenantContext as unknown as TenantContextService,
      dataSource.getRepository(Member),
    );

    const outbox = new OutboxService(dataSource.getRepository(OutboxEntity));
    const s3 = {
      upload: jest.fn().mockResolvedValue({ key: 'k', etag: 'e' }),
      delete: jest.fn().mockResolvedValue(undefined),
      buildExerciseMediaKey: jest.fn(),
      buildKey: jest.fn(),
    } as unknown as S3Service;

    exercises = new ExerciseLibraryService(
      dataSource.getRepository(Exercise),
      s3,
    );
    templates = new WorkoutTemplatesService(
      dataSource.getRepository(WorkoutDayTemplate),
      dataSource.getRepository(WorkoutDayTemplateExercise),
      dataSource.getRepository(WorkoutPlanTemplate),
      dataSource.getRepository(WorkoutPlanTemplateDay),
      dataSource.getRepository(Exercise),
      dataSource,
    );
    assignments = new WorkoutAssignmentsService(
      dataSource.getRepository(WorkoutPlanAssignment),
      dataSource.getRepository(WorkoutPlanTemplate),
      dataSource.getRepository(WorkoutDayTemplate),
      dataSource.getRepository(WorkoutDayTemplateExercise),
      dataSource.getRepository(WorkoutTemplate),
      dataSource.getRepository(WorkoutTemplateExercise),
      dataSource.getRepository(Exercise),
      dataSource.getRepository(PrescribedWorkoutDay),
      dataSource.getRepository(PrescribedWorkoutDayExercise),
      dataSource,
      tenant,
      outbox,
    );
    sessions = new WorkoutSessionsService(
      dataSource.getRepository(WorkoutSession),
      dataSource.getRepository(WorkoutSessionExercise),
      dataSource.getRepository(WorkoutTemplate),
      dataSource.getRepository(Exercise),
      dataSource.getRepository(WorkoutPlanAssignment),
      dataSource.getRepository(PrescribedWorkoutDay),
      dataSource.getRepository(PrescribedWorkoutDayExercise),
      dataSource.getRepository(PlanDaySubmission),
      dataSource.getRepository(PlanDaySubmissionExercise),
      dataSource,
      tenant,
      outbox,
    );
    reviews = new WorkoutReviewsService(
      dataSource.getRepository(PlanDayReview),
      dataSource.getRepository(PlanDaySubmission),
      dataSource.getRepository(PrescribedWorkoutDay),
      dataSource.getRepository(WorkoutPlanAssignment),
      dataSource.getRepository(WorkoutProgressReview),
      dataSource.getRepository(ProgressReviewMeasurement),
      dataSource.getRepository(MeasurementLog),
      dataSource.getRepository(AttendanceRecord),
      dataSource,
      tenant,
      assignments,
      outbox,
    );

    useOrgA();
  });

  afterAll(async () => {
    if (!dataSource?.isInitialized) {
      return;
    }
    const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);
    await q(
      `DELETE FROM "WORKOUTS_PROGRESS_REVIEW_MEASUREMENTS" rpm
       USING "WORKOUTS_PROGRESS_REVIEWS" pr
       WHERE rpm."review_id" = pr."id" AND pr."organization_id" IN ($1,$2)`,
      [ids.orgA, ids.orgB],
    );
    await q(`DELETE FROM "WORKOUTS_PROGRESS_REVIEWS" WHERE "organization_id" IN ($1,$2)`, [ids.orgA, ids.orgB]);
    await q(`DELETE FROM "WORKOUTS_PLAN_DAY_REVIEWS" WHERE "organization_id" IN ($1,$2)`, [ids.orgA, ids.orgB]);
    await q(
      `DELETE FROM "WORKOUTS_PLAN_DAY_SUBMISSION_EXERCISES" se
       USING "WORKOUTS_PLAN_DAY_SUBMISSIONS" s
       WHERE se."submission_id" = s."id" AND s."organization_id" IN ($1,$2)`,
      [ids.orgA, ids.orgB],
    );
    await q(`DELETE FROM "WORKOUTS_PLAN_DAY_SUBMISSIONS" WHERE "organization_id" IN ($1,$2)`, [ids.orgA, ids.orgB]);
    await q(
      `DELETE FROM "WORKOUTS_WORKOUT_SESSION_EXERCISES" se
       USING "WORKOUTS_WORKOUT_SESSIONS" s
       WHERE se."session_id" = s."id" AND s."organization_id" IN ($1,$2)`,
      [ids.orgA, ids.orgB],
    );
    await q(`DELETE FROM "WORKOUTS_WORKOUT_SESSIONS" WHERE "organization_id" IN ($1,$2)`, [ids.orgA, ids.orgB]);
    await q(
      `DELETE FROM "WORKOUTS_PRESCRIBED_DAY_EXERCISES" pde
       USING "WORKOUTS_PRESCRIBED_DAYS" pd
       WHERE pde."prescribed_day_id" = pd."id" AND pd."organization_id" IN ($1,$2)`,
      [ids.orgA, ids.orgB],
    );
    await q(`DELETE FROM "WORKOUTS_PRESCRIBED_DAYS" WHERE "organization_id" IN ($1,$2)`, [ids.orgA, ids.orgB]);
    await q(`DELETE FROM "WORKOUTS_WORKOUT_PLAN_ASSIGNMENTS" WHERE "organization_id" IN ($1,$2)`, [ids.orgA, ids.orgB]);
    await q(
      `DELETE FROM "WORKOUTS_WORKOUT_PLAN_TEMPLATE_DAYS" pd
       USING "WORKOUTS_WORKOUT_PLAN_TEMPLATES" pt
       WHERE pd."plan_template_id" = pt."id" AND pt."organization_id" IN ($1,$2)`,
      [ids.orgA, ids.orgB],
    );
    await q(`DELETE FROM "WORKOUTS_WORKOUT_PLAN_TEMPLATES" WHERE "organization_id" IN ($1,$2)`, [ids.orgA, ids.orgB]);
    await q(
      `DELETE FROM "WORKOUTS_WORKOUT_DAY_TEMPLATE_EXERCISES" de
       USING "WORKOUTS_WORKOUT_DAY_TEMPLATES" dt
       WHERE de."day_template_id" = dt."id" AND dt."organization_id" IN ($1,$2)`,
      [ids.orgA, ids.orgB],
    );
    await q(`DELETE FROM "WORKOUTS_WORKOUT_DAY_TEMPLATES" WHERE "organization_id" IN ($1,$2)`, [ids.orgA, ids.orgB]);
    await q(`DELETE FROM "WORKOUTS_EXERCISES" WHERE "organization_id" IN ($1,$2)`, [ids.orgA, ids.orgB]);
    await q(`DELETE FROM "MEMBERS_MEMBER_MEASUREMENTS" WHERE "organization_id" IN ($1,$2)`, [ids.orgA, ids.orgB]);
    await q(`DELETE FROM "ATTENDANCE_ATTENDANCE_RECORDS" WHERE "organization_id" IN ($1,$2)`, [ids.orgA, ids.orgB]);
    await q(`DELETE FROM "shared"."outbox" WHERE "correlationId" IN ($1,$2,$3)`, [
      ids.memberA1,
      ids.memberA2,
      ids.memberB1,
    ]);
    await q(`DELETE FROM "MEMBERS_MEMBERS" WHERE "organization_id" IN ($1,$2)`, [ids.orgA, ids.orgB]);
    await q(`DELETE FROM "TENANCY_BRANCHES" WHERE "organization_id" IN ($1,$2)`, [ids.orgA, ids.orgB]);
    await q(`DELETE FROM "TENANCY_ORGANIZATIONS" WHERE "id" IN ($1,$2)`, [ids.orgA, ids.orgB]);

    await dataSource.destroy();
  });

  async function createExercise(name: string): Promise<string> {
    const exercise = await exercises.create(currentOrg, {
      name,
      description: `${name} description`,
    });
    created.exercises.push(exercise.id);
    return exercise.id;
  }

  async function createDayTemplate(
    name: string,
    rows: Array<{
      exercise_id: string;
      section: string;
      sets?: number;
      reps?: number;
      sort_order: number;
    }>,
  ): Promise<string> {
    const template = await templates.createDayTemplate(currentOrg, { name });
    created.dayTemplates.push(template.id);
    await templates.setDayTemplateExercises(currentOrg, template.id, {
      exercises: rows as never,
    });
    return template.id;
  }

  async function createPlanTemplate(
    name: string,
    days: Array<{
      day_order: number;
      day_template_id?: string;
      is_rest_day?: boolean;
      is_optional?: boolean;
      day_label?: string;
    }>,
  ): Promise<string> {
    const plan = await templates.createPlanTemplate(currentOrg, { name });
    created.planTemplates.push(plan.id);
    await templates.setPlanTemplateDays(currentOrg, plan.id, {
      days: days as never,
    });
    return plan.id;
  }

  let pushDayId: string;
  let pullDayId: string;
  let weeklyPlanId: string;
  let assignmentId: string;
  let pushDayPrescribedId: string;
  let restDayId: string;
  let pullDayPrescribedId: string;
  let optionalDayId: string;
  let exercise1: string;
  let exercise2: string;
  let exercise3: string;

  it('builds an org-scoped exercise library and reusable day/plan templates', async () => {
    exercise1 = await createExercise('Bench Press');
    exercise2 = await createExercise('Incline Press');
    exercise3 = await createExercise('Pull Up');

    pushDayId = await createDayTemplate('Push', [
      { exercise_id: exercise1, section: 'strength', sets: 3, reps: 12, sort_order: 1 },
      { exercise_id: exercise2, section: 'strength', sets: 3, reps: 10, sort_order: 2 },
    ]);
    pullDayId = await createDayTemplate('Pull', [
      { exercise_id: exercise3, section: 'strength', sets: 4, reps: 8, sort_order: 1 },
    ]);

    weeklyPlanId = await createPlanTemplate('Weekly', [
      { day_order: 1, day_template_id: pushDayId, day_label: 'Push' },
      { day_order: 2, is_rest_day: true, day_label: 'Rest' },
      { day_order: 3, day_template_id: pullDayId, day_label: 'Pull' },
      {
        day_order: 4,
        day_template_id: pushDayId,
        day_label: 'Push variation',
        is_optional: true,
      },
    ]);

    const detail = await templates.getPlanTemplate(currentOrg, weeklyPlanId);
    expect(detail.days.map((day) => day.day_order)).toEqual([1, 2, 3, 4]);
    expect(detail.days[0].day_template?.name).toBe('Push');
    expect(detail.days[1].is_rest_day).toBe(true);
    expect(detail.days[3].is_optional).toBe(true);
  });

  it('snapshots an assignment and preserves it when the reusable template is edited', async () => {
    const assignment = await assignments.assignPlanTemplate(
      currentOrg,
      ids.memberA1,
      {
        plan_template_id: weeklyPlanId,
        start_date: '2026-11-01',
        logging_mode: 'simple' as never,
      },
      ids.userA,
    );
    assignmentId = assignment.id;
    created.assignments.push(assignment.id);

    expect(assignment.template_id).toBeNull();
    expect(assignment.plan_template_id).toBe(weeklyPlanId);
    expect(assignment.snapshot_taken_at).toBeTruthy();

    const days = await assignments.listPrescribedDaysWithExercises(
      currentOrg,
      assignment.id,
    );
    expect(days).toHaveLength(4);
    pushDayPrescribedId = days[0].id;
    restDayId = days[1].id;
    pullDayPrescribedId = days[2].id;
    optionalDayId = days[3].id;
    expect(days[0].exercises).toHaveLength(2);
    expect(days[0].exercises[0].exercise_name_snapshot).toBe('Bench Press');
    expect(days[0].exercises[0].sets).toBe(3);
    expect(days[1].is_rest_day).toBe(true);

    // Edit the reusable day template after assignment.
    await templates.setDayTemplateExercises(currentOrg, pushDayId, {
      exercises: [
        {
          exercise_id: exercise1,
          section: 'strength' as never,
          sets: 5,
          reps: 5,
          sort_order: 1,
        },
      ],
    });

    const afterEdit = await assignments.listPrescribedDaysWithExercises(
      currentOrg,
      assignment.id,
    );
    expect(afterEdit[0].exercises).toHaveLength(2);
    expect(afterEdit[0].exercises[0].sets).toBe(3);
    expect(afterEdit[0].exercises[0].exercise_name_snapshot).toBe('Bench Press');
  });

  it('reuses the same template for a second member without changing the first plan', async () => {
    const second = await assignments.assignPlanTemplate(
      currentOrg,
      ids.memberA2,
      { plan_template_id: weeklyPlanId, start_date: '2026-11-01' },
      ids.userA,
    );
    created.assignments.push(second.id);

    const first = await assignments.getAssignmentDetail(currentOrg, assignmentId);
    const other = await assignments.getAssignmentDetail(currentOrg, second.id);
    expect(first.days).toHaveLength(4);
    expect(other.days).toHaveLength(4);
    expect(first.days[0].id).not.toBe(other.days[0].id);
    expect(first.assignment.member_id).toBe(ids.memberA1);
    expect(other.assignment.member_id).toBe(ids.memberA2);
  });

  it('computes 0% progress while nothing is trainer-approved and excludes rest days', async () => {
    const progress = await assignments.getProgressForAssignment(
      currentOrg,
      assignmentId,
    );
    expect(progress.prescribed).toBe(3);
    expect(progress.completed).toBe(0);
    expect(progress.percentage).toBe(0);
    expect(progress.status_counts.pending).toBe(3);
  });

  it('keeps a finished session separate from plan-day approval, and lets multiple sessions contribute', async () => {
    const sessionOne = await sessions.create(
      currentOrg,
      ids.memberA1,
      {
        prescribed_day_id: pushDayPrescribedId,
        session_date: '2026-11-02',
        exercises: [
          { exercise_id: exercise1, completed: true },
          { exercise_id: exercise2, completed: true },
        ],
      },
      ids.userA,
    );
    created.sessions.push(sessionOne.id);
    expect(sessionOne.status).toBe(WorkoutSessionStatus.IN_PROGRESS);

    await sessions.finish(currentOrg, sessionOne.id);
    const dayAfterFinish = await assignments.getPrescribedDay(
      currentOrg,
      pushDayPrescribedId,
    );
    expect(dayAfterFinish.status).toBe(PlanDayStatus.PENDING);
    const progressAfterFinish = await assignments.getProgressForAssignment(
      currentOrg,
      assignmentId,
    );
    expect(progressAfterFinish.percentage).toBe(0);

    const submission = await sessions.submitDay(
      currentOrg,
      pushDayPrescribedId,
      { notes: 'felt good' },
      ids.userA,
    );
    created.submissions.push(submission.id);
    expect(submission.exercises).toHaveLength(2);
    expect(submission.exercises.every((row) => row.completed === true)).toBe(true);

    const submittedDay = await assignments.getPrescribedDay(
      currentOrg,
      pushDayPrescribedId,
    );
    expect(submittedDay.status).toBe(PlanDayStatus.SUBMITTED);
    const progressAfterSubmit = await assignments.getProgressForAssignment(
      currentOrg,
      assignmentId,
    );
    expect(progressAfterSubmit.percentage).toBe(0);

    const review = await reviews.reviewDay(
      currentOrg,
      pushDayPrescribedId,
      { decision: PlanDayReviewDecision.APPROVE, notes: 'approved' },
      ids.userA,
    );
    created.planDayReviews.push(review.review.id);
    expect(review.day.status).toBe(PlanDayStatus.APPROVED);

    const approvedProgress = await assignments.getProgressForAssignment(
      currentOrg,
      assignmentId,
    );
    expect(approvedProgress.completed).toBe(1);
    expect(approvedProgress.prescribed).toBe(3);
    expect(approvedProgress.percentage).toBe(33);
  });

  it('keeps two sessions on one day as one day and preserves every submission', async () => {
    const secondDaySession = await sessions.create(
      currentOrg,
      ids.memberA1,
      {
        prescribed_day_id: pullDayPrescribedId,
        exercises: [{ exercise_id: exercise3, completed: true }],
      },
      ids.userA,
    );
    created.sessions.push(secondDaySession.id);
    await sessions.finish(currentOrg, secondDaySession.id);

    const remainingSession = await sessions.create(
      currentOrg,
      ids.memberA1,
      {
        prescribed_day_id: pullDayPrescribedId,
        exercises: [{ exercise_id: exercise3, completed: true }],
      },
      ids.userA,
    );
    created.sessions.push(remainingSession.id);
    await sessions.finish(currentOrg, remainingSession.id);

    const linked = await sessions.listPrescribedDaySessions(
      currentOrg,
      pullDayPrescribedId,
    );
    expect(linked).toHaveLength(2);

    const firstSubmission = await sessions.submitDay(
      currentOrg,
      pullDayPrescribedId,
      {},
      ids.userA,
    );
    created.submissions.push(firstSubmission.id);

    await reviews.reviewDay(
      currentOrg,
      pullDayPrescribedId,
      { decision: PlanDayReviewDecision.REQUEST_REMAINING },
      ids.userA,
    );
    const requested = await assignments.getPrescribedDay(
      currentOrg,
      pullDayPrescribedId,
    );
    expect(requested.status).toBe(PlanDayStatus.REMAINING_REQUIRED);

    const thirdSession = await sessions.create(
      currentOrg,
      ids.memberA1,
      {
        prescribed_day_id: pullDayPrescribedId,
        exercises: [{ exercise_id: exercise3, completed: true }],
      },
      ids.userA,
    );
    created.sessions.push(thirdSession.id);
    await sessions.finish(currentOrg, thirdSession.id);

    const secondSubmission = await sessions.submitDay(
      currentOrg,
      pullDayPrescribedId,
      { notes: 'remaining done' },
      ids.userA,
    );
    created.submissions.push(secondSubmission.id);

    const submissions = await sessions.listDaySubmissions(
      currentOrg,
      pullDayPrescribedId,
    );
    expect(submissions).toHaveLength(2);
    const progress = await assignments.getProgressForAssignment(
      currentOrg,
      assignmentId,
    );
    expect(progress.prescribed).toBe(3);
    expect(progress.completed).toBe(1);
    expect(progress.percentage).toBe(33);
  });

  it('allows a trainer to approve a missed day and reaches 100% only from approved days', async () => {
    const missed = await reviews.reviewDay(
      currentOrg,
      optionalDayId,
      { decision: PlanDayReviewDecision.APPROVE, notes: 'closed next day' },
      ids.userA,
    );
    created.planDayReviews.push(missed.review.id);
    expect(missed.review.submission_id).toBeNull();

    const progress = await assignments.getProgressForAssignment(
      currentOrg,
      assignmentId,
    );
    expect(progress.completed).toBe(2);
    expect(progress.prescribed).toBe(3);
    expect(progress.percentage).toBe(67);

    await reviews.reviewDay(
      currentOrg,
      pullDayPrescribedId,
      { decision: PlanDayReviewDecision.APPROVE },
      ids.userA,
    );
    const complete = await assignments.getProgressForAssignment(
      currentOrg,
      assignmentId,
    );
    expect(complete.completed).toBe(3);
    expect(complete.prescribed).toBe(3);
    expect(complete.percentage).toBe(100);
    expect(complete.status_counts.approved).toBe(3);
  });

  it('locks approved days against re-review and preserves review history', async () => {
    await expect(
      reviews.reviewDay(
        currentOrg,
        pushDayPrescribedId,
        { decision: PlanDayReviewDecision.APPROVE },
        ids.userA,
      ),
    ).rejects.toThrow(ConflictException);

    const history = await reviews.listDayReviews(currentOrg, pullDayPrescribedId);
    expect(history).toHaveLength(2);
    expect(history.map((review) => review.decision).sort()).toEqual(
      [PlanDayReviewDecision.APPROVE, PlanDayReviewDecision.REQUEST_REMAINING].sort(),
    );
  });

  it('does not let a standalone or cancelled session complete a plan day', async () => {
    const before = await assignments.getProgressForAssignment(
      currentOrg,
      assignmentId,
    );

    const standalone = await sessions.create(
      currentOrg,
      ids.memberA1,
      {
        exercises: [{ exercise_id: exercise1, completed: true }],
      },
      ids.userA,
    );
    created.sessions.push(standalone.id);
    await sessions.finish(currentOrg, standalone.id);

    const cancelled = await sessions.create(
      currentOrg,
      ids.memberA1,
      { notes: 'stopped early' },
      ids.userA,
    );
    created.sessions.push(cancelled.id);
    await sessions.cancel(currentOrg, cancelled.id);

    const after = await assignments.getProgressForAssignment(
      currentOrg,
      assignmentId,
    );
    expect(after).toEqual(before);
    expect(standalone.assignment_id).toBeNull();
    expect(standalone.prescribed_day_id).toBeNull();
  });

  it('soft-deletes a session without changing approved plan days or submission snapshots', async () => {
    const cancelled = await dataSource.getRepository(WorkoutSession).findOneOrFail({
      where: { member_id: ids.memberA1, status: WorkoutSessionStatus.CANCELLED },
    });

    const submissionsBefore = await sessions.listDaySubmissions(
      currentOrg,
      pullDayPrescribedId,
    );
    const progressBefore = await assignments.getProgressForAssignment(
      currentOrg,
      assignmentId,
    );

    const result = await sessions.softDelete(
      currentOrg,
      cancelled.id,
      ids.userA,
    );
    expect(result.success).toBe(true);

    await expect(sessions.getSession(currentOrg, cancelled.id)).rejects.toThrow(
      NotFoundException,
    );
    const visible = await sessions.listMemberSessions(currentOrg, ids.memberA1);
    expect(visible.some((session) => session.id === cancelled.id)).toBe(false);
    const withDeleted = await sessions.listMemberSessions(
      currentOrg,
      ids.memberA1,
      { include_deleted: true },
    );
    expect(withDeleted.some((session) => session.id === cancelled.id)).toBe(true);

    const submissionsAfter = await sessions.listDaySubmissions(
      currentOrg,
      pullDayPrescribedId,
    );
    expect(submissionsAfter).toEqual(submissionsBefore);
    const progressAfter = await assignments.getProgressForAssignment(
      currentOrg,
      assignmentId,
    );
    expect(progressAfter).toEqual(progressBefore);
  });

  it('snapshots a progress review with real attendance and existing measurements', async () => {
    const measurement = await dataSource.getRepository(MeasurementLog).save({
      organization_id: ids.orgA,
      member_id: ids.memberA1,
      measurement_type: MeasurementType.WEIGHT,
      value: 82,
      unit: 'kg',
      measured_at: new Date('2026-10-01T09:00:00Z'),
    });
    created.measurements.push(measurement.id);

    const attendance = await dataSource.getRepository(AttendanceRecord).save({
      organization_id: ids.orgA,
      member_id: ids.memberA1,
      check_in_time: new Date('2026-10-05T08:00:00Z'),
      check_in_method: 'manual',
    });
    created.attendance.push(attendance.id);

    const result = await reviews.createProgressReview(
      currentOrg,
      ids.memberA1,
      {
        assignment_id: assignmentId,
        review_date: '2026-11-01',
        period_start: '2026-09-15',
        period_end: '2026-11-01',
        decision: ProgressReviewDecision.CONTINUE,
        results: 'stronger',
        fitness_improvements: 'bench +10kg',
        goal_assessment: 'on track',
        observations: 'consistent',
        recommendations: 'continue',
        measurement_ids: [measurement.id],
      },
      ids.userA,
    );
    created.progressReviews.push(result.review.id);

    expect(result.review.approved_days).toBe(3);
    expect(result.review.prescribed_days).toBe(3);
    expect(result.review.progress_percentage).toBe(100);
    expect(result.review.plan_day_summary).toEqual({
      pending: 0,
      submitted: 0,
      remaining_required: 0,
      approved: 3,
      rest_days: 1,
    });
    expect(result.review.attendance_summary).toEqual(
      expect.objectContaining({
        source: 'attendance_records',
        total_check_ins: 1,
        distinct_visit_days: 1,
        methods: { manual: 1 },
      }),
    );
    expect(result.review.measurements).toHaveLength(1);
    expect(result.review.measurements[0].measurement_id).toBe(measurement.id);
    expect(Number(result.review.measurements[0].value)).toBe(82);

    // A later measurement must not rewrite the historical review.
    const later = await dataSource.getRepository(MeasurementLog).save({
      organization_id: ids.orgA,
      member_id: ids.memberA1,
      measurement_type: MeasurementType.WEIGHT,
      value: 79,
      unit: 'kg',
      measured_at: new Date('2026-11-01T09:00:00Z'),
    });
    created.measurements.push(later.id);

    const reread = await reviews.getProgressReview(currentOrg, result.review.id);
    expect(Number(reread.measurements[0].value)).toBe(82);

    // The attendance row is unchanged by the read-only snapshot.
    const attendanceAfter = await dataSource
      .getRepository(AttendanceRecord)
      .findOneByOrFail({ id: attendance.id });
    expect(attendanceAfter.check_in_method).toBe('manual');
  });

  it('links a review to a new assignment created in the same transaction', async () => {
    const nextPlanId = await createPlanTemplate('Next Level', [
      { day_order: 1, day_template_id: pullDayId, day_label: 'Pull' },
    ]);

    const result = await reviews.createProgressReview(
      currentOrg,
      ids.memberA1,
      {
        assignment_id: assignmentId,
        review_date: '2026-12-15',
        period_start: '2026-11-01',
        period_end: '2026-12-15',
        decision: ProgressReviewDecision.NEW_PLAN,
        next_assignment: {
          plan_template_id: nextPlanId,
          start_date: '2026-12-16',
        },
      },
      ids.userA,
    );
    created.progressReviews.push(result.review.id);
    expect(result.resulting_assignment).not.toBeNull();
    created.assignments.push(result.resulting_assignment!.id);

    const reread = await reviews.getProgressReview(currentOrg, result.review.id);
    expect(reread.resulting_assignment_id).toBe(
      result.resulting_assignment!.id,
    );

    const nextAssignment = await assignments.getAssignment(
      currentOrg,
      result.resulting_assignment!.id,
    );
    expect(nextAssignment.progress_review_id).toBe(result.review.id);

    // The earlier review is unchanged by the later plan.
    const earlier = await reviews.getProgressReview(
      currentOrg,
      created.progressReviews[0],
    );
    expect(earlier.approved_days).toBe(3);
    expect(earlier.resulting_assignment_id).toBeNull();
  });

  it('compares historical measurement snapshots across review dates', async () => {
    const comparison = await reviews.getComparison(currentOrg, ids.memberA1);
    expect(comparison.reviews.length).toBeGreaterThanOrEqual(2);
    const weightSeries = comparison.measurements.find(
      (series) => series.measurement_type === 'weight',
    );
    expect(weightSeries).toBeDefined();
    expect(weightSeries!.points).toHaveLength(1);
    expect(weightSeries!.points[0].value).toBe(82);
  });

  it('denies cross-organization reads and writes in both directions', async () => {
    useOrgB();

    await expect(
      assignments.getAssignment(ids.orgB, assignmentId),
    ).rejects.toThrow(NotFoundException);

    await expect(
      sessions.create(
        ids.orgB,
        ids.memberB1,
        { prescribed_day_id: pushDayPrescribedId },
        ids.userB,
      ),
    ).rejects.toThrow(NotFoundException);

    await expect(
      reviews.reviewDay(
        ids.orgB,
        pushDayPrescribedId,
        { decision: PlanDayReviewDecision.APPROVE },
        ids.userB,
      ),
    ).rejects.toThrow(NotFoundException);

    const sessionA = await dataSource
      .getRepository(WorkoutSession)
      .findOneOrFail({
        where: { organization_id: ids.orgA, member_id: ids.memberA1 },
      });
    await expect(
      sessions.softDelete(ids.orgB, sessionA.id, ids.userB),
    ).rejects.toThrow(NotFoundException);

    // Reverse direction: org A cannot read org B's exercise.
    useOrgA();
    await expect(
      exercises.findOne(
        ids.orgA,
        (
          await dataSource.getRepository(Exercise).save({
            organization_id: ids.orgB,
            name: 'Org B Only',
          })
        ).id,
      ),
    ).rejects.toThrow(NotFoundException);
  });

  it('does not let a member attach a session to another member\'s prescribed day', async () => {
    await expect(
      sessions.create(
        ids.orgA,
        ids.memberA2,
        { prescribed_day_id: pushDayPrescribedId },
        ids.userA,
      ),
    ).rejects.toThrow(NotFoundException);
  });

  it('emits no outbox event for a rejected mutation and one event per committed mutation', async () => {
    const outbox = dataSource.getRepository(OutboxEntity);
    const before = await outbox.count({
      where: { correlationId: ids.memberA2 },
    });

    await expect(
      assignments.assignPlanTemplate(
        currentOrg,
        ids.memberA2,
        { plan_template_id: weeklyPlanId, start_date: '2026-11-01' },
        ids.userA,
      ),
    ).rejects.toThrow(ConflictException);

    const afterRejected = await outbox.count({
      where: { correlationId: ids.memberA2 },
    });
    expect(afterRejected).toBe(before);

    const nextPlanId = await createPlanTemplate('Atomicity Plan', [
      { day_order: 1, day_template_id: pullDayId },
    ]);
    await assignments.assignPlanTemplate(
      currentOrg,
      ids.memberA2,
      { plan_template_id: nextPlanId, start_date: '2026-11-01' },
      ids.userA,
    );
    const afterCommitted = await outbox.count({
      where: { correlationId: ids.memberA2 },
    });
    expect(afterCommitted).toBe(before + 1);

    const event = await outbox.findOneOrFail({
      where: { correlationId: ids.memberA2 },
      order: { createdAt: 'DESC' },
    });
    const envelope = JSON.parse(event.payload);
    expect(envelope.eventType).toBe('WorkoutPlanAssigned');
    expect(envelope.eventVersion).toBe('v1');
    expect(envelope.payload.planTemplateId).toBe(nextPlanId);
  });

  it('keeps an in-progress session editable and locks a finished one', async () => {
    const session = await sessions.create(
      currentOrg,
      ids.memberA1,
      { exercises: [{ exercise_id: exercise1, completed: false }] },
      ids.userA,
    );
    created.sessions.push(session.id);

    const edited = await sessions.update(currentOrg, session.id, {
      notes: 'updated',
      exercises: [{ exercise_id: exercise1, completed: true }],
    });
    expect(edited.notes).toBe('updated');
    expect(edited.session_exercises).toHaveLength(1);
    expect(edited.session_exercises[0].completed).toBe(true);

    await sessions.finish(currentOrg, session.id);
    await expect(
      sessions.update(currentOrg, session.id, { notes: 'too late' }),
    ).rejects.toThrow(ConflictException);
    await expect(sessions.cancel(currentOrg, session.id)).rejects.toThrow(
      ConflictException,
    );
  });

  it('rejects an inverted review period and a measurement from another member', async () => {
    await expect(
      reviews.createProgressReview(
        currentOrg,
        ids.memberA1,
        {
          assignment_id: assignmentId,
          review_date: '2026-11-01',
          period_start: '2026-11-02',
          period_end: '2026-11-01',
          decision: ProgressReviewDecision.CONTINUE,
        },
        ids.userA,
      ),
    ).rejects.toThrow(BadRequestException);

    const foreignMeasurement = await dataSource.getRepository(MeasurementLog).save({
      organization_id: ids.orgA,
      member_id: ids.memberA2,
      measurement_type: MeasurementType.WEIGHT,
      value: 70,
      unit: 'kg',
      measured_at: new Date('2026-10-01T09:00:00Z'),
    });
    created.measurements.push(foreignMeasurement.id);

    await expect(
      reviews.createProgressReview(
        currentOrg,
        ids.memberA1,
        {
          assignment_id: assignmentId,
          review_date: '2026-11-01',
          period_start: '2026-09-15',
          period_end: '2026-11-01',
          decision: ProgressReviewDecision.CONTINUE,
          measurement_ids: [foreignMeasurement.id],
        },
        ids.userA,
      ),
    ).rejects.toThrow(NotFoundException);
  });
});
