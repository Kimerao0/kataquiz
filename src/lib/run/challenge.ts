import { and, eq, inArray } from 'drizzle-orm'
import type { NodePgQueryResultHKT } from 'drizzle-orm/node-postgres'
import type { PgDatabase } from 'drizzle-orm/pg-core'
import { type Db, db } from '@/db/client'
import { attempts, questions, quizzes, user } from '@/db/schema'
import { hasPassed } from './engine'
import { type Player, type RunStart, type RunSummary, startRun } from './service'

export type ChallengeInvite = {
  attemptId: string
  quizId: string
  quizSlug: string
  quizTitle: string
  opponentName: string
  questionCount: number
}

export class ChallengeError extends Error {}
export class ChallengeNotFoundError extends ChallengeError {}
export class NotAChallengeError extends ChallengeError {}

// The base class of both `db` and a transaction, so tests can run the flow
// inside the rollback harness.
type Executor = PgDatabase<NodePgQueryResultHKT, Db['_']['fullSchema']>

// A name the UI turns into copy, not copy itself.
const ANONYMOUS = 'anonymous'

export async function getChallenge(
  attemptId: string,
  executor: Executor = db,
): Promise<ChallengeInvite | null> {
  const source = await loadChallengeSource(executor, attemptId)
  if (!source) return null

  const playable = await survivingQuestionIds(executor, source)

  // No score, no error count, no pass flag: the opponent's result is revealed
  // only once the challenger has finished.
  return {
    attemptId: source.attemptId,
    quizId: source.quizId,
    quizSlug: source.quizSlug,
    quizTitle: source.quizTitle,
    opponentName: opponentNameOf(source),
    // What the challenger will actually play, which is shorter than the stored
    // set once a question has been deleted.
    questionCount: playable.length,
  }
}

export async function startChallengeRun(params: {
  attemptId: string
  player: Player
  executor?: Executor
}): Promise<RunStart> {
  const { attemptId, player, executor = db } = params

  const source = await loadChallengeSource(executor, attemptId)
  if (!source) throw new ChallengeNotFoundError('that challenge does not exist')

  // Sampling and insertion stay in startRun: this only says which questions,
  // and a set with nothing left comes back as its EmptyQuizError.
  return startRun({
    quizId: source.quizId,
    player,
    questionIds: await survivingQuestionIds(executor, source),
    challengeOfAttemptId: source.attemptId,
    executor,
  })
}

export async function getChallengeComparison(
  myAttemptId: string,
  executor: Executor = db,
): Promise<{ mine: RunSummary; theirs: RunSummary } | null> {
  const mine = await loadScore(executor, myAttemptId)
  if (!mine?.challengeOfAttemptId) {
    throw new NotAChallengeError('that attempt does not answer a challenge')
  }

  // The spoiler guard: what keeps the opponent's score hidden is this run's
  // stored finishedAt, never anything the caller hands in.
  if (!mine.finishedAt) return null

  const theirs = await loadScore(executor, mine.challengeOfAttemptId)
  // Null only if the foreign key were gone: the column references an attempt.
  if (!theirs) return null

  return {
    mine: toSummary(myAttemptId, mine),
    theirs: toSummary(mine.challengeOfAttemptId, theirs),
  }
}

type ChallengeSource = {
  attemptId: string
  quizId: string
  quizSlug: string
  quizTitle: string
  userName: string | null
  nickname: string | null
  questionIds: string[]
}

// Null for an attempt that does not exist, plays a hidden quiz, or never
// finished: a run somebody abandoned challenges nobody.
async function loadChallengeSource(
  executor: Executor,
  attemptId: string,
): Promise<ChallengeSource | null> {
  const [source] = await executor
    .select({
      attemptId: attempts.id,
      quizId: quizzes.id,
      quizSlug: quizzes.slug,
      quizTitle: quizzes.title,
      userName: user.name,
      nickname: attempts.nickname,
      questionIds: attempts.questionIds,
      finishedAt: attempts.finishedAt,
    })
    .from(attempts)
    .innerJoin(quizzes, eq(quizzes.id, attempts.quizId))
    .leftJoin(user, eq(user.id, attempts.userId))
    .where(and(eq(attempts.id, attemptId), eq(quizzes.isHidden, false)))

  if (!source?.finishedAt) return null
  return source
}

// The stored set narrowed to what still belongs to the quiz, in the order the
// first player saw it: quizzes are edited in place, so the challenger plays a
// subsequence of the original run.
async function survivingQuestionIds(
  executor: Executor,
  source: { quizId: string; questionIds: string[] },
): Promise<string[]> {
  const alive = await executor
    .select({ id: questions.id })
    .from(questions)
    .where(and(eq(questions.quizId, source.quizId), inArray(questions.id, source.questionIds)))

  const aliveIds = new Set(alive.map((question) => question.id))
  return source.questionIds.filter((id) => aliveIds.has(id))
}

function opponentNameOf(source: { userName: string | null; nickname: string | null }): string {
  const name = source.userName ?? source.nickname
  // A guest who skipped the nickname field stores an empty one, which is as
  // unprintable as a missing one.
  return name?.trim() ? name : ANONYMOUS
}

type AttemptScore = {
  score: number
  errors: number
  questionIds: string[]
  finishedAt: Date | null
  challengeOfAttemptId: string | null
  maxErrors: number
}

async function loadScore(executor: Executor, attemptId: string): Promise<AttemptScore | null> {
  const [attempt] = await executor
    .select({
      score: attempts.score,
      errors: attempts.errors,
      questionIds: attempts.questionIds,
      finishedAt: attempts.finishedAt,
      challengeOfAttemptId: attempts.challengeOfAttemptId,
      maxErrors: quizzes.maxErrors,
    })
    .from(attempts)
    .innerJoin(quizzes, eq(quizzes.id, attempts.quizId))
    .where(eq(attempts.id, attemptId))

  return attempt ?? null
}

function toSummary(attemptId: string, attempt: AttemptScore): RunSummary {
  return {
    attemptId,
    score: attempt.score,
    errors: attempt.errors,
    // Each run reports the set it played itself: a question deleted between the
    // two runs makes the two totals differ.
    total: attempt.questionIds.length,
    passed: hasPassed(attempt.errors, attempt.maxErrors),
  }
}
