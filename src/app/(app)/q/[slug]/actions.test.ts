import { RUN_START_LIMIT, RUN_START_WINDOW_SEC } from '@/lib/rate-limit'
import {
  AttemptNotFoundError,
  DuplicateAnswerError,
  EmptyQuizError,
  NotYourAttemptError,
  QuestionNotInAttemptError,
  QuizNotFoundError,
} from '@/lib/run/service'
import { startRunAction, submitAnswerAction } from './actions'

const {
  getCurrentUser,
  getOrCreateGuestId,
  checkRateLimit,
  getQuizBySlug,
  startRun,
  submitAnswer,
} = vi.hoisted(() => ({
  getCurrentUser: vi.fn<typeof import('@/lib/session').getCurrentUser>(),
  getOrCreateGuestId: vi.fn<typeof import('@/lib/guest').getOrCreateGuestId>(),
  checkRateLimit: vi.fn<typeof import('@/lib/rate-limit').checkRateLimit>(),
  getQuizBySlug: vi.fn<typeof import('@/lib/quizzes/search').getQuizBySlug>(),
  startRun: vi.fn<typeof import('@/lib/run/service').startRun>(),
  submitAnswer: vi.fn<typeof import('@/lib/run/service').submitAnswer>(),
}))

// Replaced wholesale: the action only ever asks these two modules who the
// caller is, and importing them for real drags in better-auth and node:crypto
// cookie signing for no gain.
vi.mock('@/lib/session', () => ({ getCurrentUser }))
vi.mock('@/lib/guest', () => ({ getOrCreateGuestId, readGuestId: vi.fn() }))

// The real limit constants stay, so the assertion below pins the values the
// action actually passes rather than copies of them.
vi.mock('@/lib/rate-limit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/rate-limit')>()),
  checkRateLimit,
}))

vi.mock('@/lib/quizzes/search', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/quizzes/search')>()),
  getQuizBySlug,
}))

// Only the two writes are stubbed. The error classes have to stay real: the
// action maps them with instanceof, and a copied class would pass a test the
// production module would fail.
vi.mock('@/lib/run/service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/run/service')>()),
  startRun,
  submitAnswer,
}))

const user = { id: 'user-1', name: 'Ada Lovelace', image: null }

// Attempt, question and option ids are uuids in the database, and
// submitAnswerAction checks their shape before the service call, so the
// fixtures have to be real ones.
const attemptId = '11111111-1111-4111-8111-111111111111'
const questionId = '22222222-2222-4222-8222-222222222222'
const optionId = '33333333-3333-4333-8333-333333333333'

const quiz = {
  id: 'quiz-1',
  slug: 'road-signs-ab12cd',
  title: 'Road signs',
  description: null,
  tags: [],
  questionCount: 10,
  questionsPerRun: 5,
  maxErrors: 1,
  timePerQuestionSec: 30,
  authorName: 'Ada Lovelace',
  createdAt: new Date(),
}

const run = {
  attemptId,
  question: {
    id: questionId,
    type: 'single' as const,
    prompt: 'Why?',
    imageUrl: null,
    code: null,
    codeLanguage: null,
    options: [],
  },
  total: 5,
  timePerQuestionSec: 30,
}

const answer = {
  correct: true,
  timedOut: false,
  correctOptionIds: [optionId],
  explanation: null,
  theoryUrl: null,
  next: null,
  summary: { attemptId, score: 5, errors: 0, total: 5, passed: true },
}

const submitInput = {
  attemptId,
  questionId,
  selectedOptionIds: [optionId],
  elapsedMs: 1200,
}

beforeEach(() => {
  vi.clearAllMocks()
  getCurrentUser.mockResolvedValue(user)
  getOrCreateGuestId.mockResolvedValue('guest-1')
  checkRateLimit.mockResolvedValue(true)
  getQuizBySlug.mockResolvedValue(quiz)
  startRun.mockResolvedValue(run)
  submitAnswer.mockResolvedValue(answer)
})

describe('startRunAction', () => {
  it('derives the player from the session, ignoring any client-supplied id', async () => {
    // What a hand-written client would post to play as somebody else. The
    // action's own input type has no such field, hence the cast.
    const hostile = { slug: quiz.slug, nickname: 'Mallory', userId: 'victim', guestId: 'victim' }

    const result = await startRunAction(hostile as never)

    expect(result).toEqual({ ok: true, run })
    // Exact, not objectContaining: an implementation that spread the payload
    // into the service call would fail here.
    expect(startRun).toHaveBeenCalledWith({
      quizId: quiz.id,
      player: { kind: 'user', userId: user.id },
    })
  })

  it('plays a signed-out caller as the guest the cookie names, with their nickname', async () => {
    getCurrentUser.mockResolvedValue(null)

    await startRunAction({ slug: quiz.slug, nickname: '  Bea  ' })

    expect(startRun).toHaveBeenCalledWith({
      quizId: quiz.id,
      player: { kind: 'guest', guestId: 'guest-1', nickname: 'Bea' },
    })
  })

  it('rate-limits run starts', async () => {
    checkRateLimit.mockResolvedValue(false)

    const result = await startRunAction({ slug: quiz.slug })

    expect(result).toEqual({ ok: false, error: 'rateLimited' })
    expect(checkRateLimit).toHaveBeenCalledWith(
      `run:user:${user.id}`,
      RUN_START_LIMIT,
      RUN_START_WINDOW_SEC,
    )
    // Nothing was written: the limit has to bite before the attempt row.
    expect(startRun).not.toHaveBeenCalled()
  })

  it('keys the limit on the guest cookie for a signed-out caller', async () => {
    getCurrentUser.mockResolvedValue(null)

    await startRunAction({ slug: quiz.slug })

    expect(checkRateLimit).toHaveBeenCalledWith(
      'run:guest:guest-1',
      RUN_START_LIMIT,
      RUN_START_WINDOW_SEC,
    )
  })

  it('reports an unknown slug as notFound without reaching the service', async () => {
    getQuizBySlug.mockResolvedValue(null)

    const result = await startRunAction({ slug: 'gone' })

    expect(result).toEqual({ ok: false, error: 'notFound' })
    expect(startRun).not.toHaveBeenCalled()
  })

  it('maps EmptyQuizError to { ok: false, error: empty }', async () => {
    startRun.mockRejectedValue(new EmptyQuizError('that quiz has no questions to play'))

    await expect(startRunAction({ slug: quiz.slug })).resolves.toEqual({
      ok: false,
      error: 'empty',
    })
  })

  it('maps QuizNotFoundError to { ok: false, error: notFound }', async () => {
    startRun.mockRejectedValue(new QuizNotFoundError('that quiz does not exist'))

    await expect(startRunAction({ slug: quiz.slug })).resolves.toEqual({
      ok: false,
      error: 'notFound',
    })
  })

  it('lets an unexpected failure through instead of reporting it as a quiz problem', async () => {
    // Returning this one as 'empty' would tell the player their quiz is broken
    // while the real fault is the database.
    startRun.mockRejectedValue(new Error('the database is down'))

    await expect(startRunAction({ slug: quiz.slug })).rejects.toThrow('the database is down')
  })
})

describe('submitAnswerAction', () => {
  it('derives the player from the session, ignoring any client-supplied id', async () => {
    getCurrentUser.mockResolvedValue(null)
    const hostile = { ...submitInput, guestId: 'victim', player: { kind: 'user', userId: 'root' } }

    const result = await submitAnswerAction(hostile as never)

    expect(result).toEqual({ ok: true, result: answer })
    expect(submitAnswer).toHaveBeenCalledWith({
      ...submitInput,
      player: { kind: 'guest', guestId: 'guest-1', nickname: '' },
    })
  })

  it('passes the client stopwatch through untouched for the server to judge', async () => {
    // No client-side grading of any kind: elapsedMs is forwarded as sent and
    // submitAnswer applies TIMER_GRACE_MS.
    await submitAnswerAction({ ...submitInput, elapsedMs: 999_999 })

    expect(submitAnswer).toHaveBeenCalledWith(
      expect.objectContaining({ elapsedMs: 999_999, selectedOptionIds: [optionId] }),
    )
  })

  // Postgres answers a malformed uuid with 22P02, which Drizzle wraps in a
  // DrizzleQueryError. That class matches none of the arms in the action, so it
  // is rethrown and a public Server Action hands the browser an opaque 500 for
  // what is only a bad request. Each of these three values reaches a uuid
  // column, so each has to be refused before the query.
  it.each([
    ['attemptId', { ...submitInput, attemptId: 'not-a-uuid' }],
    ['questionId', { ...submitInput, questionId: "' or 1=1 --" }],
    ['an entry in selectedOptionIds', { ...submitInput, selectedOptionIds: [optionId, 'nope'] }],
  ])('refuses a malformed %s without reaching the service', async (_name, input) => {
    const result = await submitAnswerAction(input)

    expect(result).toEqual({ ok: false, error: 'notFound' })
    // Not merely mapped to a nicer error: the query never runs.
    expect(submitAnswer).not.toHaveBeenCalled()
  })

  it('refuses a selectedOptionIds that is not an array at all', async () => {
    // The declared type says string[]; the payload is whatever the browser
    // chose to send. Calling .every on a string would be the same 500 by
    // another route.
    const result = await submitAnswerAction({
      ...submitInput,
      selectedOptionIds: optionId,
    } as never)

    expect(result).toEqual({ ok: false, error: 'notFound' })
    expect(submitAnswer).not.toHaveBeenCalled()
  })

  it('accepts an empty selection, which is a real answer and not a malformed one', async () => {
    await submitAnswerAction({ ...submitInput, selectedOptionIds: [] })

    expect(submitAnswer).toHaveBeenCalledWith(expect.objectContaining({ selectedOptionIds: [] }))
  })

  it('maps DuplicateAnswerError to { ok: false, error: duplicate }', async () => {
    submitAnswer.mockRejectedValue(new DuplicateAnswerError('already answered'))

    await expect(submitAnswerAction(submitInput)).resolves.toEqual({
      ok: false,
      error: 'duplicate',
    })
  })

  it('maps NotYourAttemptError to { ok: false, error: notYours }', async () => {
    submitAnswer.mockRejectedValue(new NotYourAttemptError('not yours'))

    await expect(submitAnswerAction(submitInput)).resolves.toEqual({
      ok: false,
      error: 'notYours',
    })
  })

  it('lets an unexpected failure through instead of reporting it as a run problem', async () => {
    submitAnswer.mockRejectedValue(new Error('the database is down'))

    await expect(submitAnswerAction(submitInput)).rejects.toThrow('the database is down')
  })
})

describe('error mapping', () => {
  // A thrown Server Action error reaches the browser as an opaque 500, so every
  // error the service documents has to come back as a value. One case per
  // class, so a new one added to service.ts without a mapping shows up here.
  it.each([
    ['QuizNotFoundError', new QuizNotFoundError('x')],
    ['EmptyQuizError', new EmptyQuizError('x')],
  ])('never throws from startRunAction for %s', async (_name, error) => {
    startRun.mockRejectedValue(error)

    await expect(startRunAction({ slug: quiz.slug })).resolves.toMatchObject({ ok: false })
  })

  it.each([
    ['AttemptNotFoundError', new AttemptNotFoundError('x')],
    ['NotYourAttemptError', new NotYourAttemptError('x')],
    ['QuestionNotInAttemptError', new QuestionNotInAttemptError('x')],
    ['DuplicateAnswerError', new DuplicateAnswerError('x')],
  ])('never throws from submitAnswerAction for %s', async (_name, error) => {
    submitAnswer.mockRejectedValue(error)

    await expect(submitAnswerAction(submitInput)).resolves.toMatchObject({ ok: false })
  })
})
