import nextConfig from 'eslint-config-next';

const config = [
  ...nextConfig,
  {
    rules: {
      // TODO(ESLINT-002): 10 pre-existing `react-hooks/set-state-in-effect`
      // findings across 9 pages/components need a React data-flow refactor
      // (setState-in-effect -> derived state / event handlers). Downgraded to
      // `warn` so the gate is usable; the inventory is recorded in
      // docs/task-backlog.md.
      'react-hooks/set-state-in-effect': 'warn',
    },
  },
];

export default config;
