import { and, asc, eq, sql } from 'drizzle-orm'
import type { NodePgQueryResultHKT } from 'drizzle-orm/node-postgres'
import type { PgDatabase } from 'drizzle-orm/pg-core'
import { type Db, db } from '@/db/client'
import { attemptAnswers, attempts, options, questions, quizzes } from '@/db/schema'
import { gradeAnswer, hasPassed, isTimedOut, sampleQuestionIds } from './engine'

export type Player =
  | { kind: 'user'; userId: string }
  | { kind: 'guest'; guestId: string; nickname: string }

// There is no isCorrect field on this type on purpose: it is the shape the
// browser receives for a question nobody has answered yet.
export type PublicOption = { id: string; text: string }

export type PublicQuestion = {
  id: string
  type: 'single' | 'multi' | 'boolean'
  prompt: string
  imageUrl: string | null
  options: PublicOption[]
}

export type RunSummary = {
  attemptId: string
  score: number
  errors: number
  total: number
  passed: boolean
}

export type AnswerResult = {
  correct: boolean
  timedOut: boolean
  correctOptionIds: string[]
  explanation: string | null
  theoryUrl: string | null
  next: PublicQuestion | null
  summary: RunSummary | null
}

export type RunStart = {
  attemptId: string
  question: PublicQuestion
  total: number
  timePerQuestionSec: number | null
}

export class RunError extends Error {}
export class QuizNotFoundError extends RunError {}
export class EmptyQuizError extends RunError {}
export class AttemptNotFoundError extends RunError {}
export class NotYourAttemptError extends RunError {}
export class QuestionNotInAttemptError extends RunError {}
export class DuplicateAnswerError extends RunError {}

// The base class of both `db` and a transaction, so tests can run the flow
// inside the rollback harness.
type Executor = PgDatabase<NodePgQueryResultHKT, Db['_']['fullSchema']>

const UNIQUE_VIOLATION = '23505'

export async function startRun(params: {
  quizId: string
  player: Player
  questionIds?: string[]
  executor?: Executor
}): Promise<RunStart> {
  const { quizId, player, questionIds, executor = db } = params

  const [quiz] = await executor
    .select({
      questionsPerRun: quizzes.questionsPerRun,
      timePerQuestionSec: quizzes.timePerQuestionSec,
      isHidden: quizzes.isHidden,
    })
    .from(quizzes)
    .where(eq(quizzes.id, quizId))
  if (!quiz || quiz.isHidden) throw new QuizNotFoundError('that quiz does not exist')

  const bank = await executor
    .select({ id: questions.id })
    .from(questions)
    .where(eq(questions.quizId, quizId))
    .orderBy(asc(questions.position))
  const bankIds = bank.map((question) => question.id)
  const inThisQuiz = new Set(bankIds)

  // A replayed set is played in the order it was given; what no longer belongs
  // to the quiz is dropped rather than failing the whole run.
  const runIds = questionIds
    ? questionIds.filter((id) => inThisQuiz.has(id))
    : sampleQuestionIds(bankIds, quiz.questionsPerRun, Math.random)
  if (runIds.length === 0) throw new EmptyQuizError('that quiz has no questions to play')

  // Null only when the question was deleted between the two reads above.
  const question = await loadPublicQuestion(executor, runIds[0])
  if (!question) throw new EmptyQuizError('that quiz has no questions to play')

  const [attempt] = await executor
    .insert(attempts)
    .values({ quizId, questionIds: runIds, ...playerColumns(player) })
    .returning({ id: attempts.id })

  return {
    attemptId: attempt.id,
    question,
    total: runIds.length,
    timePerQuestionSec: quiz.timePerQuestionSec,
  }
}

export async function submitAnswer(params: {
  attemptId: string
  questionId: string
  selectedOptionIds: string[]
  elapsedMs: number
  player: Player
  executor?: Executor
}): Promise<AnswerResult> {
  const { attemptId, questionId, selectedOptionIds, elapsedMs, player, executor = db } = params

  const [attempt] = await executor
    .select({
      userId: attempts.userId,
      guestId: attempts.guestId,
      questionIds: attempts.questionIds,
      maxErrors: quizzes.maxErrors,
      timePerQuestionSec: quizzes.timePerQuestionSec,
    })
    .from(attempts)
    .innerJoin(quizzes, eq(quizzes.id, attempts.quizId))
    .where(eq(attempts.id, attemptId))
  if (!attempt) throw new AttemptNotFoundError('that attempt does not exist')
  // An attempt id travels in the request payload: it says which run this is,
  // never who is playing it.
  if (!isPlayedBy(attempt, player)) throw new NotYourAttemptError('that attempt is not yours')
  if (!attempt.questionIds.includes(questionId)) {
    throw new QuestionNotInAttemptError('that question is not part of this attempt')
  }

  const [question] = await executor
    .select({ explanation: questions.explanation, theoryUrl: questions.theoryUrl })
    .from(questions)
    .where(eq(questions.id, questionId))
  const correctOptionIds = await loadCorrectOptionIds(executor, questionId)

  const timedOut = isTimedOut(elapsedMs, attempt.timePerQuestionSec)
  // Running out of time is wrong whatever was selected, so the selection is
  // only graded for an answer that arrived in time.
  const correct = !timedOut && gradeAnswer(correctOptionIds, selectedOptionIds)
  const graded = {
    correct,
    timedOut,
    correctOptionIds,
    explanation: question?.explanation ?? null,
    theoryUrl: question?.theoryUrl ?? null,
  }

  // One transaction: an answer stored without its score, or a score moved
  // without its answer, would each leave the run lying about itself.
  return executor.transaction(async (tx) => {
    try {
      await tx.insert(attemptAnswers).values({
        attemptId,
        questionId,
        selectedOptionIds,
        isCorrect: correct,
        elapsedMs,
        timedOut,
      })
    } catch (error) {
      if (!isUniqueViolation(error)) throw error
      throw new DuplicateAnswerError('that question has already been answered')
    }

    const answered = await tx
      .select({ questionId: attemptAnswers.questionId })
      .from(attemptAnswers)
      .where(eq(attemptAnswers.attemptId, attemptId))
    const answeredIds = new Set(answered.map((row) => row.questionId))
    const nextId = attempt.questionIds.find((id) => !answeredIds.has(id)) ?? null

    // Counted in SQL: reading the totals into JS and writing them back loses
    // one of two answers that are in flight at the same time.
    const progress = correct
      ? { score: sql`${attempts.score} + 1` }
      : { errors: sql`${attempts.errors} + 1` }
    const finish = nextId === null ? { finishedAt: sql`now()` } : {}
    const [totals] = await tx
      .update(attempts)
      .set({ ...progress, ...finish })
      .where(eq(attempts.id, attemptId))
      .returning({ score: attempts.score, errors: attempts.errors })

    if (nextId === null) {
      return {
        ...graded,
        next: null,
        summary: {
          attemptId,
          score: totals.score,
          errors: totals.errors,
          total: attempt.questionIds.length,
          passed: hasPassed(totals.errors, attempt.maxErrors),
        },
      }
    }

    return { ...graded, next: await loadPublicQuestion(tx, nextId), summary: null }
  })
}

function playerColumns(player: Player) {
  if (player.kind === 'user') return { userId: player.userId }
  return { guestId: player.guestId, nickname: player.nickname }
}

function isPlayedBy(
  attempt: { userId: string | null; guestId: string | null },
  player: Player,
): boolean {
  if (player.kind === 'user') return attempt.userId === player.userId
  return attempt.guestId === player.guestId
}

async function loadPublicQuestion(
  executor: Executor,
  questionId: string,
): Promise<PublicQuestion | null> {
  const [question] = await executor
    .select({
      id: questions.id,
      type: questions.type,
      prompt: questions.prompt,
      imageUrl: questions.imageUrl,
    })
    .from(questions)
    .where(eq(questions.id, questionId))
  if (!question) return null

  // Projected column by column, never a spread of the option row: selecting the
  // row would carry isCorrect to a player who has not answered yet.
  const publicOptions = await executor
    .select({ id: options.id, text: options.text })
    .from(options)
    .where(eq(options.questionId, questionId))
    .orderBy(asc(options.position))

  return {
    id: question.id,
    type: question.type,
    prompt: question.prompt,
    imageUrl: question.imageUrl,
    options: publicOptions,
  }
}

async function loadCorrectOptionIds(executor: Executor, questionId: string): Promise<string[]> {
  const correct = await executor
    .select({ id: options.id })
    .from(options)
    .where(and(eq(options.questionId, questionId), eq(options.isCorrect, true)))
  return correct.map((option) => option.id)
}

// pg reports a unique violation as SQLSTATE 23505. The message text is not a
// contract: it carries the constraint name and the server locale.
function isUniqueViolation(error: unknown): boolean {
  // Drizzle wraps query failures in DrizzleQueryError and hangs the real pg
  // error off `cause`, so the code is never on the error we actually catch.
  // Walk the chain rather than trusting the top-level object.
  let current: unknown = error
  while (current instanceof Error) {
    if ('code' in current && current.code === UNIQUE_VIOLATION) return true
    current = current.cause
  }
  return false
}
