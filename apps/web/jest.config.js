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
  // Mirrors the `@/*` path alias in `tsconfig.json`. ts-jest only transpiles;
  // it does not rewrite TypeScript path aliases, so every component that
  // imports from `@/lib` or `@/components/...` needs this to resolve.
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  // Deliberately `*.test.ts`/`*.test.tsx` and NOT `*.spec.ts`. The
  // repository-root jest config uses `testMatch: ['**/*.spec.ts']` with
  // `rootDir: '.'`, so a `*.spec.ts` placed here is collected by the backend
  // `npx jest` run and fails there: that run compiles with `tsconfig.spec.json`
  // at the repo root, whose `lib` has no DOM, so `window` in `token-store.ts`
  // is a TS2304 error. `.test.tsx` is safe for the same reason — the root run
  // collects `.spec.ts` only.
  testMatch: ['**/*.test.ts', '**/*.test.tsx'],
  clearMocks: true,
  restoreMocks: true,
};
