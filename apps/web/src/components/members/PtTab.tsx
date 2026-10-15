'use client';

import React from 'react';
import Alert from '@/components/ui/Alert';
import Badge from '@/components/ui/Badge';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/Card';
import Empty from '@/components/ui/Empty';
import Table, { TBody, TBodyRow, Td, THead, THeadRow, Th } from '@/components/ui/Table';
import { ApiError, useMemberPtTab } from '@/lib';

const ENROLLMENT_STATUS_COLOR: Record<string, string> = {
  active: 'green',
  completed: 'secondary',
  cancelled: 'red',
};

const SESSION_STATUS_COLOR: Record<string, string> = {
  scheduled: 'azure',
  completed: 'green',
  cancelled: 'secondary',
  no_show: 'red',
};

interface PtTabProps {
  memberId: string;
  /** True while this tab is selected; the query only runs then (P2-09). */
  active: boolean;
}

/**
 * PT tab — `GET /v1/members/:memberId/pt`.
 *
 * Two accepted shape gaps are handled here rather than papered over:
 * `trainer_id` is rendered as-is (the response carries no hydrated trainer
 * identity — see the P2-04 note in `docs/task-backlog.md`), and
 * `sessions_remaining` is derived as `session_count - sessions_used` because
 * the backend's getter is not part of the serialised response.
 */
export default function PtTab({ memberId, active }: PtTabProps) {
  const { data, isPending, isError, error } = useMemberPtTab(memberId, { enabled: active });

  if (isPending) {
    return <Empty title="Loading PT data…" description="Fetching enrollments and sessions." />;
  }

  if (isError) {
    return (
      <Alert type="danger">
        {error instanceof ApiError ? error.message : 'Failed to load personal-training data.'}
      </Alert>
    );
  }

  const enrollments = data?.enrollments ?? [];
  const sessions = data?.sessions ?? [];
  const workoutProgress = data?.workoutProgress ?? [];

  return (
    <>
      <Card className="mb-3">
        <CardHeader>
          <CardTitle>Enrollments</CardTitle>
        </CardHeader>
        <CardBody>
          {enrollments.length === 0 ? (
            <Empty
              title="No PT enrollments"
              description="This member has no personal-training packages."
            />
          ) : (
            <Table striped hover responsive cardTable nowrap>
              <THead>
                <THeadRow>
                  <Th>Package ID</Th>
                  <Th>Trainer ID</Th>
                  <Th>Sessions used</Th>
                  <Th>Remaining</Th>
                  <Th>Status</Th>
                  <Th>Start</Th>
                  <Th>End</Th>
                </THeadRow>
              </THead>
              <TBody>
                {enrollments.map((enrollment) => (
                  <TBodyRow key={enrollment.id}>
                    <Td className="text-truncate" style={{ maxWidth: 120 }}>
                      {enrollment.package_id}
                    </Td>
                    <Td className="text-truncate" style={{ maxWidth: 120 }}>
                      {enrollment.trainer_id}
                    </Td>
                    <Td>
                      {enrollment.sessions_used} / {enrollment.session_count}
                    </Td>
                    <Td>{Math.max(0, enrollment.session_count - enrollment.sessions_used)}</Td>
                    <Td>
                      <Badge color={ENROLLMENT_STATUS_COLOR[enrollment.status] ?? 'secondary'}>
                        {enrollment.status}
                      </Badge>
                    </Td>
                    <Td>{enrollment.start_date}</Td>
                    <Td>{enrollment.end_date ?? '—'}</Td>
                  </TBodyRow>
                ))}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>

      <Card className="mb-3">
        <CardHeader>
          <CardTitle>Sessions</CardTitle>
        </CardHeader>
        <CardBody>
          {sessions.length === 0 ? (
            <Empty
              title="No PT sessions"
              description="No sessions have been scheduled for this member."
            />
          ) : (
            <Table striped hover responsive cardTable nowrap>
              <THead>
                <THeadRow>
                  <Th>Scheduled start</Th>
                  <Th>Scheduled end</Th>
                  <Th>Trainer ID</Th>
                  <Th>Status</Th>
                  <Th>Notes</Th>
                </THeadRow>
              </THead>
              <TBody>
                {sessions.map((session) => (
                  <TBodyRow key={session.id}>
                    <Td>{new Date(session.scheduled_start).toLocaleString()}</Td>
                    <Td>{new Date(session.scheduled_end).toLocaleString()}</Td>
                    <Td className="text-truncate" style={{ maxWidth: 120 }}>
                      {session.trainer_id}
                    </Td>
                    <Td>
                      <Badge color={SESSION_STATUS_COLOR[session.status] ?? 'secondary'}>
                        {session.status}
                      </Badge>
                    </Td>
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
          <CardTitle>Workout progress</CardTitle>
        </CardHeader>
        <CardBody>
          {workoutProgress.length === 0 ? (
            <Empty
              title="No workout assignments"
              description="This member has no assigned workout plans."
            />
          ) : (
            <Table striped hover responsive cardTable nowrap>
              <THead>
                <THeadRow>
                  <Th>Plan ID</Th>
                  <Th>Completed</Th>
                  <Th>Prescribed</Th>
                  <Th>Progress</Th>
                </THeadRow>
              </THead>
              <TBody>
                {workoutProgress.map((item) => (
                  <TBodyRow key={item.assignment.id}>
                    <Td className="text-truncate" style={{ maxWidth: 120 }}>
                      {item.assignment.template_id}
                    </Td>
                    <Td>{item.progress.completed}</Td>
                    <Td>{item.progress.prescribed}</Td>
                    <Td style={{ minWidth: 160 }}>
                      <div
                        className="progress progress-sm"
                        role="progressbar"
                        aria-valuenow={item.progress.percentage}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-label="Workout progress"
                      >
                        <div
                          className="progress-bar"
                          style={{ width: `${item.progress.percentage}%` }}
                        />
                      </div>
                      <div className="text-secondary small">{item.progress.percentage}%</div>
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
