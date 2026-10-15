'use client';

import React from 'react';
import Alert from '@/components/ui/Alert';
import Badge from '@/components/ui/Badge';
import { Card, CardBody } from '@/components/ui/Card';
import Empty from '@/components/ui/Empty';
import { PageItem, Pagination } from '@/components/ui/Pagination';
import Table, { TBody, TBodyRow, Td, THead, THeadRow, Th } from '@/components/ui/Table';
import { ApiError, useMemberMemberships } from '@/lib';

const PAGE_SIZE = 20;

const STATUS_COLOR: Record<string, string> = {
  active: 'green',
  paused: 'warning',
  frozen: 'primary',
  cancelled: 'secondary',
  expired: 'secondary',
};

interface MembershipsTabProps {
  memberId: string;
  /** True while this tab is selected; the query only runs then (P2-09). */
  active: boolean;
}

/**
 * Memberships tab — `GET /v1/memberships/member/:memberId` (Paginated<Membership>).
 */
export default function MembershipsTab({ memberId, active }: MembershipsTabProps) {
  const [page, setPage] = React.useState(1);

  const { data, isPending, isError, error, isFetching } = useMemberMemberships(
    memberId,
    { page, limit: PAGE_SIZE },
    { enabled: active },
  );

  if (isPending) {
    return <Empty title="Loading memberships…" description="Fetching this member's memberships." />;
  }

  if (isError) {
    return (
      <Alert type="danger">
        {error instanceof ApiError ? error.message : 'Failed to load memberships.'}
      </Alert>
    );
  }

  const memberships = data?.data ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  if (memberships.length === 0) {
    return <Empty title="No memberships" description="This member has no memberships yet." />;
  }

  return (
    <Card>
      <CardBody>
        <Table striped hover responsive cardTable nowrap>
          <THead>
            <THeadRow>
              <Th>Plan ID</Th>
              <Th>Status</Th>
              <Th>Start date</Th>
              <Th>End date</Th>
              <Th>Price at signup</Th>
              <Th />
            </THeadRow>
          </THead>
          <TBody>
            {memberships.map((m) => (
              <TBodyRow key={m.id}>
                <Td className="text-truncate" style={{ maxWidth: 120 }}>
                  {m.plan_id ?? '—'}
                </Td>
                <Td>
                  <Badge color={STATUS_COLOR[m.status] ?? 'secondary'}>{m.status}</Badge>
                </Td>
                <Td>{m.start_date}</Td>
                <Td>{m.end_date ?? '—'}</Td>
                <Td>
                  {m.price_at_signup ? `${m.price_at_signup} ${m.currency_at_signup ?? ''}` : '—'}
                </Td>
                <Td>
                  <a className="btn btn-sm btn-outline-primary" href={`/memberships/${m.id}`}>
                    View
                  </a>
                </Td>
              </TBodyRow>
            ))}
          </TBody>
        </Table>

        {total > 0 && (
          <div className="d-flex align-items-center mt-3">
            <div className="text-secondary">
              {isFetching ? 'Loading…' : `${total} membership${total === 1 ? '' : 's'}`}
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
  );
}
