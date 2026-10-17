/**
 * @jest-environment jsdom
 */

/**
 * WorkoutsTab — the Workouts Member 360 tab (P2-09/P2-05).
 *
 * Three cards: `assignments` and `sessions` are member-scoped, `exercises` is
 * the organization-wide library. All empty states are asserted, and the
 * per-assignment progress bar is pinned to the server-computed percentage.
 */

import '@testing-library/jest-dom';
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import type {
  Exercise,
  WorkoutsTabAssignment,
  WorkoutsTabResponse,
  WorkoutSession,
} from '@/lib';
import WorkoutsTab from './WorkoutsTab';
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
const ENDPOINT = `/v1/members/${MEMBER_ID}/workouts`;

const ASSIGNMENT: WorkoutsTabAssignment = {
  id: 'wa-1',
  organization_id: 'org-1',
  member_id: MEMBER_ID,
  template_id: 'tpl-5',
  assigned_by: 'user-1',
  assigned_at: '2026-02-01T00:00:00.000Z',
  start_date: '2026-02-01',
  end_date: '2026-03-01',
  status: 'active',
  notes: 'Knee-friendly',
  created_at: '2026-02-01T00:00:00.000Z',
  updated_at: '2026-02-01T00:00:00.000Z',
  progress: { completed: 3, prescribed: 4, percentage: 75 },
};

const SESSION: WorkoutSession = {
  id: 'ws-1',
  organization_id: 'org-1',
  member_id: MEMBER_ID,
  template_id: 'tpl-5',
  assignment_id: 'wa-1',
  session_date: '2026-02-10',
  started_at: '2026-02-10T09:00:00.000Z',
  completed_at: '2026-02-10T09:45:00.000Z',
  duration_minutes: 45,
  notes: 'Felt strong',
  mood: 8,
  session_exercises: [],
  created_at: '2026-02-10T09:45:00.000Z',
};

const EXERCISE: Exercise = {
  id: 'ex-1',
  organization_id: 'org-1',
  name: 'Goblet squat',
  category: 'Strength',
  muscle_group: 'Legs',
  equipment_needed: 'Kettlebell',
  is_active: true,
  created_at: '2026-02-01T00:00:00.000Z',
  updated_at: '2026-02-01T00:00:00.000Z',
};

const EMPTY: WorkoutsTabResponse = { assignments: [], sessions: [], exercises: [] };

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
      <WorkoutsTab memberId={MEMBER_ID} active={active} />
    </TabHarness>,
  );
  return { view, client };
}

test('renders the loading state while the request is in flight', () => {
  fetchMock.mockReturnValueOnce(pendingResponse());

  renderTab(true);

  expect(screen.getByText('Loading workouts…')).toBeInTheDocument();
});

test('renders the fetched assignments, session history and exercise library', async () => {
  const body: WorkoutsTabResponse = {
    assignments: [ASSIGNMENT],
    sessions: [SESSION],
    exercises: [EXERCISE],
  };
  fetchMock.mockResolvedValueOnce(jsonResponse(body));

  renderTab(true);

  expect(await screen.findByText('tpl-5')).toBeInTheDocument();
  expect(String(fetchMock.mock.calls[0][0])).toContain(ENDPOINT);

  // Assigned plans card.
  expect(screen.getByText('active')).toBeInTheDocument();
  expect(screen.getByText('2026-02-01')).toBeInTheDocument();
  expect(screen.getByText('2026-03-01')).toBeInTheDocument();
  expect(screen.getByText('user-1')).toBeInTheDocument();
  expect(screen.getByText('Knee-friendly')).toBeInTheDocument();

  // Per-assignment progress (server-computed percentage).
  expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '75');

  // Session history card.
  expect(screen.getByText('2026-02-10')).toBeInTheDocument();
  expect(screen.getByText('45 min')).toBeInTheDocument();
  expect(screen.getByText('Felt strong')).toBeInTheDocument();

  // Exercise library card.
  expect(screen.getByText('Goblet squat')).toBeInTheDocument();
  expect(screen.getByText('Strength')).toBeInTheDocument();
  expect(screen.getByText('Legs')).toBeInTheDocument();
  expect(screen.getByText('Kettlebell')).toBeInTheDocument();
  expect(screen.getByText('Active')).toBeInTheDocument();
});

test('renders an empty state for each of the three cards', async () => {
  fetchMock.mockResolvedValueOnce(jsonResponse(EMPTY));

  renderTab(true);

  expect(await screen.findByText('No workout assignments')).toBeInTheDocument();
  expect(screen.getByText('No workout sessions')).toBeInTheDocument();
  expect(screen.getByText('No exercises')).toBeInTheDocument();
});

test('renders the error state when the request fails', async () => {
  fetchMock.mockResolvedValueOnce(errorResponse(500, 'Workout data is unavailable'));

  renderTab(true);

  expect(await screen.findByRole('alert')).toHaveTextContent('Workout data is unavailable');
});

test('issues no request until the tab becomes active (P2-09 lazy-load gate)', async () => {
  fetchMock.mockResolvedValue(jsonResponse(EMPTY));
  const client = createTestQueryClient();

  const { view } = renderTab(false, client);

  expect(screen.getByText('Loading workouts…')).toBeInTheDocument();
  expect(fetchMock).not.toHaveBeenCalled();

  view.rerender(
    <TabHarness client={client}>
      <WorkoutsTab memberId={MEMBER_ID} active />
    </TabHarness>,
  );

  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  expect(String(fetchMock.mock.calls[0][0])).toContain(ENDPOINT);
});
