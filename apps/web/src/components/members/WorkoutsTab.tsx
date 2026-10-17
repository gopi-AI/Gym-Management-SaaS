'use client';

import React from 'react';
import Alert from '@/components/ui/Alert';
import Badge from '@/components/ui/Badge';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/Card';
import Empty from '@/components/ui/Empty';
import Table, { TBody, TBodyRow, Td, THead, THeadRow, Th } from '@/components/ui/Table';
import { ApiError, useMemberWorkoutsTab } from '@/lib';

const STATUS_COLOR: Record<string, string> = {
  active: 'green',
  completed: 'secondary',
  expired: 'secondary',
};

interface WorkoutsTabProps {
  memberId: string;
  /** True while this tab is selected; the query only runs then (P2-09). */
  active: boolean;
}

/**
 * Workouts tab — `GET /v1/members/:memberId/workouts`.
 *
 * `assignments` and `sessions` are member-scoped; `exercises` is the
 * organization-wide exercise library (the endpoint returns the whole
 * catalogue), and its card says so. `sessions` is empty until a workout-session
 * logger ships — the empty state is the correct state, not a failure.
 */
export default function WorkoutsTab({ memberId, active }: WorkoutsTabProps) {
  const { data, isPending, isError, error } = useMemberWorkoutsTab(memberId, { enabled: active });

  if (isPending) {
    return <Empty title="Loading workouts…" description="Fetching assignments and exercises." />;
  }

  if (isError) {
    return (
      <Alert type="danger">
        {error instanceof ApiError ? error.message : 'Failed to load workout data.'}
      </Alert>
    );
  }

  const assignments = data?.assignments ?? [];
  const sessions = data?.sessions ?? [];
  const exercises = data?.exercises ?? [];

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
                  <Th>Template ID</Th>
                  <Th>Status</Th>
                  <Th>Start</Th>
                  <Th>End</Th>
                  <Th>Progress</Th>
                  <Th>Assigned by</Th>
                  <Th>Notes</Th>
                </THeadRow>
              </THead>
              <TBody>
                {assignments.map((assignment) => (
                  <TBodyRow key={assignment.id}>
                    <Td className="text-truncate" style={{ maxWidth: 120 }}>
                      {assignment.template_id}
                    </Td>
                    <Td>
                      <Badge color={STATUS_COLOR[assignment.status] ?? 'secondary'}>
                        {assignment.status}
                      </Badge>
                    </Td>
                    <Td>{assignment.start_date}</Td>
                    <Td>{assignment.end_date ?? '—'}</Td>
                    <Td style={{ minWidth: 160 }}>
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
                        {assignment.progress.completed} / {assignment.progress.prescribed} (
                        {assignment.progress.percentage}%)
                      </div>
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
                  <Th>Duration</Th>
                  <Th>Exercises</Th>
                  <Th>Notes</Th>
                </THeadRow>
              </THead>
              <TBody>
                {sessions.map((session) => (
                  <TBodyRow key={session.id}>
                    <Td>{session.session_date}</Td>
                    <Td>
                      {session.duration_minutes != null
                        ? `${session.duration_minutes} min`
                        : '—'}
                    </Td>
                    <Td>{session.session_exercises?.length ?? 0}</Td>
                    <Td>{session.notes ?? '—'}</Td>
                  </TBodyRow>
                ))}
              </TBody>
            </Table>
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
