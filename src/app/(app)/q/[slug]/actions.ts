'use server'

import { getOrCreateGuestId } from '@/lib/guest'
import { getQuizBySlug } from '@/lib/quizzes/search'
import { checkRateLimit, RUN_START_LIMIT, RUN_START_WINDOW_SEC } from '@/lib/rate-limit'
import {
  type AnswerResult,
  AttemptNotFoundError,
  DuplicateAnswerError,
  EmptyQuizError,
  NotYourAttemptError,
  type Player,
  QuestionNotInAttemptError,
  QuizNotFoundError,
  type RunStart,
  startRun,
  submitAnswer,
} from '@/lib/run/service'
import { getCurrentUser } from '@/lib/session'

export type StartRunResult =
  | { ok: true; run: RunStart }
  | { ok: false; error: 'notFound' | 'empty' | 'rateLimited' }

export type SubmitResult =
  | { ok: true; result: AnswerResult }
  | { ok: false; error: 'notYours' | 'duplicate' | 'notFound' }

// Stored verbatim in `attempts.nickname` and shown to whoever opens a challenge
// link, so it is capped here rather than at render time.
const MAX_NICKNAME_LENGTH = 40

export async function startRunAction(input: {
  slug: string
  nickname?: string
}): Promise<StartRunResult> {
  const player = await resolvePlayer(input.nickname)

  // Keyed on the identity this server derived, never on anything in the
  // payload: a caller who could choose the key could also reset their own
  // limit by inventing a new one on every request.
  const allowed = await checkRateLimit(limitKey(player), RUN_START_LIMIT, RUN_START_WINDOW_SEC)
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

// The only place a player identity is minted. It comes from the session cookie
// or the signed guest cookie, never from the request body, so a client that
// posts somebody else's id still plays as itself and fails the ownership check
// inside submitAnswer.
async function resolvePlayer(nickname?: string): Promise<Player> {
  const user = await getCurrentUser()
  if (user) return { kind: 'user', userId: user.id }

  return {
    kind: 'guest',
    guestId: await getOrCreateGuestId(),
    nickname: (nickname ?? '').trim().slice(0, MAX_NICKNAME_LENGTH),
  }
}

// The prefix keeps run starts out of the way of the upload limit, which shares
// this table's primary key.
function limitKey(player: Player): string {
  return player.kind === 'user' ? `run:user:${player.userId}` : `run:guest:${player.guestId}`
}
