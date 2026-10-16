/**
 * @jest-environment jsdom
 */

/**
 * MembershipsTab — the first Member 360 tab (P2-09).
 *
 * Covers the four render states plus the lazy-load contract the tab exists to
 * satisfy: its query is disabled until the panel is the active tab, so an
 * inactive tab must issue no request at all.
 */

import '@testing-library/jest-dom';
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import type { Membership, Paginated } from '@/lib';
import MembershipsTab from './MembershipsTab';
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
const ENDPOINT = `/v1/memberships/member/${MEMBER_ID}`;

const MEMBERSHIP: Membership = {
  id: 'ms-1',
  organization_id: 'org-1',
  member_id: MEMBER_ID,
  plan_id: 'plan-9',
  branch_id: 'branch-1',
  status: 'active',
  start_date: '2026-01-01',
  end_date: '2026-12-31',
  price_at_signup: '49.99',
  currency_at_signup: 'USD',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

const EMPTY_PAGE: Paginated<Membership> = { data: [], total: 0, page: 1, limit: 20 };

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
      <MembershipsTab memberId={MEMBER_ID} active={active} />
    </TabHarness>,
  );
  return { view, client };
}

test('renders the loading state while the request is in flight', () => {
  fetchMock.mockReturnValueOnce(pendingResponse());

  renderTab(true);

  expect(screen.getByText('Loading memberships…')).toBeInTheDocument();
});

test('renders the fetched memberships', async () => {
  const page: Paginated<Membership> = { data: [MEMBERSHIP], total: 1, page: 1, limit: 20 };
  fetchMock.mockResolvedValueOnce(jsonResponse(page));

  renderTab(true);

  expect(await screen.findByText('plan-9')).toBeInTheDocument();

  // It reads its own endpoint, with the tab's page size.
  const requestedUrl = String(fetchMock.mock.calls[0][0]);
  expect(requestedUrl).toContain(ENDPOINT);
  expect(requestedUrl).toContain('limit=20');

  expect(screen.getByText('active')).toBeInTheDocument();
  expect(screen.getByText('2026-01-01')).toBeInTheDocument();
  expect(screen.getByText('2026-12-31')).toBeInTheDocument();
  expect(screen.getByText('49.99 USD')).toBeInTheDocument();
  expect(screen.getByText('1 membership')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'View' })).toHaveAttribute(
    'href',
    '/memberships/ms-1',
  );
});

test('renders the empty state when the member has no memberships', async () => {
  fetchMock.mockResolvedValueOnce(jsonResponse(EMPTY_PAGE));

  renderTab(true);

  expect(await screen.findByText('No memberships')).toBeInTheDocument();
});

test('renders the error state when the request fails', async () => {
  fetchMock.mockResolvedValueOnce(errorResponse(500, 'Memberships are unavailable'));

  renderTab(true);

  expect(await screen.findByRole('alert')).toHaveTextContent('Memberships are unavailable');
});

test('issues no request until the tab becomes active (P2-09 lazy-load gate)', async () => {
  fetchMock.mockResolvedValue(jsonResponse(EMPTY_PAGE));
  const client = createTestQueryClient();

  const { view } = renderTab(false, client);

  // An inactive panel is still mounted — the page only hides it with `d-none` —
  // but its query is disabled, so no HTTP request is issued.
  expect(screen.getByText('Loading memberships…')).toBeInTheDocument();
  expect(fetchMock).not.toHaveBeenCalled();

  view.rerender(
    <TabHarness client={client}>
      <MembershipsTab memberId={MEMBER_ID} active />
    </TabHarness>,
  );

  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  expect(String(fetchMock.mock.calls[0][0])).toContain(ENDPOINT);
});
