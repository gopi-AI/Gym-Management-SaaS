import { expect, test } from '@playwright/test';
import {
  getTestCredentials,
  isIsolatedApiRun,
  signInAndSelectOrg,
} from './helpers/auth';

const ISOLATION_SKIP =
  'Requires an isolated API; set E2E_API_ISOLATED=1 only after confirming the backend uses a throwaway database.';

/** Every static destination rendered by the sidebar, in menu order. */
const destinations = [
  { link: 'Dashboard', path: '/dashboard', heading: 'Dashboard' },
  { link: 'Members', path: '/members', heading: 'Members' },
  { link: 'Branches', path: '/branches', heading: 'Branches' },
  { link: 'Organizations', path: '/organizations', heading: 'Organizations' },
  { link: 'Membership Plans', path: '/membership-plans', heading: 'Membership Plans' },
  { link: 'Memberships', path: '/memberships', heading: 'Memberships' },
  { link: 'Check-in', path: '/check-in', heading: 'Check-in' },
  { link: 'Retention', path: '/retention-analysis', heading: 'Retention analysis' },
  { link: 'Plan performance', path: '/plan-performance', heading: 'Plan performance' },
  { link: 'AI usage', path: '/ai-usage', heading: 'AI usage' },
  { link: 'Payments', path: '/payments', heading: 'Payments' },
  { link: 'Settings', path: '/settings', heading: 'Settings' },
];

test.describe('Authenticated navigation', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(!isIsolatedApiRun(), ISOLATION_SKIP);
    const { email, password } = getTestCredentials();
    await signInAndSelectOrg(page, email, password);
  });

  test('sidebar links navigate, the brand returns home, and the dashboard renders', async ({
    page,
  }) => {
    // Twelve first visits, each compiled on demand by `next dev`.
    test.setTimeout(180_000);

    const sidebar = page.getByRole('navigation', { name: 'Sidebar' });

    for (const destination of destinations) {
      await test.step(`${destination.link} -> ${destination.path}`, async () => {
        await sidebar
          .getByRole('link', { name: destination.link, exact: true })
          .click();
        await expect(page).toHaveURL(new RegExp(`${destination.path}$`));
        await expect(
          page.getByRole('heading', { name: destination.heading, exact: true }),
        ).toBeVisible();
      });
    }

    await test.step('the sidebar brand returns to the dashboard', async () => {
      await page.goto('/members');
      await page
        .getByRole('complementary')
        .getByRole('link', { name: 'Gym Management', exact: true })
        .click();
      await expect(page).toHaveURL(/\/dashboard$/);
    });

    await test.step('the dashboard shows its stat cards and welcome card', async () => {
      const main = page.locator('main#content');

      for (const label of ['Members', 'Branches', 'Organizations', 'Plan']) {
        await expect(main.getByText(label, { exact: true })).toBeVisible();
      }
      await expect(
        page.getByRole('heading', { name: 'Welcome back', exact: true }),
      ).toBeVisible();
    });
  });
});
