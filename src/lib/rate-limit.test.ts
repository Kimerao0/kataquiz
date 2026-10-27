import { eq, sql } from 'drizzle-orm'
import { db } from '@/db/client'
import { rateLimits } from '@/db/schema'
import { type TestTx, withTestDb } from '@/test/db'
import { checkRateLimit } from './rate-limit'

const LIMIT = 3
const WINDOW_SEC = 3600

async function spendTheLimit(tx: TestTx, key: string) {
  return [
    await checkRateLimit(key, LIMIT, WINDOW_SEC, tx),
    await checkRateLimit(key, LIMIT, WINDOW_SEC, tx),
    await checkRateLimit(key, LIMIT, WINDOW_SEC, tx),
  ]
}

describe('checkRateLimit', () => {
  it('allows the first call for a new key', async () => {
    await withTestDb(async (tx) => {
      expect(await checkRateLimit(crypto.randomUUID(), LIMIT, WINDOW_SEC, tx)).toBe(true)
    })
  })

  it('allows calls up to the limit', async () => {
    await withTestDb(async (tx) => {
      expect(await spendTheLimit(tx, crypto.randomUUID())).toEqual([true, true, true])
    })
  })

  it('blocks the call after the limit', async () => {
    await withTestDb(async (tx) => {
      const key = crypto.randomUUID()
      await spendTheLimit(tx, key)

      expect(await checkRateLimit(key, LIMIT, WINDOW_SEC, tx)).toBe(false)
    })
  })

  it('keeps counters for different keys independent', async () => {
    await withTestDb(async (tx) => {
      const key = crypto.randomUUID()
      const other = crypto.randomUUID()
      await spendTheLimit(tx, key)

      expect(await checkRateLimit(key, LIMIT, WINDOW_SEC, tx)).toBe(false)
      expect(await checkRateLimit(other, LIMIT, WINDOW_SEC, tx)).toBe(true)
    })
  })

  it('allows again once the window has elapsed', async () => {
    await withTestDb(async (tx) => {
      const key = crypto.randomUUID()
      await spendTheLimit(tx, key)
      // Backdating the stored window beats sleeping for an hour, and the
      // expiry is computed in SQL anyway.
      await tx
        .update(rateLimits)
        .set({ windowStart: sql`now() - interval '2 hours'` })
        .where(eq(rateLimits.key, key))

      expect(await checkRateLimit(key, LIMIT, WINDOW_SEC, tx)).toBe(true)

      // Allowing without resetting would leave the counter one call from
      // blocking again, so assert the reset and not just the verdict.
      const [row] = await tx.select().from(rateLimits).where(eq(rateLimits.key, key))
      expect(row.count).toBe(1)
    })
  })

  // The one test that skips withTestDb: inside a single transaction these
  // calls are serialised, so the race it exists to catch could never happen.
  it('counts concurrent callers exactly once each', async () => {
    const key = crypto.randomUUID()
    try {
      const results = await Promise.all(
        Array.from({ length: 10 }, () => checkRateLimit(key, 5, WINDOW_SEC)),
      )

      expect(results.filter((allowed) => allowed)).toHaveLength(5)
      expect(results.filter((allowed) => !allowed)).toHaveLength(5)
    } finally {
      await db.delete(rateLimits).where(eq(rateLimits.key, key))
    }
  })
})
