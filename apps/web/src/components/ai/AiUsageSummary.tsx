'use client';

import React from 'react';
import { Card, CardBody } from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import { formatGeneratedAt } from './RetentionSummary';
import type { AiUsageResponse, AiUsageWindow } from '@/lib';

interface AiUsageSummaryProps {
  usage: AiUsageResponse;
}

/** `0.0123` → `$0.012300`; keeps the ledger's 6-decimal precision readable. */
function formatUsd(value: number): string {
  return `$${value.toFixed(6)}`;
}

/** Renders `used / limit` plus a bounded progress bar; disabled limits are safe. */
function BudgetGauge({
  label,
  used,
  limit,
  remaining,
  format,
}: {
  label: string;
  used: number;
  limit: number;
  remaining: number | null;
  format: (value: number) => string;
}) {
  const disabled = limit <= 0;
  const percent = disabled ? 0 : Math.min(Math.round((used / limit) * 100), 100);

  return (
    <div className="mb-3">
      <div className="d-flex justify-content-between align-items-baseline">
        <div className="text-secondary">{label}</div>
        <div>
          {disabled ? (
            <Badge color="secondary">No limit</Badge>
          ) : (
            <span className="fw-bold">
              {format(used)} / {format(limit)}
            </span>
          )}
        </div>
      </div>
      {!disabled && (
        <>
          <div
            className="progress progress-sm mt-1"
            role="progressbar"
            aria-valuenow={percent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={label}
          >
            <div className="progress-bar" style={{ width: `${percent}%` }} />
          </div>
          <div className="text-secondary small mt-1">
            {percent}% used · {format(remaining ?? 0)} remaining
          </div>
        </>
      )}
    </div>
  );
}

function WindowStats({ title, window }: { title: string; window: AiUsageWindow }) {
  return (
    <Card>
      <CardBody>
        <h3 className="card-title">{title}</h3>
        <div className="row">
          <div className="col-6">
            <div className="text-secondary">Requests</div>
            <div className="h2 mb-0">{window.requests}</div>
          </div>
          <div className="col-6">
            <div className="text-secondary">Failed</div>
            <div className="h2 mb-0">{window.failed_requests}</div>
          </div>
          <div className="col-6 mt-2">
            <div className="text-secondary">Tokens</div>
            <div className="h2 mb-0">{window.total_tokens.toLocaleString()}</div>
          </div>
          <div className="col-6 mt-2">
            <div className="text-secondary">Estimated cost</div>
            <div className="h2 mb-0">{formatUsd(window.estimated_cost_usd)}</div>
          </div>
        </div>
        <div className="text-secondary small mt-2">
          Window <code>{window.label}</code> (UTC)
        </div>
      </CardBody>
    </Card>
  );
}

/**
 * Operator view of one organization's AI consumption.
 *
 * Everything shown is an aggregate computed by the server from the `AI_USAGE`
 * ledger for the AUTHORIZED organization: no prompt, response, key, user or
 * member identity is present in the payload, and the limits rendered here are
 * the limits the backend enforces.
 */
export default function AiUsageSummary({ usage }: AiUsageSummaryProps) {
  return (
    <>
      <div className="row row-cards mb-3">
        <div className="col-lg-6">
          <WindowStats title={`Today (${usage.day.label})`} window={usage.day} />
        </div>
        <div className="col-lg-6">
          <WindowStats title={`This month (${usage.month.label})`} window={usage.month} />
        </div>
      </div>

      <Card className="mb-3">
        <CardBody>
          <h3 className="card-title">Budget consumption</h3>
          <BudgetGauge
            label="Daily token budget"
            used={usage.quota.tokens_used_today}
            limit={usage.quota.token_limit_per_day}
            remaining={usage.quota.tokens_remaining_today}
            format={(value) => value.toLocaleString()}
          />
          <BudgetGauge
            label="Monthly cost budget"
            used={usage.quota.cost_used_this_month_usd}
            limit={usage.quota.cost_limit_per_month_usd}
            remaining={usage.quota.cost_remaining_this_month_usd}
            format={formatUsd}
          />
          <div className="text-secondary small">
            Rate limit {usage.limits.rate_limit_requests_per_minute} request(s) per{' '}
            {usage.limits.rate_limit_window_seconds}s per user, per use case. AI is{' '}
            <strong>{usage.ai_enabled ? 'enabled' : 'disabled'}</strong> for this deployment.
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardBody>
          <h3 className="card-title">By use case (this month)</h3>
          {usage.by_request_type.length === 0 ? (
            <p className="text-secondary mb-0">No AI usage recorded this month.</p>
          ) : (
            <div className="table-responsive">
              <table className="table table-vcenter">
                <thead>
                  <tr>
                    <th>Use case</th>
                    <th className="text-end">Requests</th>
                    <th className="text-end">Failed</th>
                    <th className="text-end">Tokens</th>
                    <th className="text-end">Estimated cost</th>
                  </tr>
                </thead>
                <tbody>
                  {usage.by_request_type.map((row) => (
                    <tr key={row.request_type}>
                      <td>
                        <code>{row.request_type}</code>
                      </td>
                      <td className="text-end">{row.requests}</td>
                      <td className="text-end">{row.failed_requests}</td>
                      <td className="text-end">{row.total_tokens.toLocaleString()}</td>
                      <td className="text-end">{formatUsd(row.estimated_cost_usd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="text-secondary small mt-2">
            Organization <code>{usage.organization_id}</code> · as of{' '}
            <time dateTime={usage.generated_at}>{formatGeneratedAt(usage.generated_at)}</time> ·
            aggregates only; prompts, responses, keys and identities are never exposed.
          </div>
        </CardBody>
      </Card>
    </>
  );
}

