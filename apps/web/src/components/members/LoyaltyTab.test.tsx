/**
 * @jest-environment jsdom
 */

/**
 * LoyaltyTab — the Loyalty Member 360 tab (P2-08/P2-09).
 *
 * This tab has one behaviour the other four do not: a `404` from the loyalty
 * route means "this member has no loyalty account row yet" — the account is
 * created by the first point-earning event — so the tab must render an empty
 * state rather than an error. That branch is pinned separately below.
 *
 * The transaction timestamps are rendered with `toLocaleString()` /
 * `toLocaleDateString()` and are therefore not asserted.
 */

import '@testing-library/jest-dom';
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import type { LoyaltyAccount, LoyaltyTabResponse, LoyaltyTransaction } from '@/lib';
import LoyaltyTab from './LoyaltyTab';
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
const ENDPOINT = `/v1/members/${MEMBER_ID}/loyalty`;

const ACCOUNT: LoyaltyAccount = {
  id: 'la-1',
  organization_id: 'org-1',
  member_id: MEMBER_ID,
  balance: 250,
  lifetime_points_earned: 400,
  lifetime_points_redeemed: 0,
  tier: 'gold',
  created_at: '2026-02-01T00:00:00.000Z',
  updated_at: '2026-02-01T00:00:00.000Z',
};

const TRANSACTION: LoyaltyTransaction = {
  id: 'lt-1',
  account_id: 'la-1',
  transaction_type: 'earn',
  points: 50,
  remaining_points: 45,
  reference_type: 'check_in',
  reference_id: 'evt-1',
  expires_at: '2026-12-31T00:00:00.000Z',
  created_at: '2026-02-14T09:00:00.000Z',
};

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
      <LoyaltyTab memberId={MEMBER_ID} active={active} />
    </TabHarness>,
  );
  return { view, client };
}

test('renders the loading state while the request is in flight', () => {
  fetchMock.mockReturnValueOnce(pendingResponse());

  renderTab(true);

  expect(screen.getByText('Loading loyalty…')).toBeInTheDocument();
});

test('renders the fetched account balances and transactions', async () => {
  const body: LoyaltyTabResponse = { account: ACCOUNT, transactions: [TRANSACTION] };
  fetchMock.mockResolvedValueOnce(jsonResponse(body));

  renderTab(true);

  expect(await screen.findByText('gold')).toBeInTheDocument();
  expect(String(fetchMock.mock.calls[0][0])).toContain(ENDPOINT);

  // Account card.
  expect(screen.getByText('250')).toBeInTheDocument();
  expect(screen.getByText('400')).toBeInTheDocument();
  expect(screen.getByText('0')).toBeInTheDocument();

  // Transactions table.
  expect(screen.getByText('earn')).toBeInTheDocument();
  expect(screen.getByText('50')).toBeInTheDocument();
  expect(screen.getByText('45')).toBeInTheDocument();
  expect(screen.getByText('check_in · evt-1')).toBeInTheDocument();
});

test('renders the empty state when the account exists but has no transactions', async () => {
  const body: LoyaltyTabResponse = { account: ACCOUNT, transactions: [] };
  fetchMock.mockResolvedValueOnce(jsonResponse(body));

  renderTab(true);

  expect(await screen.findByText('No transactions')).toBeInTheDocument();
  // The account card still renders alongside it.
  expect(screen.getByText('250')).toBeInTheDocument();
});

test('renders a 404 as "no loyalty account", not as an error', async () => {
  fetchMock.mockResolvedValueOnce(errorResponse(404, 'Loyalty account not found'));

  renderTab(true);

  expect(await screen.findByText('No loyalty account')).toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

test('renders any other failure as an error', async () => {
  fetchMock.mockResolvedValueOnce(errorResponse(500, 'Loyalty data is unavailable'));

  renderTab(true);

  expect(await screen.findByRole('alert')).toHaveTextContent('Loyalty data is unavailable');
});

test('issues no request until the tab becomes active (P2-09 lazy-load gate)', async () => {
  fetchMock.mockResolvedValue(jsonResponse({ account: ACCOUNT, transactions: [] }));
  const client = createTestQueryClient();

  const { view } = renderTab(false, client);

  expect(screen.getByText('Loading loyalty…')).toBeInTheDocument();
  expect(fetchMock).not.toHaveBeenCalled();

  view.rerender(
    <TabHarness client={client}>
      <LoyaltyTab memberId={MEMBER_ID} active />
    </TabHarness>,
  );

  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  expect(String(fetchMock.mock.calls[0][0])).toContain(ENDPOINT);
});
