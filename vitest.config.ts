import { defineConfig } from 'vitest/config';

// demo/ holds fixture projects (with their own *.test.ts files) that the tests read, not tests to run.
export default defineConfig({ test: { include: ['src/**/*.test.ts'] } });
