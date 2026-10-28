import { RUN_START_LIMIT, RUN_START_WINDOW_SEC } from '@/lib/rate-limit'
import { ChallengeNotFoundError, NotAChallengeError } from '@/lib/run/challenge'
import { EmptyQuizError, QuizNotFoundError } from '@/lib/run/service'
import { fetchChallengeComparisonAction, startChallengeRunAction } from './actions'

const {
  getCurrentUser,
  getOrCreateGuestId,
  checkRateLimit,
  getChallenge,
  startChallengeRun,
  getChallengeComparison,
} = vi.hoisted(() => ({
  getCurrentUser: vi.fn<typeof import('@/lib/session').getCurrentUser>(),
  getOrCreateGuestId: vi.fn<typeof import('@/lib/guest').getOrCreateGuestId>(),
  checkRateLimit: vi.fn<typeof import('@/lib/rate-limit').checkRateLimit>(),
  getChallenge: vi.fn<typeof import('@/lib/run/challenge').getChallenge>(),
  startChallengeRun: vi.fn<typeof import('@/lib/run/challenge').startChallengeRun>(),
  getChallengeComparison: vi.fn<typeof import('@/lib/run/challenge').getChallengeComparison>(),
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

// Only the reads and the write are stubbed. The error classes have to stay
// real: the action maps them with instanceof, and a copied class would pass a
// test the production module would fail.
vi.mock('@/lib/run/challenge', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/run/challenge')>()),
  getChallenge,
  startChallengeRun,
  getChallengeComparison,
}))

// @/lib/run/identity is deliberately not mocked: resolvePlayer and runLimitKey
// are what these tests are about, and the ownership read that used to be
// stubbed here now lives inside getChallengeComparison, where challenge.test.ts
// covers it against a real Postgres.

const user = { id: 'user-1', name: 'Ada Lovelace', image: null }

// Attempt ids are uuids in the database, and the action checks their shape
// before any lookup, so the fixtures have to be real ones.
const attemptId = '11111111-1111-4111-8111-111111111111'
const theirAttemptId = '22222222-2222-4222-8222-222222222222'
const myAttemptId = '33333333-3333-4333-8333-333333333333'

const invite = {
  attemptId,
  quizId: 'quiz-1',
  quizSlug: 'road-signs-ab12cd',
  quizTitle: 'Road signs',
  opponentName: 'Bea',
  questionCount: 8,
}

const run = {
  attemptId: 'attempt-2',
  question: {
    id: 'q1',
    type: 'single' as const,
    prompt: 'Why?',
    imageUrl: null,
    code: null,
    codeLanguage: null,
    options: [],
  },
  total: 8,
  timePerQuestionSec: 30,
}

const comparison = {
  mine: { attemptId: 'attempt-2', score: 7, errors: 1, total: 8, passed: true },
  theirs: { attemptId, score: 5, errors: 3, total: 8, passed: false },
}

beforeEach(() => {
  vi.clearAllMocks()
  getCurrentUser.mockResolvedValue(user)
  getOrCreateGuestId.mockResolvedValue('guest-1')
  checkRateLimit.mockResolvedValue(true)
  getChallenge.mockResolvedValue(invite)
  startChallengeRun.mockResolvedValue(run)
  getChallengeComparison.mockResolvedValue(comparison)
})

describe('startChallengeRunAction', () => {
  it('derives the player from the session, ignoring any client-supplied id', async () => {
    // What a hand-written client would post to play as somebody else. The
    // action's own input type has no such field, hence the cast.
    const hostile = { attemptId, nickname: 'Mallory', userId: 'victim', guestId: 'victim' }

    const result = await startChallengeRunAction(hostile as never)

    expect(result).toEqual({ ok: true, run })
    // Exact, not objectContaining: an implementation that spread the payload
    // into the service call would fail here.
    expect(startChallengeRun).toHaveBeenCalledWith({
      attemptId,
      player: { kind: 'user', userId: user.id },
    })
  })

  it('plays a signed-out caller as the guest the cookie names, with their nickname', async () => {
    getCurrentUser.mockResolvedValue(null)

    await startChallengeRunAction({ attemptId, nickname: '  Bea  ' })

    expect(startChallengeRun).toHaveBeenCalledWith({
      attemptId,
      player: { kind: 'guest', guestId: 'guest-1', nickname: 'Bea' },
    })
  })

  it('rate-limits challenge starts', async () => {
    checkRateLimit.mockResolvedValue(false)

    const result = await startChallengeRunAction({ attemptId })

    expect(result).toEqual({ ok: false, error: 'rateLimited' })
    expect(checkRateLimit).toHaveBeenCalledWith(
      `run:user:${user.id}`,
      RUN_START_LIMIT,
      RUN_START_WINDOW_SEC,
    )
    // Nothing was written: the limit has to bite before the attempt row.
    expect(startChallengeRun).not.toHaveBeenCalled()
  })

  it('keys the limit on the guest cookie for a signed-out caller', async () => {
    getCurrentUser.mockResolvedValue(null)

    await startChallengeRunAction({ attemptId })

    expect(checkRateLimit).toHaveBeenCalledWith(
      'run:guest:guest-1',
      RUN_START_LIMIT,
      RUN_START_WINDOW_SEC,
    )
  })

  it('maps a missing challenge to { ok: false, error: notFound }', async () => {
    getChallenge.mockResolvedValue(null)

    const result = await startChallengeRunAction({ attemptId })

    expect(result).toEqual({ ok: false, error: 'notFound' })
    expect(startChallengeRun).not.toHaveBeenCalled()
  })

  it('maps an attempt id that is not a uuid to notFound without a lookup', async () => {
    // Postgres answers a malformed uuid with a query error, which would reach
    // the browser as an opaque 500 instead of "that challenge is gone".
    const result = await startChallengeRunAction({ attemptId: "' or 1=1 --" })

    expect(result).toEqual({ ok: false, error: 'notFound' })
    expect(getChallenge).not.toHaveBeenCalled()
    expect(startChallengeRun).not.toHaveBeenCalled()
  })

  it('maps EmptyQuizError to { ok: false, error: empty }', async () => {
    startChallengeRun.mockRejectedValue(new EmptyQuizError('that quiz has no questions to play'))

    await expect(startChallengeRunAction({ attemptId })).resolves.toEqual({
      ok: false,
      error: 'empty',
    })
  })

  it('maps ChallengeNotFoundError to { ok: false, error: notFound }', async () => {
    startChallengeRun.mockRejectedValue(new ChallengeNotFoundError('gone'))

    await expect(startChallengeRunAction({ attemptId })).resolves.toEqual({
      ok: false,
      error: 'notFound',
    })
  })

  it('lets an unexpected failure through instead of reporting it as a missing challenge', async () => {
    // Returning this one as 'notFound' would tell the player the link is dead
    // while the real fault is the database.
    startChallengeRun.mockRejectedValue(new Error('the database is down'))

    await expect(startChallengeRunAction({ attemptId })).rejects.toThrow('the database is down')
  })

  // A thrown Server Action error reaches the browser as an opaque 500, so every
  // error the service documents has to come back as a value. One case per
  // class, so a new one added without a mapping shows up here.
  it.each([
    ['ChallengeNotFoundError', new ChallengeNotFoundError('x')],
    ['QuizNotFoundError', new QuizNotFoundError('x')],
    ['EmptyQuizError', new EmptyQuizError('x')],
  ])('never throws for %s', async (_name, error) => {
    startChallengeRun.mockRejectedValue(error)

    await expect(startChallengeRunAction({ attemptId })).resolves.toMatchObject({ ok: false })
  })
})

describe('fetchChallengeComparisonAction', () => {
  it('returns both summaries for a finished run the caller owns', async () => {
    const result = await fetchChallengeComparisonAction({ attemptId: myAttemptId })

    expect(result).toEqual({ ok: true, comparison })
    // Two arguments, not one: the player is what lets getChallengeComparison
    // decide ownership for itself instead of trusting this caller to have
    // checked first.
    expect(getChallengeComparison).toHaveBeenCalledWith(myAttemptId, {
      kind: 'user',
      userId: user.id,
    })
  })

  it('hands over the derived player, never anything from the payload', async () => {
    // The spoiler guard lives in getChallengeComparison now, so the one thing
    // this action still owes it is an identity the caller cannot choose:
    // /c/<attemptId> is a public link, and an attempt that was itself a
    // challenge has both scores behind it.
    getCurrentUser.mockResolvedValue(null)
    const hostile = { attemptId: theirAttemptId, guestId: 'victim', userId: 'root' }

    await fetchChallengeComparisonAction(hostile as never)

    expect(getChallengeComparison).toHaveBeenCalledWith(theirAttemptId, {
      kind: 'guest',
      guestId: 'guest-1',
      nickname: '',
    })
  })

  it('reports null as nothing to compare, not as an error', async () => {
    // Null covers an unfinished run and a caller who is not playing this one.
    // The action cannot tell them apart, which is the point: neither can the
    // browser.
    getChallengeComparison.mockResolvedValue(null)

    await expect(fetchChallengeComparisonAction({ attemptId })).resolves.toEqual({
      ok: true,
      comparison: null,
    })
  })

  it('maps NotAChallengeError to { ok: false, error: notFound }', async () => {
    getChallengeComparison.mockRejectedValue(new NotAChallengeError('not a challenge'))

    await expect(fetchChallengeComparisonAction({ attemptId })).resolves.toEqual({
      ok: false,
      error: 'notFound',
    })
  })

  it('maps an attempt id that is not a uuid to notFound without a lookup', async () => {
    const result = await fetchChallengeComparisonAction({ attemptId: 'not-a-uuid' })

    expect(result).toEqual({ ok: false, error: 'notFound' })
    expect(getChallengeComparison).not.toHaveBeenCalled()
  })

  it('lets an unexpected failure through', async () => {
    getChallengeComparison.mockRejectedValue(new Error('the database is down'))

    await expect(fetchChallengeComparisonAction({ attemptId })).rejects.toThrow(
      'the database is down',
    )
  })
})
