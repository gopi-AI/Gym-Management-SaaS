/**
 * @jest-environment jsdom
 */

/**
 * PtTab — the PT Member 360 tab (P2-09).
 *
 * The tab renders three independent cards (enrollments, sessions, workout
 * progress), each with its own empty state, so the empty test asserts all
 * three. Session timestamps are rendered with `toLocaleString()` and are
 * deliberately not asserted — they vary with the machine's locale.
 */

import '@testing-library/jest-dom';
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import type { PtEnrollment, PtSession, PtTabResponse, PtWorkoutProgress } from '@/lib';
import PtTab from './PtTab';
import {
  createTestQueryClient,
  errorResponse,
  installFetchMock,
  jsonResponse,
  pendingResponse,
  restoreFetchMock,
  TabHarness,
} from './memberTabTestUtils';

const MEMBER_ID = 'member-1';
const ENDPOINT = `/v1/members/${MEMBER_ID}/pt`;

const ENROLLMENT: PtEnrollment = {
  id: 'pt-1',
  organization_id: 'org-1',
  member_id: MEMBER_ID,
  package_id: 'pkg-7',
  trainer_id: 'trainer-3',
  start_date: '2026-02-01',
  end_date: '2026-03-01',
  sessions_used: 2,
  session_count: 10,
  status: 'active',
  created_at: '2026-02-01T00:00:00.000Z',
  updated_at: '2026-02-01T00:00:00.000Z',
};

const SESSION: PtSession = {
  id: 'ps-1',
  organization_id: 'org-1',
  branch_id: 'branch-1',
  member_id: MEMBER_ID,
  trainer_id: 'trainer-3',
  enrollment_id: 'pt-1',
  scheduled_start: '2026-02-10T09:00:00.000Z',
  scheduled_end: '2026-02-10T10:00:00.000Z',
  status: 'scheduled',
  notes: 'Focus on form',
  created_at: '2026-02-01T00:00:00.000Z',
  updated_at: '2026-02-01T00:00:00.000Z',
};

const PROGRESS: PtWorkoutProgress = {
  assignment: {
    id: 'wa-1',
    organization_id: 'org-1',
    member_id: MEMBER_ID,
    template_id: 'tpl-5',
    assigned_by: 'user-1',
    assigned_at: '2026-02-01T00:00:00.000Z',
    start_date: '2026-02-01',
    status: 'active',
    created_at: '2026-02-01T00:00:00.000Z',
    updated_at: '2026-02-01T00:00:00.000Z',
  },
  progress: { completed: 4, prescribed: 12, percentage: 25 },
};

const EMPTY: PtTabResponse = { enrollments: [], sessions: [], workoutProgress: [] };

let fetchMock: jest.Mock;

beforeEach(() => {
  fetchMock = installFetchMock();
});

afterEach(() => {
  restoreFetchMock();
});

function renderTab(active: boolean, client = createTestQueryClient()) {
  const view = render(
    <TabHarness client={client}>
      <PtTab memberId={MEMBER_ID} active={active} />
    </TabHarness>,
  );
  return { view, client };
}

test('renders the loading state while the request is in flight', () => {
  fetchMock.mockReturnValueOnce(pendingResponse());

  renderTab(true);

  expect(screen.getByText('Loading PT data…')).toBeInTheDocument();
});

test('renders the fetched enrollments, sessions and workout progress', async () => {
  const body: PtTabResponse = { enrollments: [ENROLLMENT], sessions: [SESSION], workoutProgress: [PROGRESS] };
  fetchMock.mockResolvedValueOnce(jsonResponse(body));

  renderTab(true);

  expect(await screen.findByText('pkg-7')).toBeInTheDocument();
  expect(String(fetchMock.mock.calls[0][0])).toContain(ENDPOINT);

  // Enrollment: "used / total" and the derived remainder.
  expect(screen.getByText('2 / 10')).toBeInTheDocument();
  expect(screen.getByText('8')).toBeInTheDocument();
  expect(screen.getByText('2026-02-01')).toBeInTheDocument();
  expect(screen.getByText('2026-03-01')).toBeInTheDocument();

  // The trainer id appears in the enrollment row and again in the session row.
  expect(screen.getAllByText('trainer-3')).toHaveLength(2);

  expect(screen.getByText('scheduled')).toBeInTheDocument();
  expect(screen.getByText('Focus on form')).toBeInTheDocument();

  // Workout progress card.
  expect(screen.getByText('tpl-5')).toBeInTheDocument();
  expect(screen.getByText('4')).toBeInTheDocument();
  expect(screen.getByText('12')).toBeInTheDocument();
  expect(screen.getByText('25%')).toBeInTheDocument();
  expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '25');
});

test('renders an empty state for each of the three cards', async () => {
  fetchMock.mockResolvedValueOnce(jsonResponse(EMPTY));

  renderTab(true);

  expect(await screen.findByText('No PT enrollments')).toBeInTheDocument();
  expect(screen.getByText('No PT sessions')).toBeInTheDocument();
  expect(screen.getByText('No workout assignments')).toBeInTheDocument();
});

test('renders the error state when the request fails', async () => {
  fetchMock.mockResolvedValueOnce(errorResponse(500, 'PT data is unavailable'));

  renderTab(true);

  expect(await screen.findByRole('alert')).toHaveTextContent('PT data is unavailable');
});

test('issues no request until the tab becomes active (P2-09 lazy-load gate)', async () => {
  fetchMock.mockResolvedValue(jsonResponse(EMPTY));
  const client = createTestQueryClient();

  const { view } = renderTab(false, client);

  expect(screen.getByText('Loading PT data…')).toBeInTheDocument();
  expect(fetchMock).not.toHaveBeenCalled();

  view.rerender(
    <TabHarness client={client}>
      <PtTab memberId={MEMBER_ID} active />
    </TabHarness>,
  );

  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  expect(String(fetchMock.mock.calls[0][0])).toContain(ENDPOINT);
});
