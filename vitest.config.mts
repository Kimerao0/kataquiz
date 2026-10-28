import { fileURLToPath } from 'node:url'
import { config as loadEnv } from 'dotenv'
import { defineConfig } from 'vitest/config'

// Tests talk to a real Postgres, never a mock. .env.test points at the
// throwaway database created by compose.yaml.
loadEnv({ path: '.env.test', quiet: true })

export default defineConfig({
  test: {
    globals: true,
    // Integration tests share one database; parallel files would deadlock
    // on the same tables.
    fileParallelism: false,
    // Two environments in one `vitest run`, so `pnpm check` stays one command.
    // `environmentMatchGlobs` was removed in vitest 4, and a per-file docblock
    // would leave the DOM setup and the database globalSetup applying to every
    // file; projects scope both. Each inherits this config (`extends` defaults
    // to true), so the alias, globals and fileParallelism above are shared.
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          environment: 'node',
          // .ts only: component tests are .tsx and belong to the project below.
          include: ['src/**/*.test.ts'],
          // Applies migrations to the test database before anything runs.
          globalSetup: ['./src/test/global-setup.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'jsdom',
          environment: 'jsdom',
          include: ['src/**/*.test.tsx'],
          // No globalSetup here: component tests never touch Postgres.
          setupFiles: ['./src/test/setup-dom.ts'],
        },
      },
    ],
  },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
})
