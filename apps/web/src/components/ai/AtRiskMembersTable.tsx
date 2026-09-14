'use client';

import React from 'react';
import Empty from '@/components/ui/Empty';
import Table, { TBody, TBodyRow, Td, THead, THeadRow, Th } from '@/components/ui/Table';
import Badge from '@/components/ui/Badge';
import type { RetentionAtRiskMember } from '@/lib';

/** Qualitative band for a model risk score. */
export function riskBand(score: number): { label: string; color: string } {
  if (score >= 0.75) return { label: 'High', color: 'red' };
  if (score >= 0.5) return { label: 'Elevated', color: 'orange' };
  if (score >= 0.25) return { label: 'Moderate', color: 'yellow' };
  return { label: 'Low', color: 'green' };
}

interface AtRiskMembersTableProps {
  members: RetentionAtRiskMember[];
}

/**
 * At-risk member table.
 *
 * `member_id`/`name` pairs are produced exclusively by the server from the
 * authorized, organization-scoped dataset — the model output is used only for
 * scoring and advice.
 */
export default function AtRiskMembersTable({ members }: AtRiskMembersTableProps) {
  if (members.length === 0) {
    return (
      <Empty
        title="No at-risk members"
        description="The analysis did not flag any members in this window."
      />
    );
  }

  return (
    <Table striped hover responsive cardTable>
      <THead>
        <THeadRow>
          <Th>Member</Th>
          <Th>Risk</Th>
          <Th>Risk factors</Th>
          <Th>Recommended action</Th>
        </THeadRow>
      </THead>
      <TBody>
        {members.map((member) => {
          const band = riskBand(member.risk_score);
          return (
            <TBodyRow key={member.member_id}>
              <Td>
                <div>{member.name}</div>
                <div className="text-secondary small">{member.member_id}</div>
              </Td>
              <Td>
                <Badge color={band.color}>
                  {band.label} · {Math.round(member.risk_score * 100)}%
                </Badge>
              </Td>
              <Td>
                {member.risk_factors.length === 0
                  ? '—'
                  : member.risk_factors.map((factor) => (
                      <Badge key={factor} color="secondary" className="me-1 mb-1">
                        {factor}
                      </Badge>
                    ))}
              </Td>
              <Td>{member.recommended_action || '—'}</Td>
            </TBodyRow>
          );
        })}
      </TBody>
    </Table>
  );
}
