/**
 * @jest-environment jsdom
 */

/**
 * DietTab — the Diet Member 360 tab (P2-09).
 *
 * Three cards: assigned diet plans, the last-30-days daily totals, and the raw
 * nutrition logs. The daily-totals fixture deliberately carries a day whose
 * macros are absent (`null` -> the tab renders an em dash) alongside a complete
 * day, and reports meals excluded from the sums.
 */

import '@testing-library/jest-dom';
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import type { DietDailyTotal, DietPlanAssignment, DietTabResponse, NutritionLog } from '@/lib';
import DietTab from './DietTab';
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
const ENDPOINT = `/v1/members/${MEMBER_ID}/diet`;

const DIET_PLAN: DietPlanAssignment = {
  id: 'dp-1',
  organization_id: 'org-1',
  member_id: MEMBER_ID,
  diet_plan_id: 'diet-4',
  assigned_by: 'user-1',
  assigned_at: '2026-02-01T00:00:00.000Z',
  start_date: '2026-02-01',
  end_date: '2026-03-01',
  status: 'active',
  created_at: '2026-02-01T00:00:00.000Z',
  updated_at: '2026-02-01T00:00:00.000Z',
};

const DAILY_TOTAL: DietDailyTotal = {
  log_date: '2026-02-14',
  totalCalories: 1800,
  totalProteinG: 120,
  totalCarbsG: 210,
  totalFatG: 62,
  mealsMissingMacros: 1,
  totalMeals: 4,
  adherencePct: 67,
};

const NUTRITION_LOG: NutritionLog = {
  id: 'nl-1',
  organization_id: 'org-1',
  member_id: MEMBER_ID,
  log_date: '2026-02-15',
  meal_description: 'Chicken salad',
  servings: 5,
  calories: 450,
  protein_g: '35.5',
  carbs_g: '22',
  fat_g: '13',
  logged_at: '2026-02-15T12:00:00.000Z',
  created_at: '2026-02-15T12:00:00.000Z',
};

const EMPTY: DietTabResponse = { dietPlans: [], nutritionLogs: [], dailyTotals: [] };

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
      <DietTab memberId={MEMBER_ID} active={active} />
    </TabHarness>,
  );
  return { view, client };
}

test('renders the loading state while the request is in flight', () => {
  fetchMock.mockReturnValueOnce(pendingResponse());

  renderTab(true);

  expect(screen.getByText('Loading diet data…')).toBeInTheDocument();
});

test('renders the fetched plans, daily totals and nutrition logs', async () => {
  const body: DietTabResponse = {
    dietPlans: [DIET_PLAN],
    dailyTotals: [DAILY_TOTAL],
    nutritionLogs: [NUTRITION_LOG],
  };
  fetchMock.mockResolvedValueOnce(jsonResponse(body));

  renderTab(true);

  expect(await screen.findByText('diet-4')).toBeInTheDocument();
  expect(String(fetchMock.mock.calls[0][0])).toContain(ENDPOINT);

  // Diet plans card.
  expect(screen.getByText('active')).toBeInTheDocument();
  expect(screen.getByText('2026-02-01')).toBeInTheDocument();
  expect(screen.getByText('2026-03-01')).toBeInTheDocument();
  expect(screen.getByText('user-1')).toBeInTheDocument();

  // Daily totals card: macros, adherence and the excluded-meal count.
  expect(screen.getByText('2026-02-14')).toBeInTheDocument();
  expect(screen.getByText('1800')).toBeInTheDocument();
  expect(screen.getByText('120')).toBeInTheDocument();
  expect(screen.getByText('210')).toBeInTheDocument();
  expect(screen.getByText('62')).toBeInTheDocument();
  expect(screen.getByText('67%')).toBeInTheDocument();
  expect(screen.getByText('1 of 4')).toBeInTheDocument();

  // Nutrition logs card.
  expect(screen.getByText('2026-02-15')).toBeInTheDocument();
  expect(screen.getByText('Chicken salad')).toBeInTheDocument();
  expect(screen.getByText('5')).toBeInTheDocument();
  expect(screen.getByText('450')).toBeInTheDocument();
  expect(screen.getByText('35.5')).toBeInTheDocument();
  expect(screen.getByText('22')).toBeInTheDocument();
  expect(screen.getByText('13')).toBeInTheDocument();
});

test('renders an empty state for each of the three cards', async () => {
  fetchMock.mockResolvedValueOnce(jsonResponse(EMPTY));

  renderTab(true);

  expect(await screen.findByText('No diet plans')).toBeInTheDocument();
  expect(screen.getByText('No nutrition logged')).toBeInTheDocument();
  expect(screen.getByText('No meals logged')).toBeInTheDocument();
});

test('renders the error state when the request fails', async () => {
  fetchMock.mockResolvedValueOnce(errorResponse(500, 'Diet data is unavailable'));

  renderTab(true);

  expect(await screen.findByRole('alert')).toHaveTextContent('Diet data is unavailable');
});

test('issues no request until the tab becomes active (P2-09 lazy-load gate)', async () => {
  fetchMock.mockResolvedValue(jsonResponse(EMPTY));
  const client = createTestQueryClient();

  const { view } = renderTab(false, client);

  expect(screen.getByText('Loading diet data…')).toBeInTheDocument();
  expect(fetchMock).not.toHaveBeenCalled();

  view.rerender(
    <TabHarness client={client}>
      <DietTab memberId={MEMBER_ID} active />
    </TabHarness>,
  );

  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  expect(String(fetchMock.mock.calls[0][0])).toContain(ENDPOINT);
});
