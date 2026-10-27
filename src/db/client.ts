import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schema from './schema'

const connectionString = process.env.DATABASE_URL
if (!connectionString) throw new Error('DATABASE_URL is not set')

export const pool = new Pool({ connectionString })

// The schema is passed so the relational query API (`db.query`) is available.
export const db = drizzle(pool, { schema })

export type Db = typeof db
