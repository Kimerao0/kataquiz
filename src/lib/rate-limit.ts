import { sql } from 'drizzle-orm'
import type { NodePgQueryResultHKT } from 'drizzle-orm/node-postgres'
import type { PgDatabase } from 'drizzle-orm/pg-core'
import { type Db, db } from '@/db/client'
import { rateLimits } from '@/db/schema'

// Starting a run is limited for the row it writes: one `attempts` row per
// start, so a loop over the action is database growth. The ceiling has to clear
// a drilling session, which is what KQ10 turned into one click — 120 an hour is
// a fresh run every thirty seconds sustained for a full hour, past what a
// person reps through and still nowhere near unbounded. Challenge starts share
// this budget: they take the same key.
export const RUN_START_LIMIT = 120
export const RUN_START_WINDOW_SEC = 3600

// Uploads are limited for the rows they write, not the request they cost: one
// accepted file is up to 1 quiz, 1000 questions and 10000 options, so a loop
// over this action is unbounded database growth from a single account. Ten an
// hour is well past what a person curating question banks by hand will reach,
// and the window matches RUN_START_WINDOW_SEC so both limits age the same way.
export const UPLOAD_LIMIT = 10
export const UPLOAD_WINDOW_SEC = 3600

// Resuming is limited for what the request costs, not for the rows it writes:
// it writes none, but the history is rebuilt one question at a time, so a long
// run is well over a hundred sequential round trips per call. Sixty an hour is
// far past what picking a run back up and refreshing it can reach, and the
// window matches the others so every limit ages the same way.
export const RESUME_LIMIT = 60
export const RESUME_WINDOW_SEC = 3600

// The base class of both `db` and a transaction, so tests can run the limiter
// inside the rollback harness.
type Executor = PgDatabase<NodePgQueryResultHKT, Db['_']['fullSchema']>

export async function checkRateLimit(
  key: string,
  limit: number,
  windowSec: number,
  executor: Executor = db,
): Promise<boolean> {
  // One statement on purpose: reading the count and then writing it lets two
  // concurrent callers both read the same value and both store it, so the limit
  // is breached under load. The window is measured against `now()` because the
  // database clock is the only one every caller shares.
  const expired = sql`${rateLimits.windowStart} < now() - make_interval(secs => ${windowSec})`
  const [row] = await executor
    .insert(rateLimits)
    .values({ key, windowStart: sql`now()`, count: 1 })
    .onConflictDoUpdate({
      target: rateLimits.key,
      set: {
        count: sql`case when ${expired} then 1 else ${rateLimits.count} + 1 end`,
        windowStart: sql`case when ${expired} then now() else ${rateLimits.windowStart} end`,
      },
    })
    .returning({ count: rateLimits.count })

  return row.count <= limit
}
