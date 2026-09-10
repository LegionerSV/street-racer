import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: ['game/**/*.test.ts', 'scripts/**/*.test.ts'],
    environment: 'node',
  },
});
