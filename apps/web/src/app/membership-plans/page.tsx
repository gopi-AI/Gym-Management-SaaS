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
import { ApiError, useCreateMembershipPlan, useMembershipPlans } from '@/lib';

const PAGE_SIZE = 20;
const SUPPORTED_CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'INR', 'JPY', 'AED'];
const SUPPORTED_BILLING_PERIODS = ['monthly', 'quarterly', 'half-yearly', 'yearly', 'one-time'];

function CreatePlanForm({ onSaved }: { onSaved: () => void }) {
  const [name, setName] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [price, setPrice] = React.useState('');
  const [currency, setCurrency] = React.useState('USD');
  const [billingPeriod, setBillingPeriod] = React.useState('monthly');
  const [durationDays, setDurationDays] = React.useState('30');
  const [trialDays, setTrialDays] = React.useState('0');
  const [error, setError] = React.useState<string | null>(null);

  const createPlan = useCreateMembershipPlan({
    onSuccess: () => {
      setName('');
      setDescription('');
      setPrice('');
      setCurrency('USD');
      setBillingPeriod('monthly');
      setDurationDays('30');
      setTrialDays('0');
      setError(null);
      onSaved();
    },
    onError: (e) => {
      setError(e instanceof ApiError ? e.message : 'Failed to create plan.');
    },
  });

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    if (!name.trim()) { setError('Name is required.'); return; }
    if (price === '' || Number.isNaN(Number(price)) || Number(price) < 0) {
      setError('Price must be a non-negative number.'); return;
    }
    const dur = Number(durationDays);
    if (!Number.isInteger(dur) || dur < 1) { setError('Duration must be a whole number >= 1.'); return; }
    const tr = Number(trialDays);
    if (!Number.isInteger(tr) || tr < 0) { setError('Trial days must be >= 0.'); return; }
    createPlan.mutate({
      name: name.trim(), description: description.trim() || undefined,
      price: String(price), currency, billing_period: billingPeriod,
      duration_days: dur, trial_days: tr,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="row g-3">
      {error && <div className="col-12"><Alert type="danger">{error}</Alert></div>}
      <div className="col-md-6">
        <label className="form-label" htmlFor="plan-name">Name *</label>
        <input id="plan-name" className="form-control" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Basic Monthly" />
      </div>
      <div className="col-md-6">
        <label className="form-label" htmlFor="plan-description">Description</label>
        <input id="plan-description" className="form-control" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional" />
      </div>
      <div className="col-md-3">
        <label className="form-label" htmlFor="plan-price">Price *</label>
        <input id="plan-price" className="form-control" type="number" min="0" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0.00" />
      </div>
      <div className="col-md-3">
        <label className="form-label" htmlFor="plan-currency">Currency *</label>
        <select id="plan-currency" className="form-select" value={currency} onChange={(e) => setCurrency(e.target.value)}>
          {SUPPORTED_CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>
      <div className="col-md-3">
        <label className="form-label" htmlFor="plan-billing-period">Billing period *</label>
        <select id="plan-billing-period" className="form-select" value={billingPeriod} onChange={(e) => setBillingPeriod(e.target.value)}>
          {SUPPORTED_BILLING_PERIODS.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>
      <div className="col-md-3">
        <label className="form-label" htmlFor="plan-duration">Duration (days) *</label>
        <input id="plan-duration" className="form-control" type="number" min="1" step="1" value={durationDays} onChange={(e) => setDurationDays(e.target.value)} />
      </div>
      <div className="col-md-3">
        <label className="form-label" htmlFor="plan-trial">Trial days</label>
        <input id="plan-trial" className="form-control" type="number" min="0" step="1" value={trialDays} onChange={(e) => setTrialDays(e.target.value)} />
      </div>
      <div className="col-12">
        <Button type="submit" loading={createPlan.isPending}>Create plan</Button>
      </div>
    </form>
  );
}

function MembershipPlansContent() {
  const [page, setPage] = React.useState(1);
  const [showCreate, setShowCreate] = React.useState(false);

  const { data, isLoading, isError, error, isFetching } = useMembershipPlans({ page, limit: PAGE_SIZE });

  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const plans = data?.data ?? [];

  return (
    <AppLayout
      title="Membership Plans"
      pretitle="Management"
      pageMenu="membership-plans"
      headerActions={
        <Button variant="primary" onClick={() => setShowCreate((s) => !s)}>
          {showCreate ? 'Cancel' : 'Add plan'}
        </Button>
      }
    >
      {showCreate && (
        <Card className="mb-3">
          <CardBody>
            <h3 className="card-title mb-3">Create membership plan</h3>
            <CreatePlanForm onSaved={() => setPage(1)} />
          </CardBody>
        </Card>
      )}

      <Card>
        <CardBody>
          {isError && (
            <Alert type="danger" className="mb-3">
              {error instanceof ApiError ? error.message : 'Failed to load membership plans.'}
            </Alert>
          )}

          {isLoading ? (
            <Empty title="Loading plans…" description="Fetching membership plans." />
          ) : plans.length === 0 ? (
            <Empty
              title="No membership plans found"
              description="Get started by creating your first membership plan."
              action={<Button variant="primary" onClick={() => setShowCreate(true)}>Add plan</Button>}
            />
          ) : (
            <Table striped hover responsive cardTable nowrap>
              <THead>
                <THeadRow>
                  <Th>Name</Th>
                  <Th>Price</Th>
                  <Th>Billing period</Th>
                  <Th>Duration</Th>
                  <Th>Trial</Th>
                  <Th>Status</Th>
                  <Th />
                </THeadRow>
              </THead>
              <TBody>
                {plans.map((plan) => (
                  <TBodyRow key={plan.id}>
                    <Td><a href={`/membership-plans/${plan.id}`}>{plan.name}</a></Td>
                    <Td>{plan.price} {plan.currency}</Td>
                    <Td>{plan.billing_period}</Td>
                    <Td>{plan.duration_days} days</Td>
                    <Td>{plan.trial_days} days</Td>
                    <Td><Badge color={plan.is_active ? 'green' : 'secondary'}>{plan.is_active ? 'Active' : 'Inactive'}</Badge></Td>
                    <Td><a className="btn btn-sm btn-outline-primary" href={`/membership-plans/${plan.id}`}>View</a></Td>
                  </TBodyRow>
                ))}
              </TBody>
            </Table>
          )}

          {total > 0 && (
            <div className="d-flex align-items-center mt-3">
              <div className="text-secondary">{isFetching ? 'Loading…' : `${total} plan${total === 1 ? '' : 's'}`}</div>
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

export default function MembershipPlansPage() {
  return (
    <AuthGuard>
      <MembershipPlansContent />
    </AuthGuard>
  );
}
