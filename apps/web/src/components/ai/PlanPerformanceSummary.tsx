'use client';

import React from 'react';
import { Card, CardBody } from '@/components/ui/Card';
import { formatGeneratedAt } from './RetentionSummary';
import type { PlanPerformanceResponse } from '@/lib';

interface PlanPerformanceSummaryProps {
  result: PlanPerformanceResponse;
}

/**
 * Headline portfolio metrics + narrative summary for one analysis run.
 *
 * The metric cards and the plan table are server-computed; only the summary and
 * the portfolio-health score come from the model. `organization_id` and
 * `generated_at` are echoed from the server response, so what is displayed is
 * always the tenant the server actually analysed.
 */
export default function PlanPerformanceSummary({ result }: PlanPerformanceSummaryProps) {
  const stats = [
    { label: 'Portfolio health', value: `${Math.round(result.portfolio_health * 100)}%` },
    { label: 'Viable plans', value: `${result.analyzed_plans} / ${result.total_plans}` },
    { label: 'Memberships', value: String(result.total_memberships) },
    { label: 'Overall churn', value: `${Math.round(result.overall_churn_rate * 100)}%` },
  ];

  return (
    <>
      <div className="row row-cards mb-3">
        {stats.map((stat) => (
          <div className="col-sm-6 col-lg-3" key={stat.label}>
            <Card>
              <CardBody>
                <div className="text-secondary">{stat.label}</div>
                <div className="h1 mb-0">{stat.value}</div>
              </CardBody>
            </Card>
          </div>
        ))}
      </div>

      <Card>
        <CardBody>
          <h3 className="card-title">Summary</h3>
          <p className="mb-2">{result.summary}</p>
          <div className="text-secondary small">
            Generated{' '}
            <time dateTime={result.generated_at}>
              {formatGeneratedAt(result.generated_at)}
            </time>{' '}
            · Period <code>{result.period}</code> · Organization{' '}
            <code>{result.organization_id}</code> · Plan metrics are calculated by the
            server from stored memberships; the narrative and priorities are AI-generated
            advisory output — review before acting on it.
          </div>
        </CardBody>
      </Card>
    </>
  );
}
