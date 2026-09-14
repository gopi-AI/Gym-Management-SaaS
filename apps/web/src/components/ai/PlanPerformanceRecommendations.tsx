'use client';

import React from 'react';
import Badge from '@/components/ui/Badge';
import Empty from '@/components/ui/Empty';
import type { PlanPerformancePriority, PlanPerformanceRecommendation } from '@/lib';

export function priorityBand(priority: PlanPerformancePriority): {
  label: string;
  color: string;
} {
  switch (priority) {
    case 'high':
      return { label: 'High', color: 'red' };
    case 'medium':
      return { label: 'Medium', color: 'orange' };
    default:
      return { label: 'Low', color: 'blue' };
  }
}

interface PlanPerformanceRecommendationsProps {
  recommendations: PlanPerformanceRecommendation[];
}

/**
 * Model-ranked plan advice.
 *
 * `plan_id`/`name` pairs are produced exclusively by the server from the
 * authorized, organization-scoped dataset — the model output is used only for
 * ranking, prioritisation and wording.
 */
export default function PlanPerformanceRecommendations({
  recommendations,
}: PlanPerformanceRecommendationsProps) {
  if (recommendations.length === 0) {
    return (
      <Empty
        title="No plan recommendations"
        description="The analysis did not flag any plan in this window."
      />
    );
  }

  return (
    <div className="list-group list-group-flush">
      {recommendations.map((recommendation) => {
        const band = priorityBand(recommendation.priority);
        return (
          <div className="list-group-item" key={recommendation.plan_id}>
            <div className="d-flex justify-content-between align-items-center mb-1">
              <div>
                <strong>{recommendation.name}</strong>{' '}
                <span className="text-secondary small">{recommendation.plan_id}</span>
              </div>
              <Badge color={band.color}>{band.label}</Badge>
            </div>
            <div className="mb-1">{recommendation.issue}</div>
            <div className="text-secondary small">{recommendation.recommended_action}</div>
          </div>
        );
      })}
    </div>
  );
}
