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
 * Membership plan detail route: /membership-plans/[id]
 *
 * The page wraps AuthGuard and fetches the plan via
 * GET /v1/membership-plans/{id} (useMembershipPlan). A 404 from that
 * endpoint triggers notFound(). Other errors render an Alert.
 */
test.describe('Membership plan detail route protection', () => {
  test.beforeEach(async ({ page }) => {
    await clearSession(page);
  });

  test('redirects to /login when unauthenticated', async ({ page }) => {
    await page.goto('/membership-plans/00000000-0000-0000-0000-000000000000');
    await expect(page).toHaveURL(/\/login$/);
    await expect(
      page.getByRole('heading', { name: 'Sign in to your account', exact: true }),
    ).toBeVisible();
  });
});

test.describe('Membership plan detail authenticated behavior', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(!isIsolatedApiRun(), ISOLATION_SKIP);
    const { email, password } = getTestCredentials();
    await signInAndSelectOrg(page, email, password);
  });

  test('renders loading state, then the plan edit form for a valid plan', async ({
    page,
  }) => {
    // Visit the membership plans list first, grab the first plan's "Edit" link.
    await page.goto('/membership-plans');
    await expect(page.getByRole('heading', { name: 'Membership Plans', exact: true })).toBeVisible();

    const editLink = page.getByRole('link', { name: 'Edit', exact: true }).first();
    await expect(editLink).toBeVisible({ timeout: 15_000 });

    const href = await editLink.getAttribute('href');
    // When E2E_API_ISOLATED=1, the environment is advertised as ready for E2E.
    // Missing seeded data is a configuration failure, not a reason to skip.
    expect(href, 'No membership plans seeded in the isolated environment; cannot test detail view.').toBeTruthy();

    await editLink.click();
    await expect(page).toHaveURL(/\/membership-plans\/[^/]+$/);

    // The page title should be "Edit plan" (from the PlanEditForm CardTitle).
    await expect(page.getByRole('heading', { name: 'Edit plan', exact: true })).toBeVisible({
      timeout: 15_000,
    });

    // Key form fields should be present.
    await expect(page.getByLabel('Name *')).toBeVisible();
    await expect(page.getByLabel('Price *')).toBeVisible();
    await expect(page.getByLabel('Currency *')).toBeVisible();
    await expect(page.getByLabel('Billing period *')).toBeVisible();
    await expect(page.getByLabel('Duration (days) *')).toBeVisible();
    await expect(page.getByRole('checkbox', { name: 'Active' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save changes', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Back to list', exact: true })).toBeVisible();
  });

  test('shows 404 (not-found page) for a non-existent plan id', async ({ page }) => {
    const nonExistentId = '00000000-0000-0000-0000-000000000000';
    await page.goto(`/membership-plans/${nonExistentId}`);

    // The page calls notFound() when the plan endpoint returns 404.
    // Next.js renders the global not-found.tsx.
    await expect(page.getByRole('heading', { name: '404 — Page not found', exact: true })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText("The page you were looking for doesn't exist or has been moved.")).toBeVisible();
  });

  test('shows an error alert when the API returns a non-404 error', async ({ page }) => {
    test.skip(
      true,
      'Inducing a non-404 API error requires backend fault injection; not available in the current harness.',
    );
  });
});