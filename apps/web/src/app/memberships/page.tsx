'use client';

import React from 'react';
import AppLayout from '@/components/layout/AppLayout';
import AuthGuard from '@/components/auth/AuthGuard';
import Alert from '@/components/ui/Alert';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import { Card, CardBody } from '@/components/ui/Card';
import Empty from '@/components/ui/Empty';
import { PageItem, Pagination } from '@/components/ui/Pagination';
import Table, { TBody, TBodyRow, Td, THead, THeadRow, Th } from '@/components/ui/Table';
import {
  ApiError,
  useBranches,
  useCreateMembership,
  useMembers,
  useMembershipPlans,
  useMemberships,
} from '@/lib';

const PAGE_SIZE = 20;

/* ── Status helpers ─────────────────────────────────────────────────────────────── */

const STATUS_COLOR: Record<string, string> = {
  active: 'green',
  paused: 'warning',
  frozen: 'primary',
  cancelled: 'secondary',
};

function StatusBadge({ status }: { status: string }) {
  return <Badge color={STATUS_COLOR[status] ?? 'secondary'}>{status}</Badge>;
}

function CreateMembershipFrom({ onSaved }: { onSaved: () => void }) {
  const [memberId, setMemberId] = React.useState('');
  const [planId, setPlanId] = React.useState('');
  const [branchId, setBranchId] = React.useState('');
  const [startDate, setStartDate] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState(false);

  const { data: membersData, isLoading: membersLoading } = useMembers({ limit: 200 });
  const { data: plansData, isLoading: plansLoading } = useMembershipPlans({ limit: 200 });
  const { data: branchesData, isLoading: branchesLoading } = useBranches();

  const members = membersData?.data ?? [];
  const plans = (plansData?.data ?? []).filter((p) => p.is_active);
  const branches = branchesData ?? [];

  const createMembership = useCreateMembership({
    onSuccess: () => {
      setMemberId(''); setPlanId(''); setBranchId(''); setStartDate('');
      setError(null); setSuccess(true); onSaved();
    },
    onError: (e) => { setError(e instanceof ApiError ? e.message : 'Failed to create membership.'); setSuccess(false); },
  });

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null); setSuccess(false);
    if (!memberId) { setError('Select a member.'); return; }
    if (!planId) { setError('Select a plan.'); return; }
    createMembership.mutate({
      member_id: memberId, plan_id: planId,
      branch_id: branchId || undefined, start_date: startDate || undefined,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="row g-3">
      {success && <div className="col-12"><Alert type="success" dismissible onClose={() => setSuccess(false)}>Membership created.</Alert></div>}
      {error && <div className="col-12"><Alert type="danger">{error}</Alert></div>}
      <div className="col-md-6">
        <label className="form-label" htmlFor="m-member">Member *</label>
        <select id="m-member" className="form-select" value={memberId} onChange={(e) => setMemberId(e.target.value)} disabled={membersLoading}>
          <option value="">{membersLoading ? 'Loading members…' : 'Select member'}</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>{m.first_name} {m.last_name}</option>
          ))}
        </select>
      </div>
      <div className="col-md-6">
        <label className="form-label" htmlFor="m-plan">Plan *</label>
        <select id="m-plan" className="form-select" value={planId} onChange={(e) => setPlanId(e.target.value)} disabled={plansLoading}>
          <option value="">{plansLoading ? 'Loading plans…' : 'Select plan'}</option>
          {plans.map((p) => (
            <option key={p.id} value={p.id}>{p.name} ({p.price} {p.currency})</option>
          ))}
        </select>
      </div>
      <div className="col-md-4">
        <label className="form-label" htmlFor="m-branch">Branch</label>
        <select id="m-branch" className="form-select" value={branchId} onChange={(e) => setBranchId(e.target.value)} disabled={branchesLoading}>
          <option value="">{branchesLoading ? 'Loading branches…' : 'No branch'}</option>
          {branches.map((b) => (
            <option key={b.id} value={b.id}>{b.name}</option>
          ))}
        </select>
      </div>
      <div className="col-md-4">
        <label className="form-label" htmlFor="m-start">Start date</label>
        <input id="m-start" className="form-control" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
      </div>
      <div className="col-12">
        <Button type="submit" loading={createMembership.isPending}>Create membership</Button>
      </div>
    </form>
  );
}
function MembershipsContent() {
  const [page, setPage] = React.useState(1);
  const [showCreate, setShowCreate] = React.useState(false);
  const [filterStatus, setFilterStatus] = React.useState('');

  const { data, isLoading, isError, error, isFetching } = useMemberships({ page, limit: PAGE_SIZE, status: filterStatus || undefined });

  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const memberships = data?.data ?? [];

  return (
    <AppLayout
      title="Memberships"
      pretitle="Management"
      pageMenu="memberships"
      headerActions={
        <Button variant="primary" onClick={() => setShowCreate((s) => !s)}>
          {showCreate ? 'Cancel' : 'Add membership'}
        </Button>
      }
    >
      {showCreate && (
        <Card className="mb-3">
          <CardBody>
            <h3 className="card-title mb-3">Create membership</h3>
            <CreateMembershipFrom onSaved={() => { setPage(1); setShowCreate(false); }} />
          </CardBody>
        </Card>
      )}

      <Card>
        <CardBody>
          {/* Status filter */}
          <div className="row g-2 align-items-center mb-3">
            <div className="col-auto">
              <label className="form-label mb-0" htmlFor="status-filter">Status:</label>
            </div>
            <div className="col-auto">
              <select id="status-filter" className="form-select" value={filterStatus} onChange={(e) => { setFilterStatus(e.target.value); setPage(1); }}>
                <option value="">All</option>
                <option value="active">Active</option>
                <option value="paused">Paused</option>
                <option value="frozen">Frozen</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>
          </div>

          {isError && (
            <Alert type="danger" className="mb-3">
              {error instanceof ApiError ? error.message : 'Failed to load memberships.'}
            </Alert>
          )}

          {isLoading ? (
            <Empty title="Loading memberships…" description="Fetching membership list." />
          ) : memberships.length === 0 ? (
            <Empty
              title="No memberships found"
              description={filterStatus ? `No memberships with status "${filterStatus}".` : 'Get started by creating your first membership.'}
              action={<Button variant="primary" onClick={() => setShowCreate(true)}>Add membership</Button>}
            />
          ) : (
            <Table striped hover responsive cardTable nowrap>
              <THead>
                <THeadRow>
                  <Th>Member ID</Th>
                  <Th>Plan ID</Th>
                  <Th>Status</Th>
                  <Th>Start date</Th>
                  <Th>End date</Th>
                  <Th>Branch ID</Th>
                  <Th />
                </THeadRow>
              </THead>
              <TBody>
                {memberships.map((m) => (
                  <TBodyRow key={m.id}>
                    <Td style={{ maxWidth: 120 }} className="text-truncate">{m.member_id}</Td>
                    <Td style={{ maxWidth: 120 }} className="text-truncate">{m.plan_id ?? '—'}</Td>
                    <Td><StatusBadge status={m.status} /></Td>
                    <Td>{m.start_date}</Td>
                    <Td>{m.end_date ?? '—'}</Td>
                    <Td className="text-truncate" style={{ maxWidth: 120 }}>{m.branch_id ?? '—'}</Td>
                    <Td><a className="btn btn-sm btn-outline-primary" href={`/memberships/${m.id}`}>View</a></Td>
                  </TBodyRow>
                ))}
              </TBody>
            </Table>
          )}

          {total > 0 && (
            <div className="d-flex align-items-center mt-3">
              <div className="text-secondary">{isFetching ? 'Loading…' : `${total} membership${total === 1 ? '' : 's'}`}</div>
              <div className="ms-auto">
                <Pagination>
                  <PageItem disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} aria-label="Previous page">‹</PageItem>
                  <PageItem active>{page}</PageItem>
                  <PageItem disabled>of {totalPages}</PageItem>
                  <PageItem disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))} aria-label="Next page">›</PageItem>
                </Pagination>
              </div>
            </div>
          )}
        </CardBody>
      </Card>
    </AppLayout>
  );
}

export default function MembershipsPage() {
  return (
    <AuthGuard>
      <MembershipsContent />
    </AuthGuard>
  );
}
