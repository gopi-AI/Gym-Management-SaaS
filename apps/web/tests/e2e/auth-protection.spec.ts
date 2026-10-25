import { expect, test } from '@playwright/test';
import { clearSession } from './helpers/auth';

/**
 * Every static application route that wraps `AuthGuard` on this revision.
 *
 * The three dynamic detail routes (`/members/[id]`, `/membership-plans/[id]`,
 * `/memberships/[id]`) also wrap the guard but need fixture ids, so they are
 * deliberately outside this first suite.
 */
const protectedRoutes = [
  '/dashboard',
  '/members',
  '/branches',
  '/organizations',
  '/membership-plans',
  '/memberships',
  '/check-in',
  '/retention-analysis',
  '/plan-performance',
  '/ai-usage',
  '/payments',
  '/settings',
];

const LOGIN_HEADING = 'Sign in to your account';

test.describe('Route protection without a session', () => {
  test.beforeEach(async ({ page }) => {
    await clearSession(page);
  });

  for (const route of protectedRoutes) {
    test(`${route} redirects to /login`, async ({ page }) => {
      await page.goto(route);
      await expect(page).toHaveURL(/\/login$/);
      await expect(
        page.getByRole('heading', { name: LOGIN_HEADING, exact: true }),
      ).toBeVisible();
    });
  }

  test('/ redirects to /login', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/login$/);
  });

  test('/login is public', async ({ page }) => {
    await page.goto('/login');
    await expect(page).toHaveURL(/\/login$/);
    await expect(
      page.getByRole('heading', { name: LOGIN_HEADING, exact: true }),
    ).toBeVisible();
  });

  test('/register is public', async ({ page }) => {
    await page.goto('/register');
    await expect(page).toHaveURL(/\/register$/);
    await expect(
      page.getByRole('heading', { name: 'Create your account', exact: true }),
    ).toBeVisible();
  });

  test('/forgot-password is public', async ({ page }) => {
    await page.goto('/forgot-password');
    await expect(page).toHaveURL(/\/forgot-password$/);
    await expect(
      page.getByRole('heading', { name: 'Reset your password', exact: true }),
    ).toBeVisible();
  });

  test('/mfa-challenge is public', async ({ page }) => {
    await page.goto('/mfa-challenge');
    await expect(page).toHaveURL(/\/mfa-challenge$/);
    await expect(
      page.getByRole('heading', { name: 'Two-factor verification', exact: true }),
    ).toBeVisible();
  });
});
