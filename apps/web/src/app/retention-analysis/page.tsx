'use client';

import React from 'react';
import AppLayout from '@/components/layout/AppLayout';
import AuthGuard from '@/components/auth/AuthGuard';
import Alert from '@/components/ui/Alert';
import Button from '@/components/ui/Button';
import { Card, CardBody } from '@/components/ui/Card';
import Empty from '@/components/ui/Empty';
import AtRiskMembersTable from '@/components/ai/AtRiskMembersTable';
import RetentionForm from '@/components/ai/RetentionForm';
import RetentionSummary from '@/components/ai/RetentionSummary';
import {
  ApiError,
  describeAiError,
  getOrganizationId,
  useBranches,
  useRetentionAnalysis,
  type RetentionAnalysisRequest,
} from '@/lib';

/**
 * Status→copy mapping for this endpoint (shared with the plan-performance page).
 *
 * The backend never leaks provider internals, so only the status codes it
 * documents for these endpoints are translated. Kept as a local, non-exported
 * wrapper: Next.js route modules may only export the page itself.
 */
const PERMISSION_DENIED_COPY =
  'You do not have permission to run retention analysis for this organization.';

function describePlanRetentionError(error: Error): string {
  return describeAiError(error, { permissionDenied: PERMISSION_DENIED_COPY });
}

function RetentionAnalysisContent() {
  const [orgId, setOrgId] = React.useState<string | null>(null);

  React.useEffect(() => {
    setOrgId(getOrganizationId());
  }, []);

  const branchesQuery = useBranches();
  const analysis = useRetentionAnalysis();

  const handleSubmit = (payload: RetentionAnalysisRequest) => {
    if (!orgId) return;
    analysis.mutate({ orgId, payload });
  };

  return (
    <AppLayout
      title="Retention analysis"
      pretitle="AI insights"
      description="Identify members at risk of leaving and get recommended retention actions."
      pageMenu="retention"
    >
      {!orgId ? (
        <Card>
          <CardBody>
            <Empty
              title="No organization selected"
              description="Select an organization before running a retention analysis."
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
                <RetentionForm
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
                {describePlanRetentionError(analysis.error)}
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
                    title="Analyzing…"
                    description="Reviewing memberships and scoring churn risk. This usually takes a few seconds."
                  />
                </CardBody>
              </Card>
            ) : analysis.data ? (
              <>
                <RetentionSummary result={analysis.data} />
                <Card className="mt-3">
                  <CardBody>
                    <h3 className="card-title">At-risk members</h3>
                    <AtRiskMembersTable members={analysis.data.at_risk_members} />
                  </CardBody>
                </Card>
              </>
            ) : (
              <Card>
                <CardBody>
                  <Empty
                    title="No analysis yet"
                    description="Choose a period (and optionally a branch), then run the analysis."
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

export default function RetentionAnalysisPage() {
  return (
    <AuthGuard>
      <RetentionAnalysisContent />
    </AuthGuard>
  );
}
