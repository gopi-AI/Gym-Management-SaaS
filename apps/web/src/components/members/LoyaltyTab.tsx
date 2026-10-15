'use client';

import React from 'react';
import Alert from '@/components/ui/Alert';
import Badge from '@/components/ui/Badge';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/Card';
import Empty from '@/components/ui/Empty';
import Table, { TBody, TBodyRow, Td, THead, THeadRow, Th } from '@/components/ui/Table';
import { ApiError, useMemberLoyaltyTab } from '@/lib';

const TRANSACTION_TYPE_COLOR: Record<string, string> = {
  earn: 'green',
  adjust: 'azure',
  expire: 'secondary',
  redeem: 'warning',
};

interface LoyaltyTabProps {
  memberId: string;
  /** True while this tab is selected; the query only runs then (P2-09). */
  active: boolean;
}

/**
 * Loyalty tab — `GET /v1/members/:memberId/loyalty`.
 *
 * Both loyalty reads throw 404 until the member has a loyalty account row
 * (created by the first point-earning event), so a 404 renders as an empty
 * state — not an error, and not a page-level not-found.
 */
export default function LoyaltyTab({ memberId, active }: LoyaltyTabProps) {
  const { data, isPending, isError, error } = useMemberLoyaltyTab(memberId, { enabled: active });

  if (isPending) {
    return <Empty title="Loading loyalty…" description="Fetching the loyalty account." />;
  }

  if (isError) {
    if (error instanceof ApiError && error.status === 404) {
      return (
        <Empty
          title="No loyalty account"
          description="A loyalty account is created the first time the member earns points, e.g. from a check-in or a logged workout."
        />
      );
    }
    return (
      <Alert type="danger">
        {error instanceof ApiError ? error.message : 'Failed to load loyalty data.'}
      </Alert>
    );
  }

  const account = data?.account;
  const transactions = data?.transactions ?? [];

  return (
    <>
      <Card className="mb-3">
        <CardBody>
          <div className="row g-3">
            <div className="col-md-3">
              <div className="text-secondary small">Balance</div>
              <div className="h3 mb-0">{account?.balance ?? '—'}</div>
            </div>
            <div className="col-md-3">
              <div className="text-secondary small">Lifetime earned</div>
              <div>{account?.lifetime_points_earned ?? '—'}</div>
            </div>
            <div className="col-md-3">
              <div className="text-secondary small">Lifetime redeemed</div>
              <div>{account?.lifetime_points_redeemed ?? '—'}</div>
            </div>
            <div className="col-md-3">
              <div className="text-secondary small">Tier</div>
              <div>{account?.tier ?? '—'}</div>
            </div>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Point transactions</CardTitle>
        </CardHeader>
        <CardBody>
          {transactions.length === 0 ? (
            <Empty
              title="No transactions"
              description="No point movements have been recorded yet."
            />
          ) : (
            <Table striped hover responsive cardTable nowrap>
              <THead>
                <THeadRow>
                  <Th>Date</Th>
                  <Th>Type</Th>
                  <Th>Points</Th>
                  <Th>Remaining</Th>
                  <Th>Reference</Th>
                  <Th>Expires</Th>
                </THeadRow>
              </THead>
              <TBody>
                {transactions.map((transaction) => (
                  <TBodyRow key={transaction.id}>
                    <Td>{new Date(transaction.created_at).toLocaleString()}</Td>
                    <Td>
                      <Badge
                        color={
                          TRANSACTION_TYPE_COLOR[transaction.transaction_type] ?? 'secondary'
                        }
                      >
                        {transaction.transaction_type}
                      </Badge>
                    </Td>
                    <Td>{transaction.points}</Td>
                    <Td>{transaction.remaining_points}</Td>
                    <Td>
                      {transaction.reference_type
                        ? `${transaction.reference_type}${
                            transaction.reference_id ? ` · ${transaction.reference_id}` : ''
                          }`
                        : '—'}
                    </Td>
                    <Td>
                      {transaction.expires_at
                        ? new Date(transaction.expires_at).toLocaleDateString()
                        : '—'}
                    </Td>
                  </TBodyRow>
                ))}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>
    </>
  );
}
