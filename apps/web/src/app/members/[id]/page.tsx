'use client';

import React from 'react';
import { notFound, useParams } from 'next/navigation';
import AppLayout from '@/components/layout/AppLayout';
import AuthGuard from '@/components/auth/AuthGuard';
import Alert from '@/components/ui/Alert';
import Empty from '@/components/ui/Empty';
import Tabs from '@/components/ui/Tabs';
import type { TabItem } from '@/components/ui/Tabs';
import Member360Header from '@/components/members/Member360Header';
import MembershipsTab from '@/components/members/MembershipsTab';
import PtTab from '@/components/members/PtTab';
import WorkoutsTab from '@/components/members/WorkoutsTab';
import DietTab from '@/components/members/DietTab';
import LoyaltyTab from '@/components/members/LoyaltyTab';
import { ApiError, useMember360Header } from '@/lib';

/** Tab order is owner-ruled (P2-09): Memberships, PT, Workouts, Diet, Loyalty. */
const TABS: readonly TabItem[] = [
  { key: 'memberships', label: 'Memberships' },
  { key: 'pt', label: 'PT' },
  { key: 'workouts', label: 'Workouts' },
  { key: 'diet', label: 'Diet' },
  { key: 'loyalty', label: 'Loyalty' },
];

/**
 * One tab panel.
 *
 * Panels stay mounted — inactive ones are hidden, not unmounted — so per-tab
 * state (the memberships page number) survives a switch, while each tab's
 * query runs only while its panel is active (see the `enabled` flag each tab
 * passes to its hook).
 */
function TabPanel({
  tabKey,
  activeTab,
  children,
}: {
  tabKey: string;
  activeTab: string;
  children: React.ReactNode;
}) {
  return (
    <div
      id={`panel-${tabKey}`}
      role="tabpanel"
      aria-labelledby={`tab-${tabKey}`}
      className={tabKey === activeTab ? '' : 'd-none'}
    >
      {children}
    </div>
  );
}

function Member360Content({ memberId }: { memberId: string }) {
  const [activeTab, setActiveTab] = React.useState('memberships');

  const { data: header, isPending, isError, error } = useMember360Header(memberId);

  // A member that does not belong to the caller's organization is a 404 from
  // the header route — the page itself does not exist in that case.
  if (isError && error instanceof ApiError && error.status === 404) {
    notFound();
  }

  return (
    <AppLayout
      title={header ? `${header.member.firstName} ${header.member.lastName}` : 'Member'}
      pretitle="Members"
      pageMenu="members"
    >
      {isPending ? (
        <Empty title="Loading member…" description="Fetching the Member 360 header." />
      ) : isError ? (
        <Alert type="danger">
          {error instanceof ApiError ? error.message : 'Failed to load this member.'}
        </Alert>
      ) : header ? (
        <Member360Header header={header} />
      ) : null}

      <div className="mb-3">
        <Tabs items={TABS} active={activeTab} onChange={setActiveTab} />
      </div>

      <TabPanel tabKey="memberships" activeTab={activeTab}>
        <MembershipsTab memberId={memberId} active={activeTab === 'memberships'} />
      </TabPanel>
      <TabPanel tabKey="pt" activeTab={activeTab}>
        <PtTab memberId={memberId} active={activeTab === 'pt'} />
      </TabPanel>
      <TabPanel tabKey="workouts" activeTab={activeTab}>
        <WorkoutsTab memberId={memberId} active={activeTab === 'workouts'} />
      </TabPanel>
      <TabPanel tabKey="diet" activeTab={activeTab}>
        <DietTab memberId={memberId} active={activeTab === 'diet'} />
      </TabPanel>
      <TabPanel tabKey="loyalty" activeTab={activeTab}>
        <LoyaltyTab memberId={memberId} active={activeTab === 'loyalty'} />
      </TabPanel>
    </AppLayout>
  );
}

export default function MemberDetailPage() {
  const params = useParams();
  const memberId = params?.id as string;
  if (!memberId) notFound();
  return (
    <AuthGuard>
      <Member360Content memberId={memberId} />
    </AuthGuard>
  );
}
