import coreWebVitals from 'eslint-config-next/core-web-vitals';

const config = [
  { ignores: ['node_modules/', '.next/', 'scripts/', 'coverage/', 'next-env.d.ts'] },
  ...coreWebVitals,
  {
    rules: {
      // New react-hooks v6 rules (Next 16 upgrade) flag pre-existing accepted
      // patterns (localStorage hydration effects, Date formatting in render).
      // Kept visible as warnings; fixing them is a separate refactor.
      'react-hooks/purity': 'warn',
      'react-hooks/set-state-in-effect': 'warn'
    }
  }
];

export default config;
