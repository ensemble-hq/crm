import { defineConfig } from 'vitest/config';

/**
 * Tests. Files beside the code they test (`src/lib/*.test.ts`) need nothing. Files in `server/test`
 * run the real services against a real Postgres: a database called `crm_test` on the development
 * server (`pnpm db:up`), created and emptied by the tests themselves. They share that one database,
 * so they run one file at a time.
 */
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'server/test/**/*.test.ts'],
    globalSetup: ['server/test/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
