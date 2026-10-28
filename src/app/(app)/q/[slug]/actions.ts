'use server'

import { getQuizBySlug } from '@/lib/quizzes/search'
import { checkRateLimit, RUN_START_LIMIT, RUN_START_WINDOW_SEC } from '@/lib/rate-limit'
import { resolvePlayer, runLimitKey } from '@/lib/run/identity'
import {
  type AnswerResult,
  AttemptNotFoundError,
  DuplicateAnswerError,
  EmptyQuizError,
  NotYourAttemptError,
  QuestionNotInAttemptError,
  QuizNotFoundError,
  type RunStart,
  startRun,
  submitAnswer,
} from '@/lib/run/service'
import { isUuid } from '@/lib/uuid'

export type StartRunResult =
  | { ok: true; run: RunStart }
  | { ok: false; error: 'notFound' | 'empty' | 'rateLimited' }

export type SubmitResult =
  | { ok: true; result: AnswerResult }
  | { ok: false; error: 'notYours' | 'duplicate' | 'notFound' }

export async function startRunAction(input: {
  slug: string
  nickname?: string
}): Promise<StartRunResult> {
  const player = await resolvePlayer(input.nickname)

  // Keyed on the identity this server derived, never on anything in the
  // payload: a caller who could choose the key could also reset their own
  // limit by inventing a new one on every request.
  const allowed = await checkRateLimit(runLimitKey(player), RUN_START_LIMIT, RUN_START_WINDOW_SEC)
  if (!allowed) return { ok: false, error: 'rateLimited' }

  // The client sends a slug, so the quiz id it plays is looked up here. A
  // hidden or deleted quiz falls out as `null` and never reaches startRun.
  const quiz = await getQuizBySlug(input.slug)
  if (!quiz) return { ok: false, error: 'notFound' }

  try {
    return { ok: true, run: await startRun({ quizId: quiz.id, player }) }
  } catch (error) {
    // A Server Action that throws reaches the browser as an opaque 500, so
    // every error the service is documented to raise is returned instead.
    // Anything else is a real failure and keeps travelling.
    if (error instanceof QuizNotFoundError) return { ok: false, error: 'notFound' }
    if (error instanceof EmptyQuizError) return { ok: false, error: 'empty' }
    throw error
  }
}

export async function submitAnswerAction(input: {
  attemptId: string
  questionId: string
  selectedOptionIds: string[]
  elapsedMs: number
}): Promise<SubmitResult> {
  const player = await resolvePlayer()

  // All three ids travel in the payload of a public Server Action and all three
  // reach a uuid column, and Postgres answers a malformed uuid with a query
  // error rather than no rows. Drizzle wraps it in a DrizzleQueryError, which
  // matches none of the arms below and is rethrown — so without this the
  // browser gets an opaque 500 for what is only a bad request.
  if (!isUuid(input.attemptId)) return { ok: false, error: 'notFound' }
  if (!isUuid(input.questionId)) return { ok: false, error: 'notFound' }
  // selectedOptionIds is compared against a uuid[] column, so one bad element
  // is enough. Array-ness is checked too: the declared type is an assertion
  // about what the browser should send, not a guarantee that it did, and
  // calling .every on a string would be the same 500 by another route.
  if (!Array.isArray(input.selectedOptionIds) || !input.selectedOptionIds.every(isUuid)) {
    return { ok: false, error: 'notFound' }
  }

  try {
    // Field by field, never a spread of `input`: the payload is whatever the
    // browser chose to send, and only these four values are ours to use.
    // elapsedMs among them is the client's own stopwatch and is not trusted —
    // submitAnswer applies TIMER_GRACE_MS and decides correctness and timeout.
    return {
      ok: true,
      result: await submitAnswer({
        attemptId: input.attemptId,
        questionId: input.questionId,
        selectedOptionIds: input.selectedOptionIds,
        elapsedMs: input.elapsedMs,
        player,
      }),
    }
  } catch (error) {
    if (error instanceof NotYourAttemptError) return { ok: false, error: 'notYours' }
    if (error instanceof DuplicateAnswerError) return { ok: false, error: 'duplicate' }
    if (error instanceof AttemptNotFoundError) return { ok: false, error: 'notFound' }
    // Asking for a question this attempt never sampled is the same dead end as
    // an attempt that does not exist: there is nothing for the player to retry.
    if (error instanceof QuestionNotInAttemptError) return { ok: false, error: 'notFound' }
    throw error
  }
}
