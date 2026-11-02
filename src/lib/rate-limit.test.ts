import { eq, sql } from 'drizzle-orm'
import { db } from '@/db/client'
import { rateLimits } from '@/db/schema'
import { type TestTx, withTestDb } from '@/test/db'
import {
  checkRateLimit,
  pruneRateLimits,
  RATE_LIMIT_RETENTION_SEC,
  RESUME_WINDOW_SEC,
  RUN_START_WINDOW_SEC,
  UPLOAD_WINDOW_SEC,
} from './rate-limit'

const LIMIT = 3
const WINDOW_SEC = 3600

async function spendTheLimit(tx: TestTx, key: string) {
  return [
    await checkRateLimit(key, LIMIT, WINDOW_SEC, tx),
    await checkRateLimit(key, LIMIT, WINDOW_SEC, tx),
    await checkRateLimit(key, LIMIT, WINDOW_SEC, tx),
  ]
}

describe('pruneRateLimits', () => {
  it('deletes rows older than the retention and keeps recent ones', async () => {
    await withTestDb(async (tx) => {
      const old = crypto.randomUUID()
      const recent = crypto.randomUUID()
      await tx.insert(rateLimits).values([
        { key: old, windowStart: sql`now() - interval '2 days'`, count: 1 },
        { key: recent, windowStart: sql`now()`, count: 1 },
      ])

      // Other rows may already be stale in the shared database, so the count is a floor.
      expect(await pruneRateLimits(tx)).toBeGreaterThanOrEqual(1)

      const keys = (await tx.select().from(rateLimits)).map((row) => row.key)
      expect(keys).not.toContain(old)
      expect(keys).toContain(recent)
    })
  })

  it('keeps a row still inside the retention', async () => {
    await withTestDb(async (tx) => {
      const old = crypto.randomUUID()
      const live = crypto.randomUUID()
      await tx.insert(rateLimits).values([
        { key: old, windowStart: sql`now() - interval '2 days'`, count: 1 },
        { key: live, windowStart: sql`now() - interval '23 hours'`, count: 1 },
      ])

      await pruneRateLimits(tx)

      const keys = (await tx.select().from(rateLimits)).map((row) => row.key)
      expect(keys).not.toContain(old)
      expect(keys).toContain(live)
    })
  })

  it('never deletes a row whose window is still live', () => {
    for (const windowSec of [RUN_START_WINDOW_SEC, UPLOAD_WINDOW_SEC, RESUME_WINDOW_SEC]) {
      expect(windowSec).toBeLessThan(RATE_LIMIT_RETENTION_SEC)
    }
  })
})

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

  describe('pruning', () => {
    afterEach(() => {
      vi.restoreAllMocks()
    })

    async function insertOldRow(tx: TestTx, key: string) {
      await tx
        .insert(rateLimits)
        .values({ key, windowStart: sql`now() - interval '2 days'`, count: 1 })
    }

    async function exists(tx: TestTx, key: string) {
      const rows = await tx.select().from(rateLimits).where(eq(rateLimits.key, key))
      return rows.length > 0
    }

    it('prunes when the dice say so', async () => {
      await withTestDb(async (tx) => {
        const old = crypto.randomUUID()
        await insertOldRow(tx, old)
        vi.spyOn(Math, 'random').mockReturnValue(0)

        await checkRateLimit(crypto.randomUUID(), LIMIT, WINDOW_SEC, tx)

        expect(await exists(tx, old)).toBe(false)
      })
    })

    it('does not prune otherwise', async () => {
      await withTestDb(async (tx) => {
        const old = crypto.randomUUID()
        await insertOldRow(tx, old)
        vi.spyOn(Math, 'random').mockReturnValue(0.99)

        await checkRateLimit(crypto.randomUUID(), LIMIT, WINDOW_SEC, tx)

        expect(await exists(tx, old)).toBe(true)
      })
    })

    it('never fails the request when the prune throws', async () => {
      await withTestDb(async (tx) => {
        const boom = new Error('boom')
        const failingExecutor = new Proxy(tx, {
          get(target, prop) {
            if (prop === 'delete') {
              return () => {
                throw boom
              }
            }
            const value = Reflect.get(target, prop, target)
            return typeof value === 'function' ? value.bind(target) : value
          },
        })
        vi.spyOn(Math, 'random').mockReturnValue(0)
        const logged = vi.spyOn(console, 'error').mockImplementation(() => {})

        expect(await checkRateLimit(crypto.randomUUID(), LIMIT, WINDOW_SEC, failingExecutor)).toBe(
          true,
        )
        expect(logged).toHaveBeenCalledWith('rate_limits prune failed', boom)
      })
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
