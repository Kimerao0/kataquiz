import { config as loadEnv } from 'dotenv'
import { defineConfig } from 'drizzle-kit'

// An explicitly exported DATABASE_URL (CI, or a one-off target) wins over the
// local development file.
if (!process.env.DATABASE_URL) loadEnv({ path: '.env.local', quiet: true })

const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL is not set')

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url },
})
