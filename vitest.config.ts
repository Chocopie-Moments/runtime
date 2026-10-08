import { configDefaults, defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  // Release preflight tests use node:test and run separately with node --test in CI.
  test: { exclude: [...configDefaults.exclude, 'scripts/**/*.test.mjs'] },
  resolve: {
    alias: {
      '@chocopie/runtime': fileURLToPath(new URL('./packages/runtime/src/index.ts', import.meta.url)),
    },
  },
});
