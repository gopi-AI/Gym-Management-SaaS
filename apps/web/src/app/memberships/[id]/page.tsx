'use client';

import React from 'react';
import { useParams, notFound } from 'next/navigation';
import AppLayout from '@/components/layout/AppLayout';
import AuthGuard from '@/components/auth/AuthGuard';
import Alert from '@/components/ui/Alert';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/Card';
import Empty from '@/components/ui/Empty';
import {
  ApiError,
  useMembership,
  useMembershipLifecycleAction,
  useUpdateMembership,
  useMember,
  useMembershipPlan,
  useBranches,
} from '@/lib';
import type { LifecycleActionRequest } from '@/lib';

/* ── Status helpers ─────────────────────────────────────────────────── */

const STATUS_COLOR: Record<string, string> = {
  active: 'green',
  paused: 'warning',
  frozen: 'primary',
  cancelled: 'secondary',
  expired: 'secondary',
};

/* ── Which lifecycle actions to show for each status ────────────────── */

interface ActionDef {
  action: string;
  label: string;
  color: 'primary' | 'danger' | 'warning';
}

const ACTIONS_BY_STATUS: Record<string, ActionDef[]> = {
  active: [
    { action: 'pause', label: 'Pause', color: 'warning' },
    { action: 'freeze', label: 'Freeze', color: 'primary' },
    { action: 'cancel', label: 'Cancel', color: 'danger' },
  ],
  paused: [
    { action: 'resume', label: 'Resume', color: 'primary' },
    { action: 'cancel', label: 'Cancel', color: 'danger' },
  ],
  frozen: [
    { action: 'unfreeze', label: 'Unfreeze', color: 'primary' },
    { action: 'cancel', label: 'Cancel', color: 'danger' },
  ],
  cancelled: [],
  expired: [],
};

function MembershipDetailContent({ membershipId }: { membershipId: string }) {
  const [editMode, setEditMode] = React.useState(false);
  const [editPlanId, setEditPlanId] = React.useState('');
  const [editBranchId, setEditBranchId] = React.useState('');
  const [editStartDate, setEditStartDate] = React.useState('');
  const [editEndDate, setEditEndDate] = React.useState('');
  const [lifecycleReason, setLifecycleReason] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState('');

  const {
    data: membership,
    isLoading,
    isError: isMembershipError,
    error: membershipError,
  } = useMembership(membershipId);

  const { data: member } = useMember(membership?.member_id ?? '', {
    enabled: !!membership?.member_id,
  });
  const { data: plan } = useMembershipPlan(membership?.plan_id ?? '', {
    enabled: !!membership?.plan_id,
  });
  const { data: branchesData } = useBranches();

  const branches = branchesData ?? [];

  const updateMembership = useUpdateMembership({
    onSuccess: () => {
      setEditMode(false);
      setSuccess('Membership updated.');
      setError(null);
    },
    onError: (e) => {
      setError(e instanceof ApiError ? e.message : 'Failed to update membership.');
    },
  });

  const lifecycleMutation = useMembershipLifecycleAction({
    onSuccess: () => {
      setLifecycleReason('');
      setSuccess('Action completed.');
      setError(null);
    },
    onError: (e) => {
      setError(e instanceof ApiError ? e.message : 'Action failed.');
    },
  });

  React.useEffect(() => {
    if (membership && !editMode) {
      setEditPlanId(membership.plan_id ?? '');
      setEditBranchId(membership.branch_id ?? '');
      setEditStartDate(membership.start_date ?? '');
      setEditEndDate(membership.end_date ?? '');
    }
  }, [membership, editMode]);

  if (isLoading) {
    return (
      <AppLayout title="Loading…" pageMenu="memberships">
        <Empty title="Loading membership…" description="Fetching details." />
      </AppLayout>
    );
  }

  if (isMembershipError || !membership) {
    if (membershipError && (membershipError as ApiError).status === 404) {
      notFound();
    }
    return (
      <AppLayout title="Error" pageMenu="memberships">
        <Alert type="danger">
          {membershipError instanceof ApiError ? membershipError.message : 'Failed to load membership.'}
        </Alert>
      </AppLayout>
    );
  }

  const actions = ACTIONS_BY_STATUS[membership.status] ?? [];

  const handleEdit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null); setSuccess('');
    updateMembership.mutate({
      id: membershipId,
      payload: {
        plan_id: editPlanId || undefined,
        branch_id: editBranchId || undefined,
        start_date: editStartDate || undefined,
        end_date: editEndDate || undefined,
      },
    });
  };

  const handleLifecycle = (action: string) => {
    setError(null); setSuccess('');
    const payload: LifecycleActionRequest = {};
    if (lifecycleReason.trim()) payload.reason = lifecycleReason.trim();
    lifecycleMutation.mutate({ id: membershipId, action, payload: action === 'cancel' ? payload : undefined });
  };

  return (
    <AppLayout
      title="Membership"
      pretitle="Membership detail"
      pageMenu="memberships"
      headerActions={
        <>
          <a className="btn btn-ghost" href="/memberships">Back to list</a>
          <Button variant="secondary" onClick={() => setEditMode((s) => !s)}>
            {editMode ? 'Cancel edit' : 'Edit'}
          </Button>
        </>
      }
    >
      {success && <Alert type="success" dismissible className="mb-3" onClose={() => setSuccess('')}>{success}</Alert>}
      {error && <Alert type="danger" className="mb-3">{error}</Alert>}

      <Card className="mb-3">
        <CardBody>
          <h3 className="card-title mb-3">Summary</h3>
          <div className="row g-3">
            <div className="col-md-3">
              <div className="text-secondary small">Status</div>
              <Badge color={STATUS_COLOR[membership.status] ?? 'secondary'}>{membership.status}</Badge>
            </div>
            <div className="col-md-3">
              <div className="text-secondary small">Member</div>
              <div>{member ? `${member.first_name} ${member.last_name}` : membership.member_id}</div>
            </div>
            <div className="col-md-3">
              <div className="text-secondary small">Plan</div>
              <div>{plan ? plan.name : membership.plan_id ?? '—'}</div>
            </div>
            <div className="col-md-3">
              <div className="text-secondary small">Branch</div>
              <div>{branches.find((b) => b.id === membership.branch_id)?.name ?? membership.branch_id ?? '—'}</div>
            </div>
            <div className="col-md-3">
              <div className="text-secondary small">Start date</div>
              <div>{membership.start_date}</div>
            </div>
            <div className="col-md-3">
              <div className="text-secondary small">End date</div>
              <div>{membership.end_date ?? '—'}</div>
            </div>
            <div className="col-md-3">
              <div className="text-secondary small">Price at signup</div>
              <div>{membership.price_at_signup ? `${membership.price_at_signup} ${membership.currency_at_signup ?? ''}` : '—'}</div>
            </div>
            <div className="col-md-3">
              <div className="text-secondary small">Created</div>
              <div>{new Date(membership.created_at).toLocaleString()}</div>
            </div>
          </div>
        </CardBody>
      </Card>

      {/* ── Lifecycle actions ────────────────────────────────────── */}
      {actions.length > 0 && (
        <Card className="mb-3">
          <CardHeader>
            <CardTitle>Lifecycle actions</CardTitle>
          </CardHeader>
          <CardBody>
            <div className="row g-2 align-items-end">
              <div className="col-md-5">
                <label className="form-label" htmlFor="lifecycle-reason">Reason (optional)</label>
                <input
                  id="lifecycle-reason"
                  className="form-control"
                  value={lifecycleReason}
                  onChange={(e) => setLifecycleReason(e.target.value)}
                  placeholder="e.g. member request"
                />
              </div>
              <div className="col">
                <div className="btn-list">
                  {actions.map((a) => (
                    <Button key={a.action} variant={a.color === 'danger' ? 'danger' : 'primary'}
                      onClick={() => handleLifecycle(a.action)} loading={lifecycleMutation.isPending}>
                      {a.label}
                    </Button>
                  ))}
                </div>
              </div>
            </div>
          </CardBody>
        </Card>
      )}

      {/* ── Edit membership ─────────────────────────────────────── */}
      {editMode && (
        <Card>
          <CardHeader><CardTitle>Edit membership</CardTitle></CardHeader>
          <CardBody>
            <form onSubmit={handleEdit} className="row g-3">
              <div className="col-md-6">
                <label className="form-label" htmlFor="edit-member">Member</label>
                <input id="edit-member" className="form-control" value={member ? `${member.first_name} ${member.last_name}` : membership.member_id} disabled />
              </div>
              <div className="col-md-6">
                <label className="form-label" htmlFor="edit-plan">Plan</label>
                <input id="edit-plan" className="form-control" value={plan ? `${plan.name} (${plan.price} ${plan.currency})` : membership.plan_id ?? ''} disabled />
              </div>
              <div className="col-md-6">
                <label className="form-label" htmlFor="edit-start">Start date</label>
                <input id="edit-start" className="form-control" type="date" value={editStartDate} onChange={(e) => setEditStartDate(e.target.value)} />
              </div>
              <div className="col-md-6">
                <label className="form-label" htmlFor="edit-end">End date</label>
                <input id="edit-end" className="form-control" type="date" value={editEndDate} onChange={(e) => setEditEndDate(e.target.value)} />
              </div>
              <div className="col-md-6">
                <label className="form-label" htmlFor="edit-branch">Branch</label>
                <select id="edit-branch" className="form-select" value={editBranchId} onChange={(e) => setEditBranchId(e.target.value)}>
                  <option value="">No branch</option>
                  {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </div>
              <div className="col-12">
                <Button type="submit" loading={updateMembership.isPending}>Save changes</Button>
              </div>
            </form>
          </CardBody>
        </Card>
      )}
    </AppLayout>
  );
}

export default function MembershipDetailPage() {
  const params = useParams();
  const membershipId = params?.id as string;
  if (!membershipId) notFound();
  return (
    <AuthGuard>
      <MembershipDetailContent membershipId={membershipId} />
    </AuthGuard>
  );
}
