import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  test: {
    // Pure tests stay in the fast node env; component tests opt into jsdom
    // per-file via `// @vitest-environment jsdom`.
    environment: 'node',
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx']
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('.', import.meta.url)),
      // `server-only`'s Node entry throws by design; in tests load its no-op
      // stub so server-only modules (lib/store) can be exercised directly.
      'server-only': 'server-only/empty.js'
    }
  },
  // Use React's automatic JSX runtime so component tests don't need `import React`.
  esbuild: { jsx: 'automatic' }
});
