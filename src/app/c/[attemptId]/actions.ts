'use server'

import { checkRateLimit, RUN_START_LIMIT, RUN_START_WINDOW_SEC } from '@/lib/rate-limit'
import {
  ChallengeNotFoundError,
  getChallenge,
  getChallengeComparison,
  NotAChallengeError,
  startChallengeRun,
} from '@/lib/run/challenge'
import { resolvePlayer, runLimitKey } from '@/lib/run/identity'
import {
  EmptyQuizError,
  QuizNotFoundError,
  type RunStart,
  type RunSummary,
} from '@/lib/run/service'
import { isUuid } from '@/lib/uuid'

export type StartChallengeResult =
  | { ok: true; run: RunStart }
  | { ok: false; error: 'notFound' | 'empty' | 'rateLimited' }

export type ChallengeComparison = { mine: RunSummary; theirs: RunSummary }

// `null` is not an error: it is the run not being finished yet, which is the
// state the opponent's score stays hidden in.
export type ComparisonResult =
  | { ok: true; comparison: ChallengeComparison | null }
  | { ok: false; error: 'notFound' }

export async function startChallengeRunAction(input: {
  attemptId: string
  nickname?: string
}): Promise<StartChallengeResult> {
  const player = await resolvePlayer(input.nickname)

  // Keyed on the identity this server derived, never on anything in the
  // payload: a caller who could choose the key could also reset their own
  // limit by inventing a new one on every request.
  const allowed = await checkRateLimit(runLimitKey(player), RUN_START_LIMIT, RUN_START_WINDOW_SEC)
  if (!allowed) return { ok: false, error: 'rateLimited' }

  // The id is a URL segment the caller typed, and Postgres answers a malformed
  // uuid with a query error rather than no rows.
  if (!isUuid(input.attemptId)) return { ok: false, error: 'notFound' }

  // Read again rather than trusted from the page that rendered the button: an
  // attempt whose quiz was hidden or deleted since falls out as `null` here and
  // never reaches startChallengeRun.
  const invite = await getChallenge(input.attemptId)
  if (!invite) return { ok: false, error: 'notFound' }

  try {
    return { ok: true, run: await startChallengeRun({ attemptId: input.attemptId, player }) }
  } catch (error) {
    // A Server Action that throws reaches the browser as an opaque 500, so
    // every error the service is documented to raise is returned instead.
    // Anything else is a real failure and keeps travelling.
    if (error instanceof ChallengeNotFoundError) return { ok: false, error: 'notFound' }
    // Raised by startRun underneath when the quiz went hidden between the two
    // reads above: the same dead end as a challenge that never existed.
    if (error instanceof QuizNotFoundError) return { ok: false, error: 'notFound' }
    // Every question of the original set has since been deleted.
    if (error instanceof EmptyQuizError) return { ok: false, error: 'empty' }
    throw error
  }
}

// Called once the challenger's own run is finished, and never before: the
// opponent's score is not in any payload this route sends until then.
export async function fetchChallengeComparisonAction(input: {
  attemptId: string
}): Promise<ComparisonResult> {
  const player = await resolvePlayer()

  if (!isUuid(input.attemptId)) return { ok: false, error: 'notFound' }

  try {
    // A pass-through on purpose. The ownership check is inside
    // getChallengeComparison, which answers `null` for a caller who is not
    // playing this run, so there is no ordering here for a future caller to get
    // wrong. The player handed over is the one this server derived.
    return { ok: true, comparison: await getChallengeComparison(input.attemptId, player) }
  } catch (error) {
    // An ordinary run has nothing to compare against. Nothing for the player to
    // retry either, so it is the same dead end as an unknown attempt.
    if (error instanceof NotAChallengeError) return { ok: false, error: 'notFound' }
    throw error
  }
}
