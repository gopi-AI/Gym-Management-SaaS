import { expect, test } from '@playwright/test';
import {
  getTestCredentials,
  isIsolatedApiRun,
  signInAndSelectOrg,
} from './helpers/auth';

const ISOLATION_SKIP =
  'Requires an isolated API; set E2E_API_ISOLATED=1 only after confirming the backend uses a throwaway database.';

test.describe('Desktop layout (1280x720)', () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test('the sidebar and brand are visible', async ({ page }) => {
    test.skip(!isIsolatedApiRun(), ISOLATION_SKIP);
    const { email, password } = getTestCredentials();
    await signInAndSelectOrg(page, email, password);

    const sidebar = page.getByRole('navigation', { name: 'Sidebar' });
    await expect(sidebar).toBeVisible();
    await expect(
      sidebar.getByRole('link', { name: 'Members', exact: true }),
    ).toBeVisible();
    await expect(
      page
        .getByRole('complementary')
        .getByRole('link', { name: 'Gym Management', exact: true }),
    ).toBeVisible();
  });
});

test.describe('Mobile layout (375x667)', () => {
  test.use({ viewport: { width: 375, height: 667 } });

  test('the sidebar starts collapsed and its toggler works', async ({ page }) => {
    test.skip(!isIsolatedApiRun(), ISOLATION_SKIP);
    const { email, password } = getTestCredentials();
    await signInAndSelectOrg(page, email, password);

    const sidebar = page.getByRole('navigation', { name: 'Sidebar' });
    await expect(sidebar).toBeHidden();

    const toggler = page.getByRole('button', {
      name: 'Toggle sidebar navigation',
      exact: true,
    });
    await expect(toggler).toBeVisible();
    await toggler.click();

    await expect(toggler).toHaveAttribute('aria-expanded', 'true');
    await expect(sidebar).toBeVisible();
  });

  test('the login form is usable on mobile', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByPlaceholder('you@example.com')).toBeVisible();
    await expect(page.getByPlaceholder('Your password')).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Sign in', exact: true }),
    ).toBeEnabled();
  });
});
