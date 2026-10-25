import { defineConfig } from '@playwright/test';

/**
 * Playwright configuration for the web E2E suite.
 *
 * Both servers must already be running:
 *   - API:      http://localhost:3000 (with an ISOLATED database)
 *   - Frontend: http://localhost:3001
 *
 * Playwright deliberately does not start either server. The API lives outside
 * `apps/web`, needs its own isolated database, and must never be pointed at the
 * shared development database. See tests/e2e/README.md.
 *
 * Responsive viewports are set with `test.use()` inside responsive-layout.spec.ts
 * rather than with projects, so the other specs run exactly once.
 */
export default defineConfig({
  testDir: './tests/e2e',
  // Root jest uses testMatch: ['**/*.spec.ts'] (repo root jest.config.js).
  // apps/web uses testMatch: ['**/*.test.ts', '**/*.test.tsx'] (apps/web/jest.config.js).
  // Neither collects *.e2e.ts, so Playwright can safely use both *.spec.ts and *.e2e.ts.
  testMatch: ['**/*.spec.ts', '**/*.e2e.ts'],
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // Generous because `next dev` compiles each route on its first visit.
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: 'list',
  // .next/ is gitignored, so failure artifacts never dirty the worktree.
  outputDir: '.next/e2e-results',
  use: {
    baseURL: 'http://localhost:3001',
    viewport: { width: 1280, height: 720 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
