'use client';

import React from 'react';
import Button from '@/components/ui/Button';
import {
  PLAN_PERFORMANCE_PERIODS,
  type Branch,
  type PlanPerformancePeriod,
  type PlanPerformanceRequest,
} from '@/lib';

const PERIOD_LABELS: Record<PlanPerformancePeriod, string> = {
  '30d': 'Last 30 days',
  '90d': 'Last 90 days',
  '1y': 'Last 12 months',
};

interface PlanPerformanceFormProps {
  branches: Branch[];
  isPending: boolean;
  onSubmit: (payload: PlanPerformanceRequest) => void;
}

/**
 * Plan-performance controls.
 *
 * Purely presentational: it never talks to the API itself and can therefore be
 * rendered without triggering (billable) AI processing. The period scopes the
 * lifecycle transitions counted per plan.
 */
export default function PlanPerformanceForm({
  branches,
  isPending,
  onSubmit,
}: PlanPerformanceFormProps) {
  const [period, setPeriod] = React.useState<PlanPerformancePeriod>('90d');
  const [branchId, setBranchId] = React.useState('');

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    // NOTE: no organization id is ever submitted — it comes from the route.
    onSubmit(branchId ? { period, branch_id: branchId } : { period });
  };

  return (
    <form onSubmit={handleSubmit}>
      <div className="mb-3">
        <label className="form-label" htmlFor="plan-performance-period">
          Analysis period
        </label>
        <select
          id="plan-performance-period"
          className="form-select"
          value={period}
          onChange={(event) => setPeriod(event.target.value as PlanPerformancePeriod)}
        >
          {PLAN_PERFORMANCE_PERIODS.map((value) => (
            <option key={value} value={value}>
              {PERIOD_LABELS[value]}
            </option>
          ))}
        </select>
        <div className="form-hint">
          Lifecycle events (pauses, freezes, cancellations) are counted inside this window.
        </div>
      </div>

      <div className="mb-3">
        <label className="form-label" htmlFor="plan-performance-branch">
          Branch
        </label>
        <select
          id="plan-performance-branch"
          className="form-select"
          value={branchId}
          onChange={(event) => setBranchId(event.target.value)}
        >
          <option value="">All branches</option>
          {branches.map((branch) => (
            <option key={branch.id} value={branch.id}>
              {branch.name}
            </option>
          ))}
        </select>
        <div className="form-hint">
          Only memberships of the selected branch are counted. The selection is
          re-verified against your branch access on the server.
        </div>
      </div>

      <div className="form-footer">
        <Button type="submit" variant="primary" loading={isPending}>
          {isPending ? 'Analysing…' : 'Analyse plans'}
        </Button>
      </div>
    </form>
  );
}
