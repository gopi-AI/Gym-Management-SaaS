import { expect, test } from '@playwright/test';
import {
  getTestCredentials,
  isIsolatedApiRun,
  signInAndSelectOrg,
  signOut,
} from './helpers/auth';

const ISOLATION_SKIP =
  'Requires an isolated API; set E2E_API_ISOLATED=1 only after confirming the backend uses a throwaway database.';

test.describe('E2E login flow', () => {
  test('empty credentials are rejected by the API and stay on /login', async ({ page }) => {
    test.skip(!isIsolatedApiRun(), ISOLATION_SKIP);

    await page.goto('/login');

    // LoginForm.tsx sets `noValidate`, so the browser does NOT block an empty
    // submit. Assert the observed behavior: the request reaches the API, the
    // API rejects the empty email (400), and the page stays on /login.
    await expect(page.locator('form')).toHaveJSProperty('noValidate', true);
    await expect(page.locator('#login-email')).toHaveAttribute('required', '');
    await expect(page.locator('#login-password')).toHaveAttribute('required', '');
    await expect(page.locator('#login-password')).toHaveAttribute('minlength', '8');

    const responsePromise = page.waitForResponse(
      (response) =>
        response.url().endsWith('/v1/auth/login') &&
        response.request().method() === 'POST',
    );

    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    const response = await responsePromise;

    expect(response.status()).toBe(400);
    await expect(page.locator('.alert[role="alert"]')).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
  });

  test('invalid credentials show an error and stay on /login', async ({ page }) => {
    test.skip(!isIsolatedApiRun(), ISOLATION_SKIP);
    const { email } = getTestCredentials();

    await page.goto('/login');
    await page.getByPlaceholder('you@example.com').fill(email);
    await page.getByPlaceholder('Your password').fill('definitely-not-the-password-1');

    const responsePromise = page.waitForResponse(
      (response) =>
        response.url().endsWith('/v1/auth/login') &&
        response.request().method() === 'POST',
    );

    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    const response = await responsePromise;

    expect(response.status()).toBe(401);
    await expect(page.locator('.alert[role="alert"]')).toContainText('Invalid credentials');
    await expect(page).toHaveURL(/\/login$/);
  });

  test('valid credentials sign in, select a tenant, then sign out cleanly', async ({ page }) => {
    test.skip(!isIsolatedApiRun(), ISOLATION_SKIP);
    const { email, password } = getTestCredentials();

    await test.step('sign in through the form and store the token pair', async () => {
      await signInAndSelectOrg(page, email, password);

      await expect(page).toHaveURL(/\/organizations$/);
      const stored = await page.evaluate(() => ({
        access: window.localStorage.getItem('gym.accessToken'),
        refresh: window.localStorage.getItem('gym.refreshToken'),
        organization: window.localStorage.getItem('gym.organizationId'),
      }));
      expect(stored.access).toBeTruthy();
      expect(stored.refresh).toBeTruthy();
      expect(stored.organization).toBeTruthy();
    });

    await test.step('sign out and clear every session key', async () => {
      await signOut(page);
      await expect(page).toHaveURL(/\/login$/);

      const stored = await page.evaluate(() => ({
        access: window.localStorage.getItem('gym.accessToken'),
        refresh: window.localStorage.getItem('gym.refreshToken'),
        organization: window.localStorage.getItem('gym.organizationId'),
      }));
      expect(stored.access).toBeNull();
      expect(stored.refresh).toBeNull();
      expect(stored.organization).toBeNull();
    });

    await test.step('a protected route redirects after sign-out', async () => {
      await page.goto('/members');
      await expect(page).toHaveURL(/\/login$/);
    });
  });
});
