import { attempts, quizzes, user } from '@/db/schema'
import { type TestTx, withTestDb } from '@/test/db'
import { getBestTiers } from './progress'

async function insertUser(tx: TestTx) {
  const id = `user-${crypto.randomUUID()}`
  await tx.insert(user).values({ id, name: 'Player', email: `${id}@example.com` })
  return id
}

async function seedQuiz(tx: TestTx, authorId: string) {
  const [quiz] = await tx
    .insert(quizzes)
    .values({
      slug: `quiz-${crypto.randomUUID()}`,
      authorId,
      title: 'A quiz',
      language: 'it',
      questionsPerRun: 10,
      maxErrors: 3,
    })
    .returning({ id: quizzes.id })

  return quiz.id
}

type RunSeed = {
  quizId: string
  userId: string
  score: number
  errors: number
  finished?: boolean
}

async function seedRun(tx: TestTx, seed: RunSeed) {
  await tx.insert(attempts).values({
    quizId: seed.quizId,
    questionIds: [],
    userId: seed.userId,
    score: seed.score,
    errors: seed.errors,
    finishedAt: seed.finished === false ? null : new Date(),
  })
}

describe('getBestTiers', () => {
  it('keeps the best of several runs', async () => {
    await withTestDb(async (tx) => {
      const userId = await insertUser(tx)
      const quizId = await seedQuiz(tx, userId)
      // Gold first: rows come back in insertion order, so a last-wins merge
      // would end on bronze and fail here.
      await seedRun(tx, { quizId, userId, score: 10, errors: 0 })
      await seedRun(tx, { quizId, userId, score: 7, errors: 3 })

      const tiers = await getBestTiers(userId, [quizId], tx)

      expect(tiers.get(quizId)).toBe('gold')
    })
  })

  it('ignores an unfinished run', async () => {
    await withTestDb(async (tx) => {
      const userId = await insertUser(tx)
      const quizId = await seedQuiz(tx, userId)
      await seedRun(tx, { quizId, userId, score: 7, errors: 3 })
      await seedRun(tx, { quizId, userId, score: 10, errors: 0, finished: false })

      const tiers = await getBestTiers(userId, [quizId], tx)

      expect(tiers.get(quizId)).toBe('bronze')
    })
  })

  it("ignores another player's runs", async () => {
    await withTestDb(async (tx) => {
      const userId = await insertUser(tx)
      const otherId = await insertUser(tx)
      const quizId = await seedQuiz(tx, userId)
      await seedRun(tx, { quizId, userId: otherId, score: 10, errors: 0 })

      const tiers = await getBestTiers(userId, [quizId], tx)

      expect(tiers.has(quizId)).toBe(false)
    })
  })

  it('leaves out a quiz whose only run failed', async () => {
    await withTestDb(async (tx) => {
      const userId = await insertUser(tx)
      const quizId = await seedQuiz(tx, userId)
      await seedRun(tx, { quizId, userId, score: 6, errors: 4 })

      const tiers = await getBestTiers(userId, [quizId], tx)

      expect(tiers.has(quizId)).toBe(false)
    })
  })

  it('ignores quizzes it was not asked about', async () => {
    await withTestDb(async (tx) => {
      const userId = await insertUser(tx)
      const asked = await seedQuiz(tx, userId)
      const notAsked = await seedQuiz(tx, userId)
      await seedRun(tx, { quizId: notAsked, userId, score: 10, errors: 0 })

      const tiers = await getBestTiers(userId, [asked], tx)

      expect(tiers.size).toBe(0)
    })
  })

  it('returns an empty map for no quizzes', async () => {
    await withTestDb(async (tx) => {
      const userId = await insertUser(tx)
      const quizId = await seedQuiz(tx, userId)
      await seedRun(tx, { quizId, userId, score: 10, errors: 0 })

      const tiers = await getBestTiers(userId, [], tx)

      expect(tiers.size).toBe(0)
    })
  })
})
