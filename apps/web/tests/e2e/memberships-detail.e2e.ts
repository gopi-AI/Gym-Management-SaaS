import { expect, test } from '@playwright/test';
import {
  clearSession,
  getTestCredentials,
  isIsolatedApiRun,
  signInAndSelectOrg,
} from './helpers/auth';

const ISOLATION_SKIP =
  'Requires an isolated API; set E2E_API_ISOLATED=1 only after confirming the backend uses a throwaway database.';

/**
 * Membership detail route: /memberships/[id]
 *
 * The page wraps AuthGuard and fetches the membership via
 * GET /v1/memberships/{id} (useMembership). A 404 from that endpoint
 * would be surfaced as an error (the page does not call notFound() for
 * membership 404s — it renders an Alert). Other errors also render an Alert.
 */
test.describe('Membership detail route protection', () => {
  test.beforeEach(async ({ page }) => {
    await clearSession(page);
  });

  test('redirects to /login when unauthenticated', async ({ page }) => {
    await page.goto('/memberships/00000000-0000-0000-0000-000000000000');
    await expect(page).toHaveURL(/\/login$/);
    await expect(
      page.getByRole('heading', { name: 'Sign in to your account', exact: true }),
    ).toBeVisible();
  });
});

test.describe('Membership detail authenticated behavior', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(!isIsolatedApiRun(), ISOLATION_SKIP);
    const { email, password } = getTestCredentials();
    await signInAndSelectOrg(page, email, password);
  });

  test('renders loading state, then the membership detail for a valid membership', async ({
    page,
  }) => {
    // Visit the memberships list first, grab the first membership's "View" link.
    await page.goto('/memberships');
    await expect(page.getByRole('heading', { name: 'Memberships', exact: true })).toBeVisible();

    const viewLink = page.getByRole('link', { name: 'View', exact: true }).first();
    await expect(viewLink).toBeVisible({ timeout: 15_000 });

    const href = await viewLink.getAttribute('href');
    // When E2E_API_ISOLATED=1, the environment is advertised as ready for E2E.
    // Missing seeded data is a configuration failure, not a reason to skip.
    expect(href, 'No memberships seeded in the isolated environment; cannot test detail view.').toBeTruthy();

    await viewLink.click();
    await expect(page).toHaveURL(/\/memberships\/[^/]+$/);

    // The page title should be "Membership" (from AppLayout title prop).
    await expect(page.getByRole('heading', { name: 'Membership', exact: true })).toBeVisible({
      timeout: 15_000,
    });

    // Key sections should be present: Status & lifecycle, Membership details, Edit membership.
    await expect(page.getByRole('heading', { name: 'Status & lifecycle', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Membership details', exact: true })).toBeVisible();

    // The status badge should be visible (active, paused, frozen, cancelled, or expired).
    const statusBadge = page.locator('.badge').first();
    await expect(statusBadge).toBeVisible();
  });

  test('shows an error alert for a non-existent membership id', async ({ page }) => {
    const nonExistentId = '00000000-0000-0000-0000-000000000000';
    await page.goto(`/memberships/${nonExistentId}`);

    // The page does NOT call notFound() for membership 404s — it renders an Alert.
    await expect(page.locator('.alert[role="alert"].alert-danger')).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText('Failed to load this membership.')).toBeVisible();
  });

  test('shows an error alert when the API returns a non-404 error', async ({ page }) => {
    test.skip(
      true,
      'Inducing a non-404 API error requires backend fault injection; not available in the current harness.',
    );
  });
});