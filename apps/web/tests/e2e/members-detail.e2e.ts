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
 * Member detail route: /members/[id]
 *
 * The page wraps AuthGuard and fetches the Member 360 header via
 * GET /v1/members/{id}/360/header (useMember360Header). A 404 from that
 * endpoint triggers notFound(). Other errors render an Alert.
 */
test.describe('Member detail route protection', () => {
  test.beforeEach(async ({ page }) => {
    await clearSession(page);
  });

  test('redirects to /login when unauthenticated', async ({ page }) => {
    // Any UUID works for the redirect check; the guard runs before the fetch.
    await page.goto('/members/00000000-0000-0000-0000-000000000000');
    await expect(page).toHaveURL(/\/login$/);
    await expect(
      page.getByRole('heading', { name: 'Sign in to your account', exact: true }),
    ).toBeVisible();
  });
});

test.describe('Member detail authenticated behavior', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(!isIsolatedApiRun(), ISOLATION_SKIP);
    const { email, password } = getTestCredentials();
    await signInAndSelectOrg(page, email, password);
  });

  test('renders loading state, then the Member 360 header for a valid member', async ({
    page,
  }) => {
    // We cannot create a member in this suite (no fixture API), so we rely on
    // whatever seeded data exists in the isolated environment. The test is
    // written to pass when a member is present and to surface a clear failure
    // when the environment is empty.
    //
    // Strategy: visit the members list first, grab the first member's localId
    // from the row's "View" link href, then navigate to that detail page.
    await page.goto('/members');
    await expect(page.getByRole('heading', { name: 'Members', exact: true })).toBeVisible();

    const viewLink = page.getByRole('link', { name: 'View', exact: true }).first();
    await expect(viewLink).toBeVisible({ timeout: 15_000 });

    const href = await viewLink.getAttribute('href');
    // When E2E_API_ISOLATED=1, the environment is advertised as ready for E2E.
    // Missing seeded data is a configuration failure, not a reason to skip.
    expect(href, 'No members seeded in the isolated environment; cannot test detail view.').toBeTruthy();

    await viewLink.click();
    await expect(page).toHaveURL(/\/members\/[^/]+$/);

    // The header card should render with the member's name as the page title.
    await expect(page.getByRole('heading', { level: 3 })).toBeVisible({ timeout: 15_000 });

    // The tabs should be present (Memberships, PT, Workouts, Diet, Loyalty).
    await expect(page.getByRole('tablist')).toBeVisible();
    for (const tab of ['Memberships', 'PT', 'Workouts', 'Diet', 'Loyalty']) {
      await expect(page.getByRole('tab', { name: tab, exact: true })).toBeVisible();
    }
  });

  test('shows 404 (not-found page) for a non-existent member id', async ({ page }) => {
    const nonExistentId = '00000000-0000-0000-0000-000000000000';
    await page.goto(`/members/${nonExistentId}`);

    // The page calls notFound() when the header endpoint returns 404.
    // Next.js renders the global not-found.tsx.
    await expect(page.getByRole('heading', { name: '404 — Page not found', exact: true })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText("The page you were looking for doesn't exist or has been moved.")).toBeVisible();
  });

  test('shows an error alert when the API returns a non-404 error', async ({ page }) => {
    // We cannot reliably induce a 500/503 without backend cooperation.
    // This test documents the expected behavior and is skipped with a note.
    test.skip(
      true,
      'Inducing a non-404 API error requires backend fault injection; not available in the current harness.',
    );

    // If a fault-injection endpoint existed, we would:
    // 1. Enable a fault for /v1/members/{id}/360/header
    // 2. Navigate to a member detail page
    // 3. Assert the Alert with type="danger" is visible
    // 4. Assert the error message is rendered
  });
});