module.exports = {
  root: true,
  env: {
    node: true,
    jest: true,
  },
  ignorePatterns: [
    'dist/',
    'node_modules/',
    'coverage/',
    '*.js',
    'apps/',
  ],
  overrides: [
    {
      files: ['src/**/*.ts', 'packages/**/*.ts'],
      parser: '@typescript-eslint/parser',
      parserOptions: {
        sourceType: 'module',
      },
      plugins: ['@typescript-eslint'],
      extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
      rules: {
        // Legacy exemptions — see follow-up ticket ESLINT-001.
        //
        // Not auto-fixable, requires manual refactor across the codebase:
        //   - Replace `any` with proper types
        //   - Remove or prefix unused variables/imports
        //   - Replace `object`/`Function` with specific interfaces
        //   - Convert `require()` to `import`
        //
        // These rules should be re-enabled incrementally, starting with
        // `no-var-requires` and `ban-types` as they have the fewest violations.
        '@typescript-eslint/no-explicit-any': 'off',
        '@typescript-eslint/ban-types': 'off',
        '@typescript-eslint/no-unused-vars': 'off',
        '@typescript-eslint/no-var-requires': 'off',
      },
    },
  ],
};

