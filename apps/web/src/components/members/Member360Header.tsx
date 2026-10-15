'use client';

import React from 'react';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import { Card, CardBody } from '@/components/ui/Card';
import type { Member360HeaderResponse } from '@/lib';

/**
 * Member 360 header — the always-visible summary above the tabs (P2-01).
 *
 * Renders the fields of `GET /v1/members/:memberId/360/header` as-is.
 *
 * - `member.photo` is always null in Phase 2 (the member table has no photo
 *   column), so the avatar shows the member's initials.
 * - The quick actions are rendered as presentational buttons: no Phase 2
 *   route exists for "check in", "renew", "book PT", "log workout" or
 *   "log meal" from this page, so they carry no handler (the same as the
 *   "Add member" button on the members list).
 */

/** Quick-action codes → labels (`computeQuickActions`, member-360-header.dto.ts). */
const QUICK_ACTION_LABELS: Record<string, string> = {
  check_in: 'Check in',
  renew: 'Renew membership',
  book_pt: 'Book PT',
  log_workout: 'Log workout',
  log_meal: 'Log meal',
};

const ACCESS_BADGE: Record<string, string> = {
  granted: 'green',
  denied: 'red',
  not_checked_in: 'secondary',
};

const ACCESS_LABEL: Record<string, string> = {
  granted: 'Access granted',
  denied: 'Access denied',
  not_checked_in: 'Not checked in today',
};

interface Member360HeaderProps {
  header: Member360HeaderResponse;
}

export default function Member360Header({ header }: Member360HeaderProps) {
  const { member, membership, accessStatus, currentMeasurements } = header;
  const initials = `${member.firstName.charAt(0)}${member.lastName.charAt(0)}`.toUpperCase();

  return (
    <Card className="mb-3">
      <CardBody>
        <div className="row g-3 align-items-center">
          <div className="col-auto">
            <span className="avatar avatar-lg bg-blue-lt" aria-hidden="true">
              {initials}
            </span>
          </div>
          <div className="col">
            <h3 className="card-title mb-0">
              {member.firstName} {member.lastName}
            </h3>
            <div className="text-secondary small">
              #{member.localId}
              {member.email ? ` · ${member.email}` : ''}
              {member.phone ? ` · ${member.phone}` : ''}
            </div>
          </div>
          {header.quickActions.length > 0 && (
            <div className="col-auto">
              <div className="btn-list">
                {header.quickActions.map((action) => (
                  <Button key={action} variant="secondary" size="sm">
                    {QUICK_ACTION_LABELS[action] ?? action}
                  </Button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="row g-3 mt-3">
          <div className="col-md-3">
            <div className="text-secondary small">Membership</div>
            {membership ? (
              <>
                <Badge color="green">{membership.status}</Badge>
                <div className="small mt-1">
                  {membership.endDate ? `Ends ${membership.endDate}` : 'No end date'}
                  {membership.daysRemaining !== null ? ` · ${membership.daysRemaining} day(s) left` : ''}
                </div>
              </>
            ) : (
              <Badge color="secondary">None active</Badge>
            )}
          </div>

          <div className="col-md-3">
            <div className="text-secondary small">Access</div>
            <Badge color={ACCESS_BADGE[accessStatus.today] ?? 'secondary'}>
              {ACCESS_LABEL[accessStatus.today] ?? accessStatus.today}
            </Badge>
            <div className="small mt-1">
              Last check-in:{' '}
              {accessStatus.lastCheckIn ? new Date(accessStatus.lastCheckIn).toLocaleString() : '—'}
            </div>
          </div>

          <div className="col-md-3">
            <div className="text-secondary small">Current measurements</div>
            <div className="small">Weight: {currentMeasurements.weight ?? '—'}</div>
            <div className="small">Body fat: {currentMeasurements.bodyFat ?? '—'}</div>
            <div className="small">Height: {currentMeasurements.height ?? '—'}</div>
          </div>

          <div className="col-md-3">
            <div className="text-secondary small">Personal training</div>
            <div className="small">
              {header.activePtEnrollmentCount} active enrollment
              {header.activePtEnrollmentCount === 1 ? '' : 's'}
            </div>
            <div className="small">
              {header.hasRemainingPtSessions ? 'Sessions remaining' : 'No sessions remaining'}
            </div>
          </div>
        </div>
      </CardBody>
    </Card>
  );
}
