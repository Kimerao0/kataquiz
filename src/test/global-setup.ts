import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { Pool } from 'pg'

// Brings the test database up to date once per run, so nobody has to remember
// a manual migration step before `pnpm test`.
export default async function setup() {
  const connectionString = process.env.DATABASE_URL
  // Without this guard pg falls back to libpq defaults and the suite would
  // quietly migrate and test whatever database happens to be reachable.
  if (!connectionString) throw new Error('DATABASE_URL is not set (expected from .env.test)')

  const pool = new Pool({ connectionString })
  try {
    await migrate(drizzle(pool), { migrationsFolder: './drizzle' })
  } finally {
    await pool.end()
  }
}
