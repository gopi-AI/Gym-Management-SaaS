import { expect, type Page } from '@playwright/test';

export interface TestCredentials {
  email: string;
  password: string;
}

/** The organization `npm run bootstrap:dev` links the development user to. */
export const DEVELOPMENT_ORG_NAME = 'Development Gym';

/**
 * Credentials are never defaulted. A missing value is a configuration error,
 * not a reason to fall back to a shared account.
 */
export function getTestCredentials(): TestCredentials {
  const email = process.env.E2E_TEST_EMAIL;
  const password = process.env.E2E_TEST_PASSWORD;

  if (!email) {
    throw new Error(
      'E2E_TEST_EMAIL is required for authenticated E2E tests (no default is provided).',
    );
  }
  if (!password) {
    throw new Error(
      'E2E_TEST_PASSWORD is required for authenticated E2E tests (no default is provided).',
    );
  }

  return { email, password };
}

/**
 * True only after an operator confirms the backend uses a throwaway database.
 * This is the machine-readable form of the "safely available and isolated"
 * requirement; it is not proof of isolation by itself.
 */
export function isIsolatedApiRun(): boolean {
  return process.env.E2E_API_ISOLATED === '1';
}

/**
 * Establish an authenticated session through the real login form.
 *
 * This is the only supported way to authenticate a test. Tokens are never
 * injected into localStorage by the harness.
 *
 * The account must not require MFA: an MFA challenge redirects to
 * /mfa-challenge and this helper times out.
 */
export async function signInViaUI(
  page: Page,
  email: string,
  password: string,
): Promise<void> {
  await page.goto('/login');
  await page.getByPlaceholder('you@example.com').fill(email);
  await page.getByPlaceholder('Your password').fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL('**/dashboard');
}

/**
 * Select the tenant through the real /organizations screen.
 *
 * Login stores only the token pair; `X-Organization-Id` is attached to API
 * calls only after the user chooses an organization. Every authenticated spec
 * that exercises tenant-scoped pages therefore selects one here.
 */
export async function selectOrganization(
  page: Page,
  organizationName: string = DEVELOPMENT_ORG_NAME,
): Promise<void> {
  await page.goto('/organizations');

  const row = page.getByRole('row', {
    name: new RegExp(escapeRegExp(organizationName)),
  });
  await expect(row).toBeVisible({ timeout: 15_000 });
  await row.getByRole('button', { name: 'Use', exact: true }).click();

  await expect
    .poll(() => page.evaluate(() => window.localStorage.getItem('gym.organizationId')))
    .toBeTruthy();
}

/** Sign in through the UI, then select the tenant the same way a user does. */
export async function signInAndSelectOrg(
  page: Page,
  email: string,
  password: string,
  organizationName: string = DEVELOPMENT_ORG_NAME,
): Promise<void> {
  await signInViaUI(page, email, password);
  await selectOrganization(page, organizationName);
}

/**
 * Sign out through the visible sidebar user menu.
 *
 * In this Tabler vertical layout the top header is not rendered as a visible
 * element; the sidebar footer carries the only visible "Open user menu" link.
 * The dropdown is opened by Tabler's bundled Bootstrap JS, which the app loads
 * from cdn.jsdelivr.net (src/app/layout.tsx). The menu must be reachable for
 * this helper to work.
 */
export async function signOut(page: Page): Promise<void> {
  const sidebar = page.getByRole('complementary');
  await sidebar.getByRole('link', { name: 'Open user menu', exact: true }).click();
  await sidebar.getByRole('link', { name: 'Sign out', exact: true }).click();
  await page.waitForURL('**/login');
}

/**
 * Remove every session key from localStorage.
 *
 * Used only to make an unauthenticated context explicit; never used to
 * establish an authenticated one.
 */
export async function clearSession(page: Page): Promise<void> {
  await page.goto('/login');
  await page.evaluate(() => {
    window.localStorage.removeItem('gym.accessToken');
    window.localStorage.removeItem('gym.refreshToken');
    window.localStorage.removeItem('gym.organizationId');
  });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
