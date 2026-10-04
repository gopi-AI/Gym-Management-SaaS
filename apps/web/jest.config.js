const path = require('path');

/** @type {import('jest').Config} */
module.exports = {
  rootDir: '.',
  testEnvironment: 'node',
  transform: {
    // Absolute: ts-jest resolves a bare `tsconfig` path against the *current
    // working directory*, not `rootDir`, so running jest from the repository
    // root would silently compile these specs with the backend tsconfig.
    '^.+\\.tsx?$': [
      'ts-jest',
      { tsconfig: path.join(__dirname, 'tsconfig.spec.json') },
    ],
  },
  moduleFileExtensions: ['js', 'json', 'ts', 'tsx'],
  // Deliberately `*.test.ts` and NOT `*.spec.ts`. The repository-root jest
  // config uses `testMatch: ['**/*.spec.ts']` with `rootDir: '.'`, so a
  // `*.spec.ts` placed here is collected by the backend `npx jest` run and
  // fails there: that run compiles with `tsconfig.spec.json` at the repo root,
  // whose `lib` has no DOM, so `window` in `token-store.ts` is a TS2304 error.
  testMatch: ['**/*.test.ts'],
  clearMocks: true,
  restoreMocks: true,
};
