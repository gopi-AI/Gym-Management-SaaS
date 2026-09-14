'use client';

import React from 'react';
import AppLayout from '@/components/layout/AppLayout';
import AuthGuard from '@/components/auth/AuthGuard';
import Alert from '@/components/ui/Alert';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/Card';
import Empty from '@/components/ui/Empty';
import { PageItem, Pagination } from '@/components/ui/Pagination';
import Table, { TBody, TBodyRow, Td, THead, THeadRow, Th } from '@/components/ui/Table';
import {
  ApiError,
  useAccessDecisions,
  useAttendanceRecords,
  useBranches,
  useCheckIn,
  useCheckOut,
  useMembers,
  type CheckInDeniedDetails,
} from '@/lib';

const PAGE_SIZE = 20;
const OPEN_LIST_LIMIT = 50;

/** Start of the current local day, as an ISO string for the API's `from` filter. */
function startOfToday(): string {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return now.toISOString();
}

function formatTime(value?: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleTimeString();
}

function formatDateTime(value?: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
}

/** How long a member has been inside, in whole minutes. */
function minutesSince(checkInTime: string, until: Date = new Date()): number {
  const start = new Date(checkInTime).getTime();
  if (Number.isNaN(start)) return 0;
  return Math.max(0, Math.round((until.getTime() - start) / 60000));
}

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

/**
 * Front-desk check-in / check-out.
 *
 * A refused check-in is NOT a silent failure: the API answers 403 with a
 * machine-readable `reason` (and still records the audit trail), so the desk sees
 * "Membership is paused" instead of a generic error.
 */
function CheckInContent() {
  const [memberId, setMemberId] = React.useState('');
  const [branchId, setBranchId] = React.useState('');
  const [notice, setNotice] = React.useState<{
    type: 'success' | 'danger';
    message: string;
  } | null>(null);
  const [page, setPage] = React.useState(1);
  const [from] = React.useState(() => startOfToday());

  const { data: membersData, isLoading: membersLoading } = useMembers({ limit: 200 });
  const { data: branchesData } = useBranches();
  const {
    data: openData,
    isLoading: openLoading,
    isFetching: openFetching,
  } = useAttendanceRecords({ open_only: true, limit: OPEN_LIST_LIMIT });
  const {
    data: sessionsData,
    isLoading: sessionsLoading,
    isFetching: sessionsFetching,
    error: sessionsError,
  } = useAttendanceRecords({ from, page, limit: PAGE_SIZE });
  const { data: deniedData } = useAccessDecisions({ is_granted: false, limit: 5 });

  const members = membersData?.data ?? [];
  const branches = branchesData ?? [];
  const inside = openData?.data ?? [];
  const sessions = sessionsData?.data ?? [];
  const total = sessionsData?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const denied = deniedData?.data ?? [];

  const memberName = React.useMemo(() => {
    const index = new Map(members.map((m) => [m.id, `${m.first_name} ${m.last_name}`]));
    return (id: string) => index.get(id) ?? id;
  }, [members]);

  const describeFailure = (error: unknown, fallback: string): string => {
    if (error instanceof ApiError) {
      const details = error.details as CheckInDeniedDetails | undefined;
      return details?.message ?? error.message;
    }
    return fallback;
  };

  const checkIn = useCheckIn({
    onSuccess: (result) => {
      setMemberId('');
      setNotice({
        type: 'success',
        message: `Checked in at ${formatTime(result.record.check_in_time)}.`,
      });
    },
    onError: (error) => {
      // A refusal is a normal front-desk outcome: surface the reason verbatim.
      setNotice({ type: 'danger', message: describeFailure(error, 'Check-in failed.') });
    },
  });

  const checkOut = useCheckOut({
    onSuccess: (result) => {
      setNotice({
        type: 'success',
        message: `Checked out at ${formatTime(result.record.check_out_time)}.`,
      });
    },
    onError: (error) => {
      setNotice({ type: 'danger', message: describeFailure(error, 'Check-out failed.') });
    },
  });

  const handleCheckIn = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setNotice(null);
    if (!memberId) {
      setNotice({ type: 'danger', message: 'Select a member to check in.' });
      return;
    }
    checkIn.mutate({ member_id: memberId, branch_id: branchId || undefined });
  };

  return (
    <AppLayout
      title="Check-in"
      pretitle="Attendance"
      pageMenu="check-in"
      description="Record front-desk check-ins and check-outs. Membership eligibility is validated on every check-in."
    >
      {notice && (
        <Alert type={notice.type} dismissible onClose={() => setNotice(null)} className="mb-3">
          {notice.message}
        </Alert>
      )}

      <div className="row row-deck row-cards">
        <div className="col-lg-5">
          <Card>
            <CardHeader>
              <CardTitle>Check a member in</CardTitle>
            </CardHeader>
            <CardBody>
              <form onSubmit={handleCheckIn} className="row g-3">
                <div className="col-12">
                  <label className="form-label" htmlFor="checkin-member">
                    Member *
                  </label>
                  <select
                    id="checkin-member"
                    className="form-select"
                    value={memberId}
                    onChange={(e) => setMemberId(e.target.value)}
                    disabled={membersLoading}
                  >
                    <option value="">
                      {membersLoading ? 'Loading members…' : 'Select member'}
                    </option>
                    {members.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.first_name} {m.last_name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="col-12">
                  <label className="form-label" htmlFor="checkin-branch">
                    Branch
                  </label>
                  <select
                    id="checkin-branch"
                    className="form-select"
                    value={branchId}
                    onChange={(e) => setBranchId(e.target.value)}
                  >
                    <option value="">No branch</option>
                    {branches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="col-12">
                  <Button type="submit" variant="primary" disabled={checkIn.isPending}>
                    {checkIn.isPending ? 'Checking in…' : 'Check in'}
                  </Button>
                </div>
              </form>
              <p className="text-secondary mt-3 mb-0">
                The check-in time is stamped by the server, never by this screen.
              </p>
            </CardBody>
          </Card>

          <Card className="mt-3">
            <CardHeader>
              <CardTitle>Recently refused</CardTitle>
            </CardHeader>
            <CardBody>
              {denied.length === 0 ? (
                <Empty title="No refusals" description="Nobody has been refused entry recently." />
              ) : (
                <Table responsive>
                  <TBody>
                    {denied.map((decision) => (
                      <TBodyRow key={decision.id}>
                        <Td>
                          <Badge color="danger">{decision.reason ?? 'denied'}</Badge>
                        </Td>
                        <Td className="text-secondary">{formatDateTime(decision.decided_at)}</Td>
                      </TBodyRow>
                    ))}
                  </TBody>
                </Table>
              )}
            </CardBody>
          </Card>
        </div>

        <div className="col-lg-7">
          <Card>
            <CardHeader>
              <CardTitle>
                Currently inside <span className="text-secondary">({inside.length})</span>
              </CardTitle>
            </CardHeader>
            <CardBody>
              {openLoading ? (
                <Empty title="Loading…" description="Fetching members inside the gym." />
              ) : inside.length === 0 ? (
                <Empty title="Nobody is inside" description="Check-ins appear here immediately." />
              ) : (
                <Table striped hover responsive cardTable nowrap>
                  <THead>
                    <THeadRow>
                      <Th>Member</Th>
                      <Th>Since</Th>
                      <Th>Duration</Th>
                      <Th />
                    </THeadRow>
                  </THead>
                  <TBody>
                    {inside.map((record) => (
                      <TBodyRow key={record.id}>
                        <Td>{memberName(record.member_id)}</Td>
                        <Td>{formatTime(record.check_in_time)}</Td>
                        <Td>{formatDuration(minutesSince(record.check_in_time))}</Td>
                        <Td>
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => {
                              setNotice(null);
                              checkOut.mutate({ member_id: record.member_id });
                            }}
                            disabled={checkOut.isPending}
                          >
                            Check out
                          </Button>
                        </Td>
                      </TBodyRow>
                    ))}
                  </TBody>
                </Table>
              )}
              {openFetching && !openLoading && (
                <div className="text-secondary mt-2">Refreshing…</div>
              )}
            </CardBody>
          </Card>

          <Card className="mt-3">
            <CardHeader>
              <CardTitle>Today&apos;s sessions</CardTitle>
            </CardHeader>
            <CardBody>
              {sessionsError && (
                <Alert type="danger" className="mb-3">
                  {sessionsError instanceof ApiError
                    ? sessionsError.message
                    : 'Failed to load attendance records.'}
                </Alert>
              )}

              {sessionsLoading ? (
                <Empty title="Loading sessions…" description="Fetching today's attendance." />
              ) : sessions.length === 0 ? (
                <Empty
                  title="No sessions today"
                  description="Check a member in to start recording attendance."
                />
              ) : (
                <Table striped hover responsive cardTable nowrap>
                  <THead>
                    <THeadRow>
                      <Th>Member</Th>
                      <Th>Check-in</Th>
                      <Th>Check-out</Th>
                      <Th>Duration</Th>
                      <Th>Status</Th>
                    </THeadRow>
                  </THead>
                  <TBody>
                    {sessions.map((record) => (
                      <TBodyRow key={record.id}>
                        <Td>{memberName(record.member_id)}</Td>
                        <Td>{formatTime(record.check_in_time)}</Td>
                        <Td>{record.check_out_time ? formatTime(record.check_out_time) : '—'}</Td>
                        <Td>
                          {formatDuration(
                            record.check_out_time
                              ? minutesSince(record.check_in_time, new Date(record.check_out_time))
                              : minutesSince(record.check_in_time),
                          )}
                        </Td>
                        <Td>
                          {record.check_out_time ? (
                            <Badge color="secondary">closed</Badge>
                          ) : (
                            <Badge color="green">inside</Badge>
                          )}
                        </Td>
                      </TBodyRow>
                    ))}
                  </TBody>
                </Table>
              )}

              {total > 0 && (
                <div className="d-flex align-items-center mt-3">
                  <div className="text-secondary">
                    {sessionsFetching ? 'Loading…' : `${total} session${total === 1 ? '' : 's'}`}
                  </div>
                  <div className="ms-auto">
                    <Pagination>
                      <PageItem
                        disabled={page <= 1}
                        onClick={() => setPage((p) => Math.max(1, p - 1))}
                        aria-label="Previous page"
                      >
                        ‹
                      </PageItem>
                      <PageItem active>{page}</PageItem>
                      <PageItem disabled>of {totalPages}</PageItem>
                      <PageItem
                        disabled={page >= totalPages}
                        onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                        aria-label="Next page"
                      >
                        ›
                      </PageItem>
                    </Pagination>
                  </div>
                </div>
              )}
            </CardBody>
          </Card>
        </div>
      </div>
    </AppLayout>
  );
}

export default function CheckInPage() {
  return (
    <AuthGuard>
      <CheckInContent />
    </AuthGuard>
  );
}
