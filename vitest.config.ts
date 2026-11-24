import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 60000,
    hookTimeout: 60000,
    fileParallelism: false,
    exclude: [
      '**/.agents/**',
      '**/node_modules/**',
      '**/dist/**',
      '**/*.integration.test.ts',
      '**/*.runtime.test.ts'
    ],
    cache: false
  }
});
