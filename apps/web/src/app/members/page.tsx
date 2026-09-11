'use client';

import React from 'react';
import AppLayout from '@/components/layout/AppLayout';
import AuthGuard from '@/components/auth/AuthGuard';
import Alert from '@/components/ui/Alert';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import { Card, CardBody } from '@/components/ui/Card';
import Empty from '@/components/ui/Empty';
import { PageItem, Pagination } from '@/components/ui/Pagination';
import Table, { TBody, TBodyRow, Td, THead, THeadRow, Th } from '@/components/ui/Table';
import { ApiError, useMembers } from '@/lib';

const PAGE_SIZE = 20;

function MembersContent() {
  const [page, setPage] = React.useState(1);
  const [search, setSearch] = React.useState('');
  const [searchInput, setSearchInput] = React.useState('');

  const { data, isLoading, isError, error, isFetching } = useMembers({
    page,
    limit: PAGE_SIZE,
    search: search || undefined,
  });

  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const members = data?.data ?? [];

  const handleSearch = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPage(1);
    setSearch(searchInput.trim());
  };

  return (
    <AppLayout
      title="Members"
      pretitle="Management"
      pageMenu="members"
      headerActions={<Button variant="primary">Add member</Button>}
    >
      <Card>
        <CardBody>
          <form className="row g-2 align-items-center mb-3" onSubmit={handleSearch}>
            <div className="col">
              <input
                className="form-control"
                placeholder="Search members by name…"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
              />
            </div>
            <div className="col-auto">
              <Button type="submit" variant="secondary">Search</Button>
            </div>
          </form>

          {isError && (
            <Alert type="danger" className="mb-3">
              {error instanceof ApiError ? error.message : 'Failed to load members.'}
            </Alert>
          )}

          {isLoading ? (
            <Empty title="Loading members…" description="Fetching the member directory." />
          ) : members.length === 0 ? (
            <Empty
              title="No members found"
              description={
                search
                  ? 'No members match your search.'
                  : 'Get started by adding your first member.'
              }
              action={<Button variant="primary">Add member</Button>}
            />
          ) : (
            <Table striped hover responsive cardTable nowrap>
              <THead>
                <THeadRow>
                  <Th>Name</Th>
                  <Th>Local ID</Th>
                  <Th>Email</Th>
                  <Th>Phone</Th>
                  <Th>Status</Th>
                </THeadRow>
              </THead>
              <TBody>
                {members.map((member) => (
                  <TBodyRow key={member.id}>
                    <Td>
                      {member.first_name} {member.last_name}
                    </Td>
                    <Td>#{member.local_id}</Td>
                    <Td>{member.email ?? '—'}</Td>
                    <Td>{member.phone ?? '—'}</Td>
                    <Td>
                      <Badge color={member.is_active ? 'green' : 'secondary'}>
                        {member.is_active ? 'Active' : 'Inactive'}
                      </Badge>
                    </Td>
                  </TBodyRow>
                ))}
              </TBody>
            </Table>
          )}

          {total > 0 && (
            <div className="d-flex align-items-center mt-3">
              <div className="text-secondary">
                {isFetching ? 'Loading…' : `${total} member${total === 1 ? '' : 's'}`}
              </div>
              <div className="ms-auto">
                <Pagination>
                  <PageItem
                    disabled={page <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    aria-label="Previous page"
                  >
                    ‹
                  </PageItem>
                  <PageItem active>{page}</PageItem>
                  <PageItem disabled>of {totalPages}</PageItem>
                  <PageItem
                    disabled={page >= totalPages}
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    aria-label="Next page"
                  >
                    ›
                  </PageItem>
                </Pagination>
              </div>
            </div>
          )}
        </CardBody>
      </Card>
    </AppLayout>
  );
}

export default function MembersPage() {
  return (
    <AuthGuard>
      <MembersContent />
    </AuthGuard>
  );
}