'use client';

import React from 'react';
import Alert from '@/components/ui/Alert';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/Card';
import Empty from '@/components/ui/Empty';
import Table, { TBody, TBodyRow, Td, THead, THeadRow, Th } from '@/components/ui/Table';
import {
  ApiError,
  useCreateProgressReview,
  useDeleteWorkoutSession,
  useMemberAttendanceHistory,
  useMemberMeasurements,
  useMemberProgressReviews,
  useMemberWorkoutSessions,
  useMemberWorkoutsTab,
  usePlanTemplates,
  usePrescribedDay,
  useReviewPrescribedDay,
  useWorkoutProgressComparison,
  useWorkoutSequence,
} from '@/lib';

const STATUS_COLOR: Record<string, string> = {
  active: 'green',
  completed: 'secondary',
  expired: 'secondary',
  in_progress: 'blue',
  finished: 'green',
  cancelled: 'secondary',
  pending: 'secondary',
  submitted: 'blue',
  remaining_required: 'warning',
  approved: 'green',
};

const REVIEW_DECISION_LABEL: Record<string, string> = {
  approve: 'Approved',
  request_remaining: 'Remaining requested',
  continue: 'Continue plan',
  modify: 'Modify plan',
  extend: 'Extend plan',
  new_plan: 'New plan',
};

function dayTypeLabel(day: { is_rest_day: boolean; is_optional: boolean }): string {
  if (day.is_rest_day) return 'Rest';
  return day.is_optional ? 'Optional training' : 'Training';
}

interface WorkoutsTabProps {
  memberId: string;
  /** True while this tab is selected; the queries only run then (P2-09). */
  active: boolean;
}

/**
 * Workouts tab — the Member 360 workout surface (P2-05).
 *
 * The primary progress measure shown is trainer-approved prescribed days /
 * prescribed non-rest days. Exercise completion is displayed separately as the
 * supporting metric. The tab also drives the trainer review actions: approve a
 * day or request the remaining exercises, and record a 30–45-day progress
 * review. Attendance is read-only; the backend attendance module remains the
 * source of truth.
 */
export default function WorkoutsTab({ memberId, active }: WorkoutsTabProps) {
  const tabQuery = useMemberWorkoutsTab(memberId, { enabled: active });
  const sequenceQuery = useWorkoutSequence(memberId, { enabled: active });
  const sessionsQuery = useMemberWorkoutSessions(memberId, {}, { enabled: active });
  const reviewsQuery = useMemberProgressReviews(memberId, { enabled: active });
  const comparisonQuery = useWorkoutProgressComparison(memberId, {
    enabled: active,
  });
  const measurementsQuery = useMemberMeasurements(
    memberId,
    { limit: 20 },
    { enabled: active },
  );
  const planTemplatesQuery = usePlanTemplates({ enabled: active });
  const attendanceQuery = useMemberAttendanceHistory(
    memberId,
    { limit: 31 },
    { enabled: active },
  );

  const sequence = Array.isArray(sequenceQuery.data) ? sequenceQuery.data : [];
  const activeEntry =
    sequence.find((entry) => entry.current_day_id) ?? sequence[0];
  const currentDayId = activeEntry?.current_day_id ?? '';
  const dayQuery = usePrescribedDay(currentDayId, {
    enabled: active && Boolean(currentDayId),
  });

  const reviewDay = useReviewPrescribedDay();
  const deleteSession = useDeleteWorkoutSession();
  const createProgressReview = useCreateProgressReview();

  const [dayReviewNotes, setDayReviewNotes] = React.useState('');
  const [reviewDate, setReviewDate] = React.useState(
    new Date().toISOString().slice(0, 10),
  );
  const [periodStart, setPeriodStart] = React.useState('');
  const [periodEnd, setPeriodEnd] = React.useState('');
  const [reviewDecision, setReviewDecision] = React.useState<
    'continue' | 'modify' | 'extend' | 'new_plan'
  >('continue');
  const [reviewNotes, setReviewNotes] = React.useState('');
  const [nextPlanId, setNextPlanId] = React.useState('');
  const [nextPlanStart, setNextPlanStart] = React.useState('');
  const [selectedMeasurements, setSelectedMeasurements] = React.useState<string[]>(
    [],
  );

  if (tabQuery.isPending) {
    return (
      <Empty title="Loading workouts…" description="Fetching assignments and exercises." />
    );
  }

  if (tabQuery.isError) {
    return (
      <Alert type="danger">
        {tabQuery.error instanceof ApiError
          ? tabQuery.error.message
          : 'Failed to load workout data.'}
      </Alert>
    );
  }

  const assignments = tabQuery.data?.assignments ?? [];
  const sessions = sessionsQuery.data ?? tabQuery.data?.sessions ?? [];
  const exercises = tabQuery.data?.exercises ?? [];
  const reviews = reviewsQuery.data ?? [];
  const measurements = measurementsQuery.data?.data ?? [];
  const planTemplates = Array.isArray(planTemplatesQuery.data)
    ? planTemplatesQuery.data
    : [];
  const attendance = attendanceQuery.data;

  const day = dayQuery.data;
  const latestSubmission = day?.submissions[0];
  const latestReview = day?.reviews[0];

  const handleDayDecision = (decision: 'approve' | 'request_remaining'): void => {
    if (!currentDayId) return;
    reviewDay.mutate({
      dayId: currentDayId,
      decision,
      notes: dayReviewNotes.trim() || undefined,
    });
  };

  const toggleMeasurement = (id: string): void => {
    setSelectedMeasurements((current) =>
      current.includes(id)
        ? current.filter((value) => value !== id)
        : [...current, id],
    );
  };

  const handleCreateReview = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (!activeEntry || !periodStart || !periodEnd) return;
    createProgressReview.mutate({
      memberId,
      payload: {
        assignment_id: activeEntry.assignment.id,
        review_date: reviewDate,
        period_start: periodStart,
        period_end: periodEnd,
        decision: reviewDecision,
        observations: reviewNotes.trim() || undefined,
        measurement_ids:
          selectedMeasurements.length > 0 ? selectedMeasurements : undefined,
        next_assignment:
          reviewDecision === 'new_plan' && nextPlanId
            ? {
                plan_template_id: nextPlanId,
                start_date: nextPlanStart || reviewDate,
              }
            : undefined,
      },
    });
  };

  return (
    <>
      <Card className="mb-3">
        <CardHeader>
          <CardTitle>Assigned plans</CardTitle>
        </CardHeader>
        <CardBody>
          {assignments.length === 0 ? (
            <Empty
              title="No workout assignments"
              description="This member has no assigned workout plans."
            />
          ) : (
            <Table striped hover responsive cardTable nowrap>
              <THead>
                <THeadRow>
                  <Th>Plan</Th>
                  <Th>Status</Th>
                  <Th>Start</Th>
                  <Th>End</Th>
                  <Th>Approved days</Th>
                  <Th>Assigned by</Th>
                  <Th>Notes</Th>
                </THeadRow>
              </THead>
              <TBody>
                {assignments.map((assignment) => (
                  <TBodyRow key={assignment.id}>
                    <Td className="text-truncate" style={{ maxWidth: 160 }}>
                      {assignment.plan_template_id ?? assignment.template_id ?? '—'}
                    </Td>
                    <Td>
                      <Badge color={STATUS_COLOR[assignment.status] ?? 'secondary'}>
                        {assignment.status}
                      </Badge>
                    </Td>
                    <Td>{assignment.start_date}</Td>
                    <Td>{assignment.end_date ?? '—'}</Td>
                    <Td style={{ minWidth: 190 }}>
                      <div
                        className="progress progress-sm"
                        role="progressbar"
                        aria-valuenow={assignment.progress.percentage}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-label="Workout progress"
                      >
                        <div
                          className="progress-bar"
                          style={{ width: `${assignment.progress.percentage}%` }}
                        />
                      </div>
                      <div className="text-secondary small">
                        {assignment.progress.completed} / {assignment.progress.prescribed}{' '}
                        approved days ({assignment.progress.percentage}%)
                      </div>
                      {assignment.progress.exercise_completion && (
                        <div className="text-secondary small">
                          Exercise completion:{' '}
                          {assignment.progress.exercise_completion.completed} /{' '}
                          {assignment.progress.exercise_completion.prescribed} (
                          {assignment.progress.exercise_completion.percentage}%)
                        </div>
                      )}
                    </Td>
                    <Td>{assignment.assigned_by}</Td>
                    <Td>{assignment.notes ?? '—'}</Td>
                  </TBodyRow>
                ))}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>

      <Card className="mb-3">
        <CardHeader>
          <CardTitle>Rolling workout sequence</CardTitle>
        </CardHeader>
        <CardBody>
          {!activeEntry ? (
            <Empty
              title="No active workout sequence"
              description="Assign a weekly plan to start the rolling sequence."
            />
          ) : (
            <>
              <div className="text-secondary small mb-2">
                Plan {activeEntry.assignment.plan_template_id ?? activeEntry.assignment.template_id ?? '—'} ·
                current workout:{' '}
                {activeEntry.days.find((item) => item.id === activeEntry.current_day_id)
                  ?.name ?? '—'}
              </div>
              <Table striped hover responsive cardTable nowrap>
                <THead>
                  <THeadRow>
                    <Th>Order</Th>
                    <Th>Day</Th>
                    <Th>Type</Th>
                    <Th>Status</Th>
                  </THeadRow>
                </THead>
                <TBody>
                  {activeEntry.days.map((item) => (
                    <TBodyRow
                      key={item.id}
                      className={
                        item.id === activeEntry.current_day_id ? 'table-active' : ''
                      }
                    >
                      <Td>{item.sequence_order}</Td>
                      <Td>{item.name}</Td>
                      <Td>{dayTypeLabel(item)}</Td>
                      <Td>
                        <Badge color={STATUS_COLOR[item.status] ?? 'secondary'}>
                          {item.status}
                        </Badge>
                      </Td>
                    </TBodyRow>
                  ))}
                </TBody>
              </Table>
            </>
          )}

          {dayQuery.isError && (
            <Alert type="danger" className="mt-3">
              {dayQuery.error instanceof ApiError
                ? dayQuery.error.message
                : 'Failed to load the current workout day.'}
            </Alert>
          )}

          {day && (
            <div className="mt-3" data-testid="current-workout-day">
              <h3 className="card-title">{day.day.name}</h3>
              {day.day.exercises.length === 0 ? (
                <Empty
                  title="No exercises"
                  description="This day has no prescribed exercises."
                />
              ) : (
                <Table responsive cardTable nowrap>
                  <THead>
                    <THeadRow>
                      <Th>Exercise</Th>
                      <Th>Section</Th>
                      <Th>Prescribed</Th>
                      <Th>Instructions</Th>
                    </THeadRow>
                  </THead>
                  <TBody>
                    {day.day.exercises.map((exercise) => (
                      <TBodyRow key={exercise.id}>
                        <Td>{exercise.exercise_name_snapshot}</Td>
                        <Td>{exercise.section}</Td>
                        <Td>
                          {exercise.sets != null && exercise.reps != null
                            ? `${exercise.sets} × ${exercise.reps}`
                            : exercise.duration_seconds != null
                              ? `${exercise.duration_seconds}s`
                              : exercise.distance_meters != null
                                ? `${exercise.distance_meters}m`
                                : '—'}
                        </Td>
                        <Td>{exercise.instructions ?? '—'}</Td>
                      </TBodyRow>
                    ))}
                  </TBody>
                </Table>
              )}

              <div className="text-secondary small mt-2">
                Member submissions: {day.submissions.length}
                {latestSubmission ? ` · latest ${latestSubmission.submitted_at}` : ''}
                {' · '}Reviews: {day.reviews.length}
                {latestReview
                  ? ` · latest ${
                      REVIEW_DECISION_LABEL[latestReview.decision] ?? latestReview.decision
                    }`
                  : ''}
              </div>

              <div className="row g-2 align-items-end mt-2">
                <div className="col">
                  <label className="form-label" htmlFor="day-review-notes">
                    Trainer review notes
                  </label>
                  <input
                    id="day-review-notes"
                    className="form-control"
                    value={dayReviewNotes}
                    onChange={(event) => setDayReviewNotes(event.target.value)}
                  />
                </div>
                <div className="col-auto">
                  <Button
                    type="button"
                    variant="primary"
                    onClick={() => handleDayDecision('approve')}
                    disabled={reviewDay.isPending || day.day.status === 'approved'}
                  >
                    Approve day
                  </Button>
                </div>
                <div className="col-auto">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => handleDayDecision('request_remaining')}
                    disabled={reviewDay.isPending || day.day.status === 'approved'}
                  >
                    Request remaining
                  </Button>
                </div>
              </div>
              {reviewDay.isError && (
                <Alert type="danger" className="mt-2">
                  {reviewDay.error instanceof ApiError
                    ? reviewDay.error.message
                    : 'Failed to record the review.'}
                </Alert>
              )}
            </div>
          )}
        </CardBody>
      </Card>

      <Card className="mb-3">
        <CardHeader>
          <CardTitle>Session history</CardTitle>
        </CardHeader>
        <CardBody>
          {sessions.length === 0 ? (
            <Empty
              title="No workout sessions"
              description="No workout sessions have been logged for this member."
            />
          ) : (
            <Table striped hover responsive cardTable nowrap>
              <THead>
                <THeadRow>
                  <Th>Date</Th>
                  <Th>Status</Th>
                  <Th>Duration</Th>
                  <Th>Exercises</Th>
                  <Th>Notes</Th>
                  <Th>Actions</Th>
                </THeadRow>
              </THead>
              <TBody>
                {sessions.map((session) => (
                  <TBodyRow key={session.id}>
                    <Td>{session.session_date}</Td>
                    <Td>
                      <Badge color={STATUS_COLOR[session.status] ?? 'secondary'}>
                        {session.status}
                      </Badge>
                    </Td>
                    <Td>
                      {session.duration_minutes != null
                        ? `${session.duration_minutes} min`
                        : '—'}
                    </Td>
                    <Td>{session.session_exercises?.length ?? 0}</Td>
                    <Td>{session.notes ?? '—'}</Td>
                    <Td>
                      <Button
                        type="button"
                        variant="danger"
                        size="sm"
                        aria-label={`Delete session ${session.id}`}
                        disabled={deleteSession.isPending}
                        onClick={() => deleteSession.mutate(session.id)}
                      >
                        Delete
                      </Button>
                    </Td>
                  </TBodyRow>
                ))}
              </TBody>
            </Table>
          )}
          {deleteSession.isError && (
            <Alert type="danger" className="mt-2">
              {deleteSession.error instanceof ApiError
                ? deleteSession.error.message
                : 'Failed to delete the session.'}
            </Alert>
          )}
        </CardBody>
      </Card>

      <Card className="mb-3">
        <CardHeader>
          <CardTitle>Progress reviews</CardTitle>
        </CardHeader>
        <CardBody>
          {reviews.length === 0 ? (
            <Empty
              title="No progress reviews"
              description="No 30–45-day workout review has been recorded."
            />
          ) : (
            <Table striped hover responsive cardTable nowrap>
              <THead>
                <THeadRow>
                  <Th>Review date</Th>
                  <Th>Period</Th>
                  <Th>Approved / prescribed</Th>
                  <Th>Progress</Th>
                  <Th>Decision</Th>
                  <Th>Measurements</Th>
                </THeadRow>
              </THead>
              <TBody>
                {reviews.map((review) => (
                  <TBodyRow key={review.id}>
                    <Td>{review.review_date}</Td>
                    <Td>
                      {review.period_start} – {review.period_end}
                    </Td>
                    <Td>
                      {review.approved_days} / {review.prescribed_days}
                    </Td>
                    <Td>{review.progress_percentage}%</Td>
                    <Td>{REVIEW_DECISION_LABEL[review.decision] ?? review.decision}</Td>
                    <Td>{review.measurements.length}</Td>
                  </TBodyRow>
                ))}
              </TBody>
            </Table>
          )}

          {comparisonQuery.data && comparisonQuery.data.measurements.length > 0 && (
            <div className="mt-3" data-testid="measurement-comparison">
              <h4 className="card-title">Measurement comparison</h4>
              {comparisonQuery.data.measurements.map((series) => (
                <div key={`${series.measurement_type}-${series.unit}`} className="small">
                  <strong>{series.measurement_type}</strong> ({series.unit}):{' '}
                  {series.points
                    .map((point) => `${point.review_date}: ${point.value}`)
                    .join(' → ')}
                </div>
              ))}
            </div>
          )}

          {activeEntry && (
            <form className="mt-3" onSubmit={handleCreateReview}>
              <h4 className="card-title">Record a progress review</h4>
              <div className="row g-2">
                <div className="col-md-4">
                  <label className="form-label" htmlFor="review-date">
                    Review date
                  </label>
                  <input
                    id="review-date"
                    type="date"
                    className="form-control"
                    value={reviewDate}
                    onChange={(event) => setReviewDate(event.target.value)}
                    required
                  />
                </div>
                <div className="col-md-4">
                  <label className="form-label" htmlFor="review-period-start">
                    Period start
                  </label>
                  <input
                    id="review-period-start"
                    type="date"
                    className="form-control"
                    value={periodStart}
                    onChange={(event) => setPeriodStart(event.target.value)}
                    required
                  />
                </div>
                <div className="col-md-4">
                  <label className="form-label" htmlFor="review-period-end">
                    Period end
                  </label>
                  <input
                    id="review-period-end"
                    type="date"
                    className="form-control"
                    value={periodEnd}
                    onChange={(event) => setPeriodEnd(event.target.value)}
                    required
                  />
                </div>
                <div className="col-md-4">
                  <label className="form-label" htmlFor="review-decision">
                    Plan decision
                  </label>
                  <select
                    id="review-decision"
                    className="form-select"
                    value={reviewDecision}
                    onChange={(event) =>
                      setReviewDecision(
                        event.target.value as
                          | 'continue'
                          | 'modify'
                          | 'extend'
                          | 'new_plan',
                      )
                    }
                  >
                    <option value="continue">Continue</option>
                    <option value="modify">Modify</option>
                    <option value="extend">Extend</option>
                    <option value="new_plan">New plan</option>
                  </select>
                </div>
                <div className="col-md-8">
                  <label className="form-label" htmlFor="review-notes">
                    Observations and recommendations
                  </label>
                  <input
                    id="review-notes"
                    className="form-control"
                    value={reviewNotes}
                    onChange={(event) => setReviewNotes(event.target.value)}
                  />
                </div>
                {reviewDecision === 'new_plan' && (
                  <>
                    <div className="col-md-4">
                      <label className="form-label" htmlFor="review-next-plan">
                        Next plan template (optional)
                      </label>
                      <select
                        id="review-next-plan"
                        className="form-select"
                        value={nextPlanId}
                        onChange={(event) => setNextPlanId(event.target.value)}
                      >
                        <option value="">Do not assign yet</option>
                        {planTemplates.map((template) => (
                          <option key={template.id} value={template.id}>
                            {template.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="col-md-4">
                      <label className="form-label" htmlFor="review-next-start">
                        Next plan start
                      </label>
                      <input
                        id="review-next-start"
                        type="date"
                        className="form-control"
                        value={nextPlanStart}
                        onChange={(event) => setNextPlanStart(event.target.value)}
                      />
                    </div>
                  </>
                )}
              </div>

              {measurements.length > 0 && (
                <fieldset className="mt-2">
                  <legend className="form-label">Measurements used</legend>
                  {measurements.map((measurement) => (
                    <label key={measurement.id} className="form-check form-check-inline">
                      <input
                        className="form-check-input"
                        type="checkbox"
                        checked={selectedMeasurements.includes(measurement.id)}
                        onChange={() => toggleMeasurement(measurement.id)}
                      />
                      <span className="form-check-label">
                        {measurement.measurement_type} {measurement.value}{' '}
                        {measurement.unit} ({measurement.measured_at.slice(0, 10)})
                      </span>
                    </label>
                  ))}
                </fieldset>
              )}

              <Button
                type="submit"
                variant="primary"
                className="mt-2"
                disabled={createProgressReview.isPending}
              >
                Save progress review
              </Button>
              {createProgressReview.isError && (
                <Alert type="danger" className="mt-2">
                  {createProgressReview.error instanceof ApiError
                    ? createProgressReview.error.message
                    : 'Failed to record the progress review.'}
                </Alert>
              )}
              {createProgressReview.isSuccess && (
                <Alert type="success" className="mt-2">
                  Progress review recorded.
                </Alert>
              )}
            </form>
          )}
        </CardBody>
      </Card>

      <Card className="mb-3">
        <CardHeader>
          <CardTitle>Gym attendance (read-only)</CardTitle>
        </CardHeader>
        <CardBody>
          {attendanceQuery.isError ? (
            <Alert type="warning">
              {attendanceQuery.error instanceof ApiError
                ? attendanceQuery.error.message
                : 'Attendance is not available for this account.'}
            </Alert>
          ) : !attendance || attendance.data.length === 0 ? (
            <Empty
              title="No attendance records"
              description="The biometric/attendance source has no records for this member in the period."
            />
          ) : (
            <>
              <div className="text-secondary small mb-2">
                {attendance.total} check-in record(s) · {attendance.data.length} visit
                day(s)
              </div>
              <Table responsive cardTable nowrap>
                <THead>
                  <THeadRow>
                    <Th>Date</Th>
                    <Th>Check-ins</Th>
                    <Th>First</Th>
                    <Th>Last</Th>
                  </THeadRow>
                </THead>
                <TBody>
                  {attendance.data.map((point) => (
                    <TBodyRow key={point.date}>
                      <Td>{point.date}</Td>
                      <Td>{point.checkInCount}</Td>
                      <Td>{point.firstCheckIn ?? '—'}</Td>
                      <Td>{point.lastCheckIn ?? '—'}</Td>
                    </TBodyRow>
                  ))}
                </TBody>
              </Table>
            </>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Exercise library</CardTitle>
        </CardHeader>
        <CardBody>
          {exercises.length === 0 ? (
            <Empty
              title="No exercises"
              description="The organization's exercise library is empty."
            />
          ) : (
            <Table striped hover responsive cardTable nowrap>
              <THead>
                <THeadRow>
                  <Th>Name</Th>
                  <Th>Category</Th>
                  <Th>Muscle group</Th>
                  <Th>Equipment</Th>
                  <Th>Media</Th>
                  <Th>Status</Th>
                </THeadRow>
              </THead>
              <TBody>
                {exercises.map((exercise) => (
                  <TBodyRow key={exercise.id}>
                    <Td>{exercise.name}</Td>
                    <Td>{exercise.category ?? '—'}</Td>
                    <Td>{exercise.muscle_group ?? '—'}</Td>
                    <Td>{exercise.equipment_needed ?? '—'}</Td>
                    <Td>
                      {exercise.image_key ? 'Image ' : ''}
                      {exercise.gif_key ? 'GIF ' : ''}
                      {exercise.video_url ? 'Video' : ''}
                      {!exercise.image_key &&
                      !exercise.gif_key &&
                      !exercise.video_url
                        ? '—'
                        : ''}
                    </Td>
                    <Td>
                      <Badge color={exercise.is_active ? 'green' : 'secondary'}>
                        {exercise.is_active ? 'Active' : 'Inactive'}
                      </Badge>
                    </Td>
                  </TBodyRow>
                ))}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>
    </>
  );
}
