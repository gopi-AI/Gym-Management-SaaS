'use client';

import React from 'react';
import { notFound, useParams } from 'next/navigation';
import AppLayout from '@/components/layout/AppLayout';
import AuthGuard from '@/components/auth/AuthGuard';
import Alert from '@/components/ui/Alert';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import { Card, CardBody } from '@/components/ui/Card';
import Empty from '@/components/ui/Empty';
import { ApiError, useMembershipPlan, useUpdateMembershipPlan } from '@/lib';

const SUPPORTED_CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'INR', 'JPY', 'AED'];
const SUPPORTED_BILLING_PERIODS = ['monthly', 'quarterly', 'half-yearly', 'yearly', 'one-time'];

function PlanEditForm({ planId }: { planId: string }) {
  const [name, setName] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [price, setPrice] = React.useState('');
  const [currency, setCurrency] = React.useState('USD');
  const [billingPeriod, setBillingPeriod] = React.useState('monthly');
  const [durationDays, setDurationDays] = React.useState('');
  const [trialDays, setTrialDays] = React.useState('');
  const [isActive, setIsActive] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState(false);
  const [loaded, setLoaded] = React.useState(false);

  const { data: plan, isLoading, isError, error: planError } = useMembershipPlan(planId);

  React.useEffect(() => {
    if (plan && !loaded) {
      setName(plan.name);
      setDescription(plan.description ?? '');
      setPrice(plan.price);
      setCurrency(plan.currency);
      setBillingPeriod(plan.billing_period);
      setDurationDays(String(plan.duration_days));
      setTrialDays(String(plan.trial_days));
      setIsActive(plan.is_active);
      setLoaded(true);
    }
  }, [plan, loaded]);

  const updatePlan = useUpdateMembershipPlan({
    onSuccess: () => {
      setSuccess(true);
      setError(null);
      setLoaded(false);
    },
    onError: (e) => {
      setError(e instanceof ApiError ? e.message : 'Failed to update plan.');
    },
  });

  if (isLoading) {
    return <Empty title="Loading plan…" description="Fetching plan details." />;
  }

  if (isError || !plan) {
    if (isError && planError instanceof Error && (planError as ApiError).status === 404) {
      notFound();
    }
    return (
      <Alert type="danger">
        {planError instanceof ApiError ? planError.message : 'Failed to load this plan.'}
      </Alert>
    );
  }

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setSuccess(false);
    if (!name.trim()) { setError('Name is required.'); return; }
    if (price === '' || Number.isNaN(Number(price)) || Number(price) < 0) {
      setError('Price must be a non-negative number.'); return;
    }
    const dur = Number(durationDays);
    if (!Number.isInteger(dur) || dur < 1) { setError('Duration must be a whole number >= 1.'); return; }
    const tr = Number(trialDays);
    if (!Number.isInteger(tr) || tr < 0) { setError('Trial days must be >= 0.'); return; }
    updatePlan.mutate({
      id: planId,
      payload: {
        name: name.trim(), description: description.trim() || undefined,
        price: String(price), currency, billing_period: billingPeriod,
        duration_days: dur, trial_days: tr, is_active: isActive,
      },
    });
  };

  return (
    <AppLayout
      title={plan.name}
      pretitle="Membership Plan"
      pageMenu="membership-plans"
      headerActions={
        <Badge color={plan.is_active ? 'green' : 'secondary'}>
          {plan.is_active ? 'Active' : 'Inactive'}
        </Badge>
      }
    >
      {success && <Alert type="success" dismissible className="mb-3" onClose={() => setSuccess(false)}>Plan updated successfully.</Alert>}
      {error && <Alert type="danger" className="mb-3">{error}</Alert>}

      <Card>
        <CardBody>
          <h3 className="card-title mb-3">Edit plan</h3>
          <form onSubmit={handleSubmit} className="row g-3">
            <div className="col-md-6">
              <label className="form-label" htmlFor="edit-name">Name *</label>
              <input id="edit-name" className="form-control" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="col-md-6">
              <label className="form-label" htmlFor="edit-description">Description</label>
              <input id="edit-description" className="form-control" value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
            <div className="col-md-3">
              <label className="form-label" htmlFor="edit-price">Price *</label>
              <input id="edit-price" className="form-control" type="number" min="0" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} />
            </div>
            <div className="col-md-3">
              <label className="form-label" htmlFor="edit-currency">Currency *</label>
              <select id="edit-currency" className="form-select" value={currency} onChange={(e) => setCurrency(e.target.value)}>
                {SUPPORTED_CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="col-md-3">
              <label className="form-label" htmlFor="edit-billing">Billing period *</label>
              <select id="edit-billing" className="form-select" value={billingPeriod} onChange={(e) => setBillingPeriod(e.target.value)}>
                {SUPPORTED_BILLING_PERIODS.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div className="col-md-3">
              <label className="form-label" htmlFor="edit-duration">Duration (days) *</label>
              <input id="edit-duration" className="form-control" type="number" min="1" step="1" value={durationDays} onChange={(e) => setDurationDays(e.target.value)} />
            </div>
            <div className="col-md-3">
              <label className="form-label" htmlFor="edit-trial">Trial days</label>
              <input id="edit-trial" className="form-control" type="number" min="0" step="1" value={trialDays} onChange={(e) => setTrialDays(e.target.value)} />
            </div>
            <div className="col-md-3">
              <label className="form-check">
                <input className="form-check-input" type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
                <span className="form-check-label">Active</span>
              </label>
            </div>
            <div className="col-12">
              <Button type="submit" loading={updatePlan.isPending}>Save changes</Button>
              <a className="btn btn-ghost ms-2" href="/membership-plans">Back to list</a>
            </div>
          </form>
        </CardBody>
      </Card>
    </AppLayout>
  );
}

export default function PlanDetailPage() {
  const params = useParams();
  const planId = params?.id as string;
  if (!planId) notFound();
  return (
    <AuthGuard>
      <PlanEditForm planId={planId} />
    </AuthGuard>
  );
}
