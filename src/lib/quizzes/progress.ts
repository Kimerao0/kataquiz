import { and, eq, inArray, isNotNull } from 'drizzle-orm'
import type { NodePgQueryResultHKT } from 'drizzle-orm/node-postgres'
import type { PgDatabase } from 'drizzle-orm/pg-core'
import { type Db, db } from '@/db/client'
import { attempts, quizzes } from '@/db/schema'
import { bestTier, type Tier, tierFor } from '@/lib/run/engine'

// The base class of both `db` and a transaction, so tests can read through the
// rollback harness.
type Executor = PgDatabase<NodePgQueryResultHKT, Db['_']['fullSchema']>

// The best tier a signed-in player has reached on each quiz, keyed by quiz id.
// Guest runs never count: a guest id is a cookie, not a person to remember.
export async function getBestTiers(
  userId: string,
  quizIds: string[],
  executor: Executor = db,
): Promise<Map<string, Tier>> {
  const best = new Map<string, Tier>()
  if (quizIds.length === 0) return best

  // Each run is judged against the quiz's current limit: a run does not record
  // the maxErrors it was played under.
  const runs = await executor
    .select({
      quizId: attempts.quizId,
      score: attempts.score,
      errors: attempts.errors,
      maxErrors: quizzes.maxErrors,
    })
    .from(attempts)
    .innerJoin(quizzes, eq(attempts.quizId, quizzes.id))
    .where(
      and(
        eq(attempts.userId, userId),
        isNotNull(attempts.finishedAt),
        inArray(attempts.quizId, quizIds),
      ),
    )

  for (const run of runs) {
    const runTier = tierFor(run.score, run.errors, run.maxErrors)
    const tier = bestTier([best.get(run.quizId) ?? null, runTier])
    if (tier) best.set(run.quizId, tier)
  }
  return best
}
