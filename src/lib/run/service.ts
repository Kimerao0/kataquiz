import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm'
import type { NodePgQueryResultHKT } from 'drizzle-orm/node-postgres'
import type { PgDatabase } from 'drizzle-orm/pg-core'
import { type Db, db } from '@/db/client'
import { attemptAnswers, attempts, options, questions, quizzes } from '@/db/schema'
import { gradeAnswer, hasPassed, isTimedOut, sampleQuestionIds, seededOrder } from './engine'

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
  code: string | null
  codeLanguage: string | null
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

// One graded question as the server can still reconstruct it, which is what a
// run picked up after a refresh has instead of the copy the browser kept.
export type RunHistoryEntry = {
  question: PublicQuestion
  selectedOptionIds: string[]
  result: AnswerResult
}

export type ResumableRun = { attemptId: string; answered: number; total: number }

export type RunResume =
  | {
      status: 'playing'
      attemptId: string
      question: PublicQuestion
      total: number
      timePerQuestionSec: number | null
      answered: number
      history: RunHistoryEntry[]
    }
  | {
      status: 'finished'
      attemptId: string
      summary: RunSummary
      answered: number
      history: RunHistoryEntry[]
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
  challengeOfAttemptId?: string
  executor?: Executor
}): Promise<RunStart> {
  const { quizId, player, questionIds, challengeOfAttemptId, executor = db } = params

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
    .values({ quizId, questionIds: runIds, challengeOfAttemptId, ...playerColumns(player) })
    .returning({ id: attempts.id })

  return {
    attemptId: attempt.id,
    // Shuffled only once the attempt exists: the id it is seeded on is minted
    // by the insert above.
    question: withSeededOptionOrder(question, attempt.id),
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
    const remainingIds = attempt.questionIds.filter((id) => !answeredIds.has(id))

    // Resolved before the update, because whether this answer finishes the run
    // is exactly "is there a question left that still exists". Taking the first
    // unanswered id on trust and discovering afterwards that it was deleted
    // would leave finishedAt unset with nothing to serve.
    const next = await loadNextSurvivingQuestion(tx, remainingIds)

    // Counted in SQL: reading the totals into JS and writing them back loses
    // one of two answers that are in flight at the same time.
    const progress = correct
      ? { score: sql`${attempts.score} + 1` }
      : { errors: sql`${attempts.errors} + 1` }
    const finish = next === null ? { finishedAt: sql`now()` } : {}
    const [totals] = await tx
      .update(attempts)
      .set({ ...progress, ...finish })
      .where(eq(attempts.id, attemptId))
      .returning({ score: attempts.score, errors: attempts.errors })

    if (next === null) {
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

    // next and summary are never both null: that pair is a run the player
    // cannot advance and the server will never mark finished.
    return { ...graded, next: withSeededOptionOrder(next, attemptId), summary: null }
  })
}

// The run this player walked away from on this quiz, if there is one. A refresh
// orphans the attempt rather than ending it: the row says which questions, and
// attempt_answers says how far they got.
export async function findResumableRun(params: {
  quizId: string
  player: Player
  executor?: Executor
}): Promise<ResumableRun | null> {
  const { quizId, player, executor = db } = params

  const [row] = await executor
    .select({
      attemptId: attempts.id,
      questionIds: attempts.questionIds,
      // Cast in SQL: node-postgres hands a bigint count back as a string.
      answered: sql<number>`count(${attemptAnswers.id})::int`,
    })
    .from(attempts)
    .leftJoin(attemptAnswers, eq(attemptAnswers.attemptId, attempts.id))
    .where(
      and(
        eq(attempts.quizId, quizId),
        isNull(attempts.finishedAt),
        // A challenge run is excluded on purpose: resuming it from the plain
        // quiz page would drop the head-to-head framing it was started with.
        isNull(attempts.challengeOfAttemptId),
        ownedBy(player),
      ),
    )
    .groupBy(attempts.id)
    // An attempt nobody answered is indistinguishable from starting fresh, so
    // offering to resume it would be noise. It has to be excluded here and not
    // after the query: the limit chooses its row before any JS runs, so a Start
    // over that was abandoned straight away would hide the older run with the
    // player's answers in it rather than being looked past.
    .having(sql`count(${attemptAnswers.id}) > 0`)
    .orderBy(desc(attempts.startedAt))
    .limit(1)
  if (!row) return null

  return { attemptId: row.attemptId, answered: row.answered, total: row.questionIds.length }
}

// The name a guest last played this quiz under, so a replay does not make them
// type it again. Scoped to one quiz because that is the case KQ10 names — the
// same quiz, drilled over and over — and what name to carry between quizzes is
// a different and wider question. Challenge attempts are not excluded: a
// nickname is a nickname wherever it was used.
export async function lastNicknameFor(params: {
  quizId: string
  player: Player
  executor?: Executor
}): Promise<string | null> {
  const { quizId, player, executor = db } = params
  // A signed-in player already has a name, and never typed one here to carry.
  if (player.kind === 'user') return null

  const [row] = await executor
    .select({ nickname: attempts.nickname })
    .from(attempts)
    .where(and(eq(attempts.quizId, quizId), ownedBy(player)))
    .orderBy(desc(attempts.startedAt))
    .limit(1)

  // A guest who played anonymously stored an empty nickname, and pre-filling
  // the field with that is the same as pre-filling nothing.
  if (!row || row.nickname === '') return null

  return row.nickname
}

// Everything the browser needs to carry on where it left off: the question the
// server is waiting for, and the questions already graded so the tally and the
// review are not empty for the half of the run that was played before.
export async function resumeRun(params: {
  quizId: string
  attemptId: string
  player: Player
  executor?: Executor
}): Promise<RunResume> {
  const { quizId, attemptId, player, executor = db } = params

  const [attempt] = await executor
    .select({
      quizId: attempts.quizId,
      userId: attempts.userId,
      guestId: attempts.guestId,
      questionIds: attempts.questionIds,
      score: attempts.score,
      errors: attempts.errors,
      finishedAt: attempts.finishedAt,
      maxErrors: quizzes.maxErrors,
      timePerQuestionSec: quizzes.timePerQuestionSec,
      isHidden: quizzes.isHidden,
    })
    .from(attempts)
    .innerJoin(quizzes, eq(quizzes.id, attempts.quizId))
    .where(eq(attempts.id, attemptId))
  if (!attempt) throw new AttemptNotFoundError('that attempt does not exist')
  // Scoped to the quiz whose page is asking: opened from another one the run
  // would take that quiz's slug on every link and on its summary. To this quiz
  // the attempt does not exist, which is why it is not an error of its own.
  if (attempt.quizId !== quizId) throw new AttemptNotFoundError('that attempt does not exist')
  // An attempt id travels in the request payload: it says which run this is,
  // never who is playing it.
  if (!isPlayedBy(attempt, player)) throw new NotYourAttemptError('that attempt is not yours')
  if (attempt.isHidden) throw new QuizNotFoundError('that quiz does not exist')

  const answers = await executor
    .select({
      questionId: attemptAnswers.questionId,
      selectedOptionIds: attemptAnswers.selectedOptionIds,
      isCorrect: attemptAnswers.isCorrect,
      timedOut: attemptAnswers.timedOut,
    })
    .from(attemptAnswers)
    .where(eq(attemptAnswers.attemptId, attemptId))

  const history = await buildHistory(executor, attemptId, attempt.questionIds, answers)
  // The number of answer rows and never history.length: the two part company
  // only when a question is deleted between the read above and the loads below,
  // and then the player still got through it and the tally's position still has
  // to agree with what the live run showed. Only that race — attempt_answers
  // cascades from questions, so a deletion a later read can see has already
  // taken its answer row with it.
  const answered = answers.length

  const answeredIds = new Set(answers.map((row) => row.questionId))
  const remainingIds = attempt.questionIds.filter((id) => !answeredIds.has(id))
  const next = await loadNextSurvivingQuestion(executor, remainingIds)

  if (next !== null && attempt.finishedAt === null) {
    return {
      status: 'playing',
      attemptId,
      question: withSeededOptionOrder(next, attemptId),
      total: attempt.questionIds.length,
      timePerQuestionSec: attempt.timePerQuestionSec,
      answered,
      history,
    }
  }

  // Every question that was left has been deleted while the player was away.
  // That is the same end of the run submitAnswer writes for itself, and leaving
  // finishedAt unset would offer the dead attempt for ever.
  if (attempt.finishedAt === null) {
    await executor
      .update(attempts)
      .set({ finishedAt: sql`now()` })
      .where(eq(attempts.id, attemptId))
  }

  return {
    status: 'finished',
    attemptId,
    summary: {
      attemptId,
      score: attempt.score,
      errors: attempt.errors,
      total: attempt.questionIds.length,
      passed: hasPassed(attempt.errors, attempt.maxErrors),
    },
    answered,
    history,
  }
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

// The same question isPlayedBy asks of a row, asked of the table: a lookup that
// never sees an attempt it would have to refuse.
function ownedBy(player: Player) {
  if (player.kind === 'user') return eq(attempts.userId, player.userId)
  return eq(attempts.guestId, player.guestId)
}

type StoredAnswer = {
  questionId: string
  selectedOptionIds: string[]
  isCorrect: boolean
  timedOut: boolean
}

// Walked in the attempt's own order rather than the order the answer rows came
// back in: that is the order the run was played, and the review is numbered by
// it. Loaded one question at a time through the loaders the live run already
// uses rather than batched into one query — this is a cold path, run once per
// resume, and a second set of readers would be a second place the projection a
// player is served could drift.
async function buildHistory(
  executor: Executor,
  attemptId: string,
  questionIds: string[],
  answers: StoredAnswer[],
): Promise<RunHistoryEntry[]> {
  const byQuestionId = new Map(answers.map((answer) => [answer.questionId, answer]))
  const history: RunHistoryEntry[] = []

  for (const questionId of questionIds) {
    const answer = byQuestionId.get(questionId)
    if (!answer) continue

    const entry = await toHistoryEntry(executor, attemptId, answer)
    if (entry) history.push(entry)
  }

  return history
}

// Null for a question deleted while this resume was reading: its answer row was
// already in hand, and there is no prompt left to review, so the entry is
// dropped rather than shown half empty.
async function toHistoryEntry(
  executor: Executor,
  attemptId: string,
  answer: StoredAnswer,
): Promise<RunHistoryEntry | null> {
  const question = await loadPublicQuestion(executor, answer.questionId)
  if (!question) return null

  const [source] = await executor
    .select({ explanation: questions.explanation, theoryUrl: questions.theoryUrl })
    .from(questions)
    .where(eq(questions.id, answer.questionId))

  return {
    question: withSeededOptionOrder(question, attemptId),
    selectedOptionIds: answer.selectedOptionIds,
    result: {
      correct: answer.isCorrect,
      timedOut: answer.timedOut,
      correctOptionIds: await loadCorrectOptionIds(executor, answer.questionId),
      explanation: source?.explanation ?? null,
      theoryUrl: source?.theoryUrl ?? null,
      // Both null: they describe what the server said next at grading time,
      // which a replay has no business inventing.
      next: null,
      summary: null,
    },
  }
}

async function loadPublicQuestion(
  executor: Executor,
  questionId: string,
): Promise<PublicQuestion | null> {
  // Projected column by column, never a spread of the question row: the row
  // itself is harmless today, but the projection is what guarantees a column
  // added to `questions` later is not served to a player by accident.
  const [question] = await executor
    .select({
      id: questions.id,
      type: questions.type,
      prompt: questions.prompt,
      imageUrl: questions.imageUrl,
      code: questions.code,
      codeLanguage: questions.codeLanguage,
    })
    .from(questions)
    .where(eq(questions.id, questionId))
  if (!question) return null

  // Projected column by column, never a spread of the option row: selecting the
  // row would carry isCorrect to a player who has not answered yet. Stored
  // position only fixes a deterministic base order; what the player sees is the
  // seeded permutation of it applied by the callers.
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
    code: question.code,
    codeLanguage: question.codeLanguage,
    options: publicOptions,
  }
}

// The ids an attempt stores are a snapshot taken when the run started, and a
// quiz is edited in place: by the time the player gets there a question may be
// gone. Serving `null` for it would hand the browser a run with no next
// question and no summary — the Next button does nothing and finishedAt is
// never set, so the run also never produces a challenge link. So walk the
// remaining ids in order and answer with the first that still exists. `null`
// here means the run is over, which the caller turns into a summary; it never
// means the run is stuck.
//
// Loaded one at a time rather than filtered with a single `inArray` on purpose:
// a row can be deleted between that filter and the read that follows it, and
// then the gap is back. This asks the only question that matters — did it
// load — and is one round trip in the ordinary case where nothing was deleted.
async function loadNextSurvivingQuestion(
  executor: Executor,
  remainingIds: string[],
): Promise<PublicQuestion | null> {
  for (const id of remainingIds) {
    const question = await loadPublicQuestion(executor, id)
    if (question) return question
  }
  return null
}

// Authors overwhelmingly write the right answer first, so stored position is a
// tell: played unshuffled, a drill teaches "pick the first one" instead of the
// rule. The order is derived from the attempt and the question together, so it
// is stable for every read inside one attempt, differs between two attempts on
// the same question — including a challenger replaying the same set — and costs
// neither a column nor a round trip. Grading compares option ids, never
// positions, so nothing here can move a score.
function withSeededOptionOrder(question: PublicQuestion, attemptId: string): PublicQuestion {
  // True/False keeps its conventional reading order. Shuffling is there to stop
  // a player learning the position instead of the rule, and with two options a
  // player reads both anyway — so the leak it would close is negligible, while
  // showing "False, True" is a jarring read for no gain.
  if (question.type === 'boolean') return question

  return { ...question, options: seededOrder(question.options, `${attemptId}:${question.id}`) }
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
