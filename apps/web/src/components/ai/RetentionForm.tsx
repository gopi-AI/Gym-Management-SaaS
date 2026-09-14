'use client';

import React from 'react';
import Button from '@/components/ui/Button';
import {
  RETENTION_PERIODS,
  type Branch,
  type RetentionAnalysisRequest,
  type RetentionPeriod,
} from '@/lib';

const PERIOD_LABELS: Record<RetentionPeriod, string> = {
  '30d': 'Last 30 days',
  '90d': 'Last 90 days',
  '1y': 'Last 12 months',
};

interface RetentionFormProps {
  branches: Branch[];
  isPending: boolean;
  onSubmit: (payload: RetentionAnalysisRequest) => void;
}

/**
 * Retention-analysis controls.
 *
 * Purely presentational: it never talks to the API itself and can therefore be
 * rendered without triggering (billable) AI processing.
 */
export default function RetentionForm({ branches, isPending, onSubmit }: RetentionFormProps) {
  const [period, setPeriod] = React.useState<RetentionPeriod>('90d');
  const [branchId, setBranchId] = React.useState('');

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    // NOTE: no organization id is ever submitted — it comes from the route.
    onSubmit(branchId ? { period, branch_id: branchId } : { period });
  };

  return (
    <form onSubmit={handleSubmit}>
      <div className="mb-3">
        <label className="form-label" htmlFor="retention-period">
          Analysis period
        </label>
        <select
          id="retention-period"
          className="form-select"
          value={period}
          onChange={(event) => setPeriod(event.target.value as RetentionPeriod)}
        >
          {RETENTION_PERIODS.map((value) => (
            <option key={value} value={value}>
              {PERIOD_LABELS[value]}
            </option>
          ))}
        </select>
      </div>

      <div className="mb-3">
        <label className="form-label" htmlFor="retention-branch">
          Branch
        </label>
        <select
          id="retention-branch"
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
          Only members of the selected branch are analysed. The selection is
          re-verified against your branch access on the server.
        </div>
      </div>

      <div className="form-footer">
        <Button type="submit" variant="primary" loading={isPending}>
          {isPending ? 'Analyzing…' : 'Run analysis'}
        </Button>
      </div>
    </form>
  );
}
