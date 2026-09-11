'use client';

import React from 'react';
import AppLayout from '@/components/layout/AppLayout';
import AuthGuard from '@/components/auth/AuthGuard';
import Alert from '@/components/ui/Alert';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import { Card, CardBody } from '@/components/ui/Card';
import Empty from '@/components/ui/Empty';
import Table, { TBody, TBodyRow, Td, THead, THeadRow, Th } from '@/components/ui/Table';
import { ApiError, setOrganizationId, useOrganizations } from '@/lib';
import { useQueryClient } from '@tanstack/react-query';

function OrganizationsContent() {
  const queryClient = useQueryClient();
  const { data, isLoading, isError, error } = useOrganizations();
  const organizations = data ?? [];
  const [activeOrgId, setActiveOrgId] = React.useState<string | null>(null);

  const handleSelect = (orgId: string) => {
    setOrganizationId(orgId);
    setActiveOrgId(orgId);
    // Resource queries are tenant-scoped, so refresh everything.
    queryClient.invalidateQueries();
  };

  return (
    <AppLayout title="Organizations" pretitle="Management" pageMenu="organizations">
      <Card>
        <CardBody>
          {isError && (
            <Alert type="warning" className="mb-3">
              {error instanceof ApiError
                ? error.message
                : 'Unable to load organizations. You may lack the required permission.'}
            </Alert>
          )}

          {isLoading ? (
            <Empty title="Loading organizations…" />
          ) : organizations.length === 0 ? (
            <Empty
              title="No organizations"
              description="You don't have access to any organizations yet."
            />
          ) : (
            <Table striped hover responsive cardTable>
              <THead>
                <THeadRow>
                  <Th>Name</Th>
                  <Th>Timezone</Th>
                  <Th>Locale</Th>
                  <Th>Currency</Th>
                  <Th />
                </THeadRow>
              </THead>
              <TBody>
                {organizations.map((org) => (
                  <TBodyRow key={org.id}>
                    <Td>
                      {org.name}
                      {activeOrgId === org.id && (
                        <Badge color="azure" className="ms-2">Active</Badge>
                      )}
                    </Td>
                    <Td>{org.timezone}</Td>
                    <Td>{org.locale}</Td>
                    <Td>{org.currency}</Td>
                    <Td className="text-end">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => handleSelect(org.id)}
                      >
                        Use
                      </Button>
                    </Td>
                  </TBodyRow>
                ))}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>
    </AppLayout>
  );
}

export default function OrganizationsPage() {
  return (
    <AuthGuard>
      <OrganizationsContent />
    </AuthGuard>
  );
}