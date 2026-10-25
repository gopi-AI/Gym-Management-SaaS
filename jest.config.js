/** @type {import('jest').Config} */
module.exports = {
  rootDir: '.',
  testEnvironment: 'node',
  transform: {
    '^.+\\.(t|j)s$': ['ts-jest', { tsconfig: 'tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['js', 'json', 'ts'],
  collectCoverageFrom: ['src/**/*.ts', '!src/**/*.spec.ts'],
  coverageDirectory: 'coverage',
  testMatch: ['**/*.spec.ts'],
  // Playwright E2E specs under apps/web/tests/e2e use *.spec.ts (Playwright's
  // convention) and are run by Playwright, not by this hermetic backend suite.
  testPathIgnorePatterns: ['/node_modules/', '<rootDir>/apps/web/tests/e2e/'],
  // In tests we must not try to load the real .env into the process.
  clearMocks: true,
  restoreMocks: true,
};
