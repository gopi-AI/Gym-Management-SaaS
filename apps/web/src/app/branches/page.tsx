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
import { ApiError, useBranches } from '@/lib';

function BranchesContent() {
  const { data, isLoading, isError, error } = useBranches();
  const branches = data ?? [];

  return (
    <AppLayout
      title="Branches"
      pretitle="Management"
      pageMenu="branches"
      headerActions={<Button variant="primary">Add branch</Button>}
    >
      <Card>
        <CardBody>
          {isError && (
            <Alert type="danger" className="mb-3">
              {error instanceof ApiError ? error.message : 'Failed to load branches.'}
            </Alert>
          )}

          {isLoading ? (
            <Empty title="Loading branches…" />
          ) : branches.length === 0 ? (
            <Empty
              title="No branches yet"
              description="Create your first branch to get started."
              action={<Button variant="primary">Add branch</Button>}
            />
          ) : (
            <Table striped hover responsive cardTable>
              <THead>
                <THeadRow>
                  <Th>Name</Th>
                  <Th>Address</Th>
                  <Th>Phone</Th>
                  <Th>Status</Th>
                </THeadRow>
              </THead>
              <TBody>
                {branches.map((branch) => (
                  <TBodyRow key={branch.id}>
                    <Td>{branch.name}</Td>
                    <Td>{branch.address || '—'}</Td>
                    <Td>{branch.phone || '—'}</Td>
                    <Td>
                      <Badge color={branch.is_active ? 'green' : 'secondary'}>
                        {branch.is_active ? 'Active' : 'Inactive'}
                      </Badge>
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

export default function BranchesPage() {
  return (
    <AuthGuard>
      <BranchesContent />
    </AuthGuard>
  );
}