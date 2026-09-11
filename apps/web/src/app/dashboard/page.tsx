'use client';

import React from 'react';
import AppLayout from '@/components/layout/AppLayout';
import { Card, CardBody } from '@/components/ui/Card';
import { useBranches, useMembers, useOrganizations } from '@/lib';

interface StatCardProps {
  label: string;
  value: string;
  hint?: string;
}

function StatCard({ label, value, hint }: StatCardProps) {
  return (
    <Card>
      <CardBody>
        <div className="text-secondary text-uppercase small fw-bold mb-1">{label}</div>
        <div className="h1 mb-0">{value}</div>
        {hint && <div className="text-secondary small mt-1">{hint}</div>}
      </CardBody>
    </Card>
  );
}

/**
 * Dashboard overview — quick counters for the key resources.
 */
export default function DashboardPage() {
  const members = useMembers({ page: 1, limit: 1 });
  const branches = useBranches();
  const organizations = useOrganizations();

  const format = (value?: number, loading?: boolean, error?: boolean) => {
    if (loading) return '…';
    if (error) return '—';
    return value !== undefined ? String(value) : '0';
  };

  return (
    <AppLayout title="Dashboard" pretitle="Overview" pageMenu="dashboard">
      <div className="row row-deck row-cards">
        <div className="col-sm-6 col-lg-3">
          <StatCard
            label="Members"
            value={format(members.data?.total, members.isLoading, members.isError)}
            hint="Active members in your organization"
          />
        </div>
        <div className="col-sm-6 col-lg-3">
          <StatCard
            label="Branches"
            value={format(branches.data?.length, branches.isLoading, branches.isError)}
            hint="Locations you manage"
          />
        </div>
        <div className="col-sm-6 col-lg-3">
          <StatCard
            label="Organizations"
            value={format(
              organizations.data?.length,
              organizations.isLoading,
              organizations.isError,
            )}
            hint="Tenants visible to you"
          />
        </div>
        <div className="col-sm-6 col-lg-3">
          <StatCard label="Plan" value="Free" hint="Upgrade available" />
        </div>
      </div>

      <div className="row row-deck row-cards mt-3">
        <div className="col-12">
          <Card>
            <CardBody>
              <h3 className="card-title">Welcome back</h3>
              <p className="text-secondary mb-0">
                Use the navigation to manage members, branches and your
                organization settings.
              </p>
            </CardBody>
          </Card>
        </div>
      </div>
    </AppLayout>
  );
}