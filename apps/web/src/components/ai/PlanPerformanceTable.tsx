'use client';

import React from 'react';
import Empty from '@/components/ui/Empty';
import Table, { TBody, TBodyRow, Td, THead, THeadRow, Th } from '@/components/ui/Table';
import Badge from '@/components/ui/Badge';
import type { PlanPerformancePlan } from '@/lib';

/** Qualitative band for a plan's churn rate. */
export function churnBand(rate: number): { label: string; color: string } {
  if (rate >= 0.5) return { label: 'High', color: 'red' };
  if (rate > 0) return { label: 'Some', color: 'orange' };
  return { label: 'None', color: 'green' };
}

function money(price: number, currency: string): string {
  return `${price.toFixed(2)} ${currency}`;
}

function lifecycleLabel(plan: PlanPerformancePlan): string {
  if (plan.lifecycle_transitions.length === 0) {
    return '—';
  }
  return plan.lifecycle_transitions
    .slice(0, 3)
    .map((entry) => `${entry.transition}×${entry.count}`)
    .join(', ');
}

interface PlanPerformanceTableProps {
  plans: PlanPerformancePlan[];
}

/**
 * Per-plan metrics table.
 *
 * Every figure is computed by the server from organization-scoped memberships;
 * the AI only ranks plans and writes advice (rendered separately).
 */
export default function PlanPerformanceTable({ plans }: PlanPerformanceTableProps) {
  if (plans.length === 0) {
    return (
      <Empty
        title="No plan metrics"
        description="The analysis did not return any plan metrics for this organization."
      />
    );
  }

  return (
    <Table striped hover responsive cardTable>
      <THead>
        <THeadRow>
          <Th>Plan</Th>
          <Th>Members</Th>
          <Th>Active</Th>
          <Th>Churn</Th>
          <Th>Avg. length</Th>
          <Th>Pricing</Th>
          <Th>Lifecycle transitions</Th>
        </THeadRow>
      </THead>
      <TBody>
        {plans.map((plan) => {
          const band = churnBand(plan.churn_rate);
          return (
            <TBodyRow key={plan.plan_id}>
              <Td>
                <div>
                  {plan.name}{' '}
                  {!plan.is_active && <Badge color="secondary">Inactive</Badge>}
                </div>
                <div className="text-secondary small">
                  {money(plan.price, plan.currency)} · {plan.billing_period} ·{' '}
                  {plan.duration_days} days
                </div>
              </Td>
              <Td>{plan.total_memberships}</Td>
              <Td>{plan.active_memberships}</Td>
              <Td>
                <Badge color={band.color}>
                  {band.label} · {Math.round(plan.churn_rate * 100)}%
                </Badge>
              </Td>
              <Td>
                {plan.average_realized_days === null
                  ? '—'
                  : `${plan.average_realized_days} days`}
              </Td>
              <Td>
                {plan.discounted_signups > 0
                  ? `${plan.discounted_signups} discounted`
                  : 'standard'}
                {plan.price_change_percent !== null && plan.price_change_percent !== 0
                  ? ` · price ${plan.price_change_percent > 0 ? '+' : ''}${plan.price_change_percent}% vs. signup`
                  : ''}
              </Td>
              <Td>{lifecycleLabel(plan)}</Td>
            </TBodyRow>
          );
        })}
      </TBody>
    </Table>
  );
}
