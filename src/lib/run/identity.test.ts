import { attempts, quizzes, user } from '@/db/schema'
import { type TestTx, withTestDb } from '@/test/db'
import { isAttemptPlayedBy, runLimitKey } from './identity'

async function seedQuiz(tx: TestTx): Promise<string> {
  const userId = `user-${crypto.randomUUID()}`
  await tx.insert(user).values({ id: userId, name: 'Author', email: `${userId}@example.com` })

  const [quiz] = await tx
    .insert(quizzes)
    .values({
      slug: `quiz-${crypto.randomUUID()}`,
      authorId: userId,
      title: 'Road signs',
      language: 'it',
      questionsPerRun: 1,
      maxErrors: 0,
    })
    .returning({ id: quizzes.id })

  return quiz.id
}

async function seedUser(tx: TestTx, name: string): Promise<string> {
  const userId = `user-${crypto.randomUUID()}`
  await tx.insert(user).values({ id: userId, name, email: `${userId}@example.com` })
  return userId
}

// The question set is irrelevant here: ownership is decided by the two identity
// columns and nothing else.
async function seedAttempt(
  tx: TestTx,
  owner: { userId?: string; guestId?: string },
): Promise<string> {
  const quizId = await seedQuiz(tx)
  const [attempt] = await tx
    .insert(attempts)
    .values({ quizId, questionIds: [], ...owner })
    .returning({ id: attempts.id })
  return attempt.id
}

describe('runLimitKey', () => {
  it('keys a user and a guest separately', () => {
    expect(runLimitKey({ kind: 'user', userId: 'u1' })).toBe('run:user:u1')
    expect(runLimitKey({ kind: 'guest', guestId: 'g1', nickname: 'Bea' })).toBe('run:guest:g1')
  })
})

describe('isAttemptPlayedBy', () => {
  it('recognises the signed-in player who started the run', async () => {
    await withTestDb(async (tx) => {
      const userId = await seedUser(tx, 'Player')
      const attemptId = await seedAttempt(tx, { userId })

      await expect(isAttemptPlayedBy(attemptId, { kind: 'user', userId }, tx)).resolves.toBe(true)
    })
  })

  it('refuses a different signed-in player', async () => {
    await withTestDb(async (tx) => {
      const userId = await seedUser(tx, 'Player')
      const otherId = await seedUser(tx, 'Stranger')
      const attemptId = await seedAttempt(tx, { userId })

      await expect(
        isAttemptPlayedBy(attemptId, { kind: 'user', userId: otherId }, tx),
      ).resolves.toBe(false)
    })
  })

  it('recognises the guest cookie that started the run', async () => {
    await withTestDb(async (tx) => {
      const attemptId = await seedAttempt(tx, { guestId: 'guest-1' })

      await expect(
        isAttemptPlayedBy(attemptId, { kind: 'guest', guestId: 'guest-1', nickname: 'Bea' }, tx),
      ).resolves.toBe(true)
    })
  })

  it('refuses a different guest cookie', async () => {
    await withTestDb(async (tx) => {
      const attemptId = await seedAttempt(tx, { guestId: 'guest-1' })

      await expect(
        isAttemptPlayedBy(attemptId, { kind: 'guest', guestId: 'guest-2', nickname: '' }, tx),
      ).resolves.toBe(false)
    })
  })

  it('refuses a guest asking about a signed-in player run', async () => {
    await withTestDb(async (tx) => {
      // Both identity columns are nullable, so a null guestId must never match
      // a caller whose own guestId happens to be absent either.
      const userId = await seedUser(tx, 'Player')
      const attemptId = await seedAttempt(tx, { userId })

      await expect(
        isAttemptPlayedBy(attemptId, { kind: 'guest', guestId: 'guest-1', nickname: '' }, tx),
      ).resolves.toBe(false)
    })
  })

  it('refuses an attempt that does not exist', async () => {
    await withTestDb(async (tx) => {
      const userId = await seedUser(tx, 'Player')

      await expect(
        isAttemptPlayedBy('44444444-4444-4444-8444-444444444444', { kind: 'user', userId }, tx),
      ).resolves.toBe(false)
    })
  })
})
