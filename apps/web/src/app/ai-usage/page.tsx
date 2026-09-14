'use client';

import React from 'react';
import AppLayout from '@/components/layout/AppLayout';
import AuthGuard from '@/components/auth/AuthGuard';
import Alert from '@/components/ui/Alert';
import Button from '@/components/ui/Button';
import { Card, CardBody } from '@/components/ui/Card';
import Empty from '@/components/ui/Empty';
import AiUsageSummary from '@/components/ai/AiUsageSummary';
import {
  describeAiError,
  getOrganizationId,
  useAiUsage,
} from '@/lib';

const PERMISSION_DENIED_COPY =
  'You do not have permission to view AI usage for this organization.';

function describeUsageError(error: Error): string {
  return describeAiError(error, { permissionDenied: PERMISSION_DENIED_COPY });
}

function AiUsageContent() {
  const [orgId, setOrgId] = React.useState<string | null>(null);

  React.useEffect(() => {
    setOrgId(getOrganizationId());
  }, []);

  const usage = useAiUsage(orgId);

  return (
    <AppLayout
      title="AI usage"
      pretitle="Operations"
      description="Organization-scoped AI consumption and budget headroom. Read-only: opening this page never calls the AI provider."
      pageMenu="ai-usage"
    >
      {!orgId ? (
        <Card>
          <CardBody>
            <Empty
              title="No organization selected"
              description="Select an organization to see its AI usage and cost."
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
        <>
          {usage.isError && (
            <Alert type="danger" className="mb-3" dismissible>
              {describeUsageError(usage.error)}
            </Alert>
          )}

          {usage.isPending ? (
            <Card>
              <CardBody>
                <Empty
                  title="Loading AI usage…"
                  description="Aggregating recorded AI requests for this organization."
                />
              </CardBody>
            </Card>
          ) : usage.data ? (
            <AiUsageSummary usage={usage.data} />
          ) : (
            !usage.isError && (
              <Card>
                <CardBody>
                  <Empty
                    title="No usage available"
                    description="No AI requests have been recorded for this organization yet."
                  />
                </CardBody>
              </Card>
            )
          )}
        </>
      )}
    </AppLayout>
  );
}

export default function AiUsagePage() {
  return (
    <AuthGuard>
      <AiUsageContent />
    </AuthGuard>
  );
}
