'use client';

import React from 'react';
import AppLayout from '@/components/layout/AppLayout';
import AuthGuard from '@/components/auth/AuthGuard';
import Alert from '@/components/ui/Alert';
import Button from '@/components/ui/Button';
import { Card, CardBody } from '@/components/ui/Card';
import Empty from '@/components/ui/Empty';
import PlanPerformanceForm from '@/components/ai/PlanPerformanceForm';
import PlanPerformanceRecommendations from '@/components/ai/PlanPerformanceRecommendations';
import PlanPerformanceSummary from '@/components/ai/PlanPerformanceSummary';
import PlanPerformanceTable from '@/components/ai/PlanPerformanceTable';
import {
  ApiError,
  describeAiError,
  getOrganizationId,
  useBranches,
  usePlanPerformanceAnalysis,
  type PlanPerformanceRequest,
} from '@/lib';

/**
 * Status→copy mapping for this endpoint (shared with the retention page).
 *
 * The backend never leaks provider internals, so only the status codes it
 * documents for these endpoints are translated.
 */
const PERMISSION_DENIED_COPY =
  'You do not have permission to run plan performance analysis for this organization.';

function describePlanPerformanceError(error: Error): string {
  return describeAiError(error, { permissionDenied: PERMISSION_DENIED_COPY });
}

function PlanPerformanceContent() {
  const [orgId, setOrgId] = React.useState<string | null>(null);

  React.useEffect(() => {
    setOrgId(getOrganizationId());
  }, []);

  const branchesQuery = useBranches();
  const analysis = usePlanPerformanceAnalysis();

  const handleSubmit = (payload: PlanPerformanceRequest) => {
    if (!orgId) return;
    analysis.mutate({ orgId, payload });
  };

  return (
    <AppLayout
      title="Plan performance"
      pretitle="AI insights"
      description="See which membership plans retain members, which ones churn, and what to do about it."
      pageMenu="plan-performance"
    >
      {!orgId ? (
        <Card>
          <CardBody>
            <Empty
              title="No organization selected"
              description="Select an organization before analysing plan performance."
              action={
                <Button
                  variant="primary"
                  onClick={() => (window.location.href = '/organizations')}
                >
                  Choose organization
                </Button>
              }
            />
          </CardBody>
        </Card>
      ) : (
        <div className="row row-cards">
          <div className="col-lg-4">
            <Card>
              <CardBody>
                <h3 className="card-title">Analysis scope</h3>
                <PlanPerformanceForm
                  branches={branchesQuery.data ?? []}
                  isPending={analysis.isPending}
                  onSubmit={handleSubmit}
                />
              </CardBody>
            </Card>
          </div>
          <div className="col-lg-8">
            {analysis.isError && (
              <Alert type="danger" className="mb-3" dismissible>
                {describePlanPerformanceError(analysis.error)}
              </Alert>
            )}

            {branchesQuery.isError && (
              <Alert type="warning" className="mb-3">
                {branchesQuery.error instanceof ApiError
                  ? branchesQuery.error.message
                  : 'Unable to load branches — analyse all branches instead.'}
              </Alert>
            )}

            {analysis.isPending ? (
              <Card>
                <CardBody>
                  <Empty
                    title="Analysing…"
                    description="Aggregating plan metrics and reviewing the portfolio. This usually takes a few seconds."
                  />
                </CardBody>
              </Card>
            ) : analysis.data ? (
              <>
                <PlanPerformanceSummary result={analysis.data} />
                <Card className="mt-3">
                  <CardBody>
                    <h3 className="card-title">Recommended actions</h3>
                    <PlanPerformanceRecommendations
                      recommendations={analysis.data.recommendations}
                    />
                  </CardBody>
                </Card>
                <Card className="mt-3">
                  <CardBody>
                    <h3 className="card-title">Plan metrics</h3>
                    <PlanPerformanceTable plans={analysis.data.plans} />
                  </CardBody>
                </Card>
              </>
            ) : (
              <Card>
                <CardBody>
                  <Empty
                    title="No analysis yet"
                    description="Choose a period (and optionally a branch), then analyse your plans."
                  />
                </CardBody>
              </Card>
            )}
          </div>
        </div>
      )}
    </AppLayout>
  );
}

export default function PlanPerformancePage() {
  return (
    <AuthGuard>
      <PlanPerformanceContent />
    </AuthGuard>
  );
}
