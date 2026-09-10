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
  // In tests we must not try to load the real .env into the process.
  clearMocks: true,
  restoreMocks: true,
};
