'use client';

import React from 'react';
import { Card, CardBody } from '@/components/ui/Card';
import type { RetentionAnalysisResponse } from '@/lib';

/** Renders an ISO-8601 server timestamp without locale-dependent hydration drift. */
export function formatGeneratedAt(value: string): string {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(value);
  return match ? `${match[1]} ${match[2]} UTC` : value;
}

interface RetentionSummaryProps {
  result: RetentionAnalysisResponse;
}

/**
 * Headline metrics + narrative summary for one analysis run.
 *
 * `organization_id` and `generated_at` are echoed from the server response, so
 * what is displayed is always the tenant the server actually analysed.
 */
export default function RetentionSummary({ result }: RetentionSummaryProps) {
  const stats = [
    { label: 'Retention rate', value: `${Math.round(result.retention_rate * 100)}%` },
    { label: 'Members analysed', value: String(result.total_members) },
    { label: 'At risk', value: String(result.at_risk_count) },
    { label: 'Flagged (max 50)', value: String(result.at_risk_members.length) },
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
            Generated <time dateTime={result.generated_at}>{formatGeneratedAt(result.generated_at)}</time>{' '}
            · Organization <code>{result.organization_id}</code> · AI-generated advisory output —
            review before acting on it.
          </div>
        </CardBody>
      </Card>
    </>
  );
}
