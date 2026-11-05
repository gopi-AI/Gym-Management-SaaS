/**
 * @jest-environment jsdom
 */

/**
 * WorkoutsTab — the Workouts Member 360 tab (P2-09/P2-05).
 *
 * The tab now reads six endpoints: the combined tab, the rolling sequence, the
 * current prescribed day, session history, progress reviews/comparison, member
 * measurements and read-only attendance. The tests route each fetch by URL so a
 * new query cannot silently consume another query's fixture.
 */

import '@testing-library/jest-dom';
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import type {
  Exercise,
  PrescribedDayDetail,
  ProgressReviewComparison,
  WorkoutProgressReview,
  WorkoutSequenceEntry,
  WorkoutSession,
  WorkoutsTabAssignment,
  WorkoutsTabResponse,
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
  plan_template_id: null,
  logging_mode: 'simple',
  assigned_by: 'user-1',
  assigned_at: '2026-02-01T00:00:00.000Z',
  start_date: '2026-02-01',
  end_date: '2026-03-01',
  status: 'active',
  notes: 'Knee-friendly',
  created_at: '2026-02-01T00:00:00.000Z',
  updated_at: '2026-02-01T00:00:00.000Z',
  progress: {
    completed: 3,
    prescribed: 4,
    percentage: 75,
    status_counts: { pending: 1, submitted: 0, remaining_required: 0, approved: 3 },
    exercise_completion: { completed: 2, prescribed: 4, percentage: 50 },
  },
};

const SESSION: WorkoutSession = {
  id: 'ws-1',
  organization_id: 'org-1',
  member_id: MEMBER_ID,
  template_id: 'tpl-5',
  assignment_id: 'wa-1',
  prescribed_day_id: 'pd-1',
  status: 'finished',
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

const SEQUENCE: WorkoutSequenceEntry = {
  assignment: ASSIGNMENT,
  days: [
    {
      id: 'pd-1',
      organization_id: 'org-1',
      assignment_id: 'wa-1',
      sequence_order: 1,
      name: 'Push day',
      is_rest_day: false,
      is_optional: false,
      status: 'pending',
      created_at: '2026-02-01T00:00:00.000Z',
      updated_at: '2026-02-01T00:00:00.000Z',
    },
    {
      id: 'pd-2',
      organization_id: 'org-1',
      assignment_id: 'wa-1',
      sequence_order: 2,
      name: 'Recovery rest',
      is_rest_day: true,
      is_optional: false,
      status: 'pending',
      created_at: '2026-02-01T00:00:00.000Z',
      updated_at: '2026-02-01T00:00:00.000Z',
    },
  ],
  current_day_id: 'pd-1',
  progress: ASSIGNMENT.progress,
};

const DAY_DETAIL: PrescribedDayDetail = {
  day: {
    ...SEQUENCE.days[0],
    exercises: [
      {
        id: 'pde-1',
        prescribed_day_id: 'pd-1',
        exercise_id: 'ex-1',
        section: 'strength',
        sets: 3,
        reps: 12,
        sort_order: 1,
        exercise_name_snapshot: 'Bench Press',
      },
    ],
  },
  assignment: ASSIGNMENT,
  submissions: [],
  reviews: [],
  sessions: [SESSION],
};

const REVIEW: WorkoutProgressReview = {
  id: 'pr-1',
  organization_id: 'org-1',
  member_id: MEMBER_ID,
  assignment_id: 'wa-1',
  review_date: '2026-03-10',
  period_start: '2026-02-10',
  period_end: '2026-03-10',
  approved_days: 3,
  prescribed_days: 4,
  progress_percentage: 75,
  plan_day_summary: {},
  attendance_summary: {},
  decision: 'continue',
  measurements: [
    {
      id: 'prm-1',
      review_id: 'pr-1',
      measurement_id: 'm-1',
      measurement_type: 'weight',
      value: 82,
      unit: 'kg',
      measured_at: '2026-02-01T00:00:00.000Z',
    },
  ],
  created_at: '2026-03-10T00:00:00.000Z',
};

const COMPARISON: ProgressReviewComparison = {
  member_id: MEMBER_ID,
  reviews: [],
  measurements: [
    {
      measurement_type: 'weight',
      unit: 'kg',
      points: [
        {
          review_id: 'pr-1',
          review_date: '2026-03-10',
          measurement_id: 'm-1',
          value: 82,
        },
      ],
    },
  ],
};

const EMPTY_PAGE = { data: [], total: 0, page: 1, limit: 20 };

let fetchMock: jest.Mock;

beforeEach(() => {
  fetchMock = installFetchMock();
});

afterEach(() => {
  restoreFetchMock();
});

interface Overrides {
  tab?: unknown;
  sequence?: unknown;
  sessions?: unknown;
  reviews?: unknown;
  comparison?: unknown;
  measurements?: unknown;
  attendance?: unknown;
  day?: unknown;
}

function installRouter(overrides: Overrides = {}): void {
  fetchMock.mockImplementation((input: unknown) => {
    const url = String(input);
    if (url.includes('/progress-reviews/comparison')) {
      return Promise.resolve(jsonResponse(overrides.comparison ?? { member_id: MEMBER_ID, reviews: [], measurements: [] }));
    }
    if (url.includes('/progress-reviews')) {
      return Promise.resolve(jsonResponse(overrides.reviews ?? []));
    }
    if (url.includes('/v1/attendance/members/')) {
      return Promise.resolve(jsonResponse(overrides.attendance ?? EMPTY_PAGE));
    }
    if (url.includes('/measurements')) {
      return Promise.resolve(jsonResponse(overrides.measurements ?? EMPTY_PAGE));
    }
    if (url.includes('/prescribed-days/')) {
      return Promise.resolve(jsonResponse(overrides.day ?? DAY_DETAIL));
    }
    if (url.endsWith('/sequence')) {
      return Promise.resolve(jsonResponse(overrides.sequence ?? []));
    }
    if (url.includes('/v1/workouts/members/') && url.endsWith('/sessions')) {
      return Promise.resolve(jsonResponse(overrides.sessions ?? []));
    }
    if (url.includes(ENDPOINT)) {
      return Promise.resolve(jsonResponse(overrides.tab ?? EMPTY));
    }
    return Promise.resolve(jsonResponse(EMPTY_PAGE));
  });
}

function renderTab(active: boolean, client = createTestQueryClient()) {
  const view = render(
    <TabHarness client={client}>
      <WorkoutsTab memberId={MEMBER_ID} active={active} />
    </TabHarness>,
  );
  return { view, client };
}

test('renders the loading state while the request is in flight', () => {
  fetchMock.mockImplementation((input: unknown) => {
    const url = String(input);
    if (url.includes(ENDPOINT)) return pendingResponse();
    if (url.endsWith('/sequence')) return Promise.resolve(jsonResponse([]));
    return Promise.resolve(jsonResponse(EMPTY_PAGE));
  });

  renderTab(true);

  expect(screen.getByText('Loading workouts…')).toBeInTheDocument();
});

test('renders assignments, rolling sequence, current day, sessions, reviews and attendance', async () => {
  installRouter({
    tab: { assignments: [ASSIGNMENT], sessions: [SESSION], exercises: [EXERCISE] },
    sequence: [SEQUENCE],
    sessions: [SESSION],
    reviews: [REVIEW],
    comparison: COMPARISON,
    measurements: {
      data: [
        {
          id: 'm-1',
          organization_id: 'org-1',
          member_id: MEMBER_ID,
          measurement_type: 'weight',
          value: 82,
          unit: 'kg',
          measured_at: '2026-02-01T00:00:00.000Z',
          created_at: '2026-02-01T00:00:00.000Z',
        },
      ],
      total: 1,
      page: 1,
      limit: 20,
    },
    attendance: {
      data: [
        {
          date: '2026-02-09',
          checkInCount: 1,
          firstCheckIn: '2026-02-09T08:00:00.000Z',
          lastCheckIn: '2026-02-09T08:00:00.000Z',
        },
      ],
      total: 1,
      page: 1,
      limit: 31,
    },
    day: DAY_DETAIL,
  });

  renderTab(true);

  // Assigned plans card.
  expect(await screen.findByText('tpl-5')).toBeInTheDocument();
  expect(screen.getByText('active')).toBeInTheDocument();
  expect(screen.getByText('2026-02-01')).toBeInTheDocument();
  expect(screen.getByText('2026-03-01')).toBeInTheDocument();
  expect(screen.getByText('user-1')).toBeInTheDocument();
  expect(screen.getByText('Knee-friendly')).toBeInTheDocument();
  expect(screen.getByText(/3 \/ 4 approved days \(75%\)/)).toBeInTheDocument();
  expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '75');

  // Rolling sequence + current day.
  expect(screen.getByText('Rolling workout sequence')).toBeInTheDocument();
  expect(screen.getByText('Push day')).toBeInTheDocument();
  expect(screen.getByText('Recovery rest')).toBeInTheDocument();
  expect(await screen.findByTestId('current-workout-day')).toBeInTheDocument();
  expect(screen.getByText('Bench Press')).toBeInTheDocument();
  expect(screen.getByText('3 × 12')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Approve day' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Request remaining' })).toBeInTheDocument();

  // Session history.
  expect(screen.getByText('2026-02-10')).toBeInTheDocument();
  expect(screen.getByText('45 min')).toBeInTheDocument();
  expect(screen.getByText('Felt strong')).toBeInTheDocument();
  expect(screen.getByText('finished')).toBeInTheDocument();

  // Progress reviews + measurement comparison.
  expect(screen.getByText('Continue plan')).toBeInTheDocument();
  expect(screen.getByText('2026-02-10 – 2026-03-10')).toBeInTheDocument();
  expect(screen.getByTestId('measurement-comparison')).toHaveTextContent(
    '2026-03-10: 82',
  );

  // Read-only attendance.
  expect(screen.getByText(/1 check-in record\(s\)/)).toBeInTheDocument();
  expect(screen.getByText('2026-02-09')).toBeInTheDocument();

  // Exercise library.
  expect(screen.getByText('Goblet squat')).toBeInTheDocument();
  expect(screen.getByText('Strength')).toBeInTheDocument();
  expect(screen.getByText('Legs')).toBeInTheDocument();
  expect(screen.getByText('Kettlebell')).toBeInTheDocument();
  expect(screen.getByText('Active')).toBeInTheDocument();
});

test('renders an empty state for every card', async () => {
  installRouter();

  renderTab(true);

  expect(await screen.findByText('No workout assignments')).toBeInTheDocument();
  expect(screen.getByText('No active workout sequence')).toBeInTheDocument();
  expect(screen.getByText('No workout sessions')).toBeInTheDocument();
  expect(screen.getByText('No progress reviews')).toBeInTheDocument();
  expect(screen.getByText('No attendance records')).toBeInTheDocument();
  expect(screen.getByText('No exercises')).toBeInTheDocument();
});

test('renders the error state when the tab request fails', async () => {
  fetchMock.mockImplementation((input: unknown) => {
    const url = String(input);
    if (url.includes(ENDPOINT)) {
      return Promise.resolve(errorResponse(500, 'Workout data is unavailable'));
    }
    if (url.endsWith('/sequence')) {
      return Promise.resolve(jsonResponse([]));
    }
    return Promise.resolve(jsonResponse(EMPTY_PAGE));
  });

  renderTab(true);

  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Workout data is unavailable',
  );
});

test('issues no request until the tab becomes active (P2-09 lazy-load gate)', async () => {
  installRouter();
  const client = createTestQueryClient();

  const { view } = renderTab(false, client);

  expect(screen.getByText('Loading workouts…')).toBeInTheDocument();
  expect(fetchMock).not.toHaveBeenCalled();

  view.rerender(
    <TabHarness client={client}>
      <WorkoutsTab memberId={MEMBER_ID} active />
    </TabHarness>,
  );

  await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  const urls = fetchMock.mock.calls.map((call) => String(call[0]));
  expect(urls.some((url) => url.includes(ENDPOINT))).toBe(true);
});
