import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['packages/**/*.test.ts', 'apps/**/*.test.ts', 'services/**/*.test.ts'],
    testTimeout: 20000,
    hookTimeout: 20000,
  },
});
