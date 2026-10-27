import { fileURLToPath } from 'node:url'
import { config as loadEnv } from 'dotenv'
import { defineConfig } from 'vitest/config'

// Tests talk to a real Postgres, never a mock. .env.test points at the
// throwaway database created by compose.yaml.
loadEnv({ path: '.env.test', quiet: true })

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Integration tests share one database; parallel files would deadlock
    // on the same tables.
    fileParallelism: false,
    // Applies migrations to the test database before anything runs.
    globalSetup: ['./src/test/global-setup.ts'],
  },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
})
