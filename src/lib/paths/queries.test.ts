import { eq } from 'drizzle-orm'
import { pathSteps, paths, quizzes, user } from '@/db/schema'
import { type TestTx, withTestDb } from '@/test/db'
import { getPath } from './queries'

async function insertUser(tx: TestTx, name = 'Author') {
  const id = `user-${crypto.randomUUID()}`
  await tx.insert(user).values({ id, name, email: `${id}@example.com` })
  return id
}

async function insertQuiz(tx: TestTx, overrides: { title?: string; isHidden?: boolean } = {}) {
  const slug = `quiz-${crypto.randomUUID()}`
  const [quiz] = await tx
    .insert(quizzes)
    .values({
      slug,
      title: overrides.title ?? 'A quiz',
      language: 'en',
      questionsPerRun: 10,
      maxErrors: 3,
      isHidden: overrides.isHidden ?? false,
    })
    .returning({ id: quizzes.id, slug: quizzes.slug, title: quizzes.title })
  return quiz
}

type PathSeed = { authorId?: string | null; isHidden?: boolean }

async function insertPath(tx: TestTx, seed: PathSeed = {}) {
  const slug = `path-${crypto.randomUUID()}`
  const [path] = await tx
    .insert(paths)
    .values({
      slug,
      authorId: seed.authorId ?? null,
      title: 'A path',
      language: 'en',
      isHidden: seed.isHidden ?? false,
    })
    .returning({ id: paths.id, slug: paths.slug })
  return path
}

async function addSteps(tx: TestTx, pathId: string, steps: { quizId: string; position: number }[]) {
  await tx.insert(pathSteps).values(steps.map((step) => ({ pathId, ...step })))
}

// Three quizzes at stored positions 1..3, in that order.
async function seedThreeSteps(tx: TestTx, seed: PathSeed = {}) {
  const path = await insertPath(tx, seed)
  const quizzesInOrder = [
    await insertQuiz(tx, { title: 'First' }),
    await insertQuiz(tx, { title: 'Second' }),
    await insertQuiz(tx, { title: 'Third' }),
  ]
  await addSteps(
    tx,
    path.id,
    quizzesInOrder.map((quiz, index) => ({ quizId: quiz.id, position: index + 1 })),
  )
  return { path, quizzesInOrder }
}

describe('getPath', () => {
  it('returns the steps in stored position order', async () => {
    await withTestDb(async (tx) => {
      const path = await insertPath(tx)
      const a = await insertQuiz(tx, { title: 'A' })
      const b = await insertQuiz(tx, { title: 'B' })
      const c = await insertQuiz(tx, { title: 'C' })
      // Inserted out of order, so only an ORDER BY can produce the right result.
      await addSteps(tx, path.id, [
        { quizId: c.id, position: 3 },
        { quizId: a.id, position: 1 },
        { quizId: b.id, position: 2 },
      ])

      const detail = await getPath(path.slug, tx)

      expect(detail?.steps).toEqual([
        { position: 1, quizId: a.id, quizSlug: a.slug, quizTitle: 'A' },
        { position: 2, quizId: b.id, quizSlug: b.slug, quizTitle: 'B' },
        { position: 3, quizId: c.id, quizSlug: c.slug, quizTitle: 'C' },
      ])
    })
  })

  it('skips a hidden quiz and renumbers the live steps', async () => {
    await withTestDb(async (tx) => {
      const { path, quizzesInOrder } = await seedThreeSteps(tx)
      await tx.update(quizzes).set({ isHidden: true }).where(eq(quizzes.id, quizzesInOrder[1].id))

      const detail = await getPath(path.slug, tx)

      expect(detail?.steps.map((step) => [step.position, step.quizId])).toEqual([
        [1, quizzesInOrder[0].id],
        [2, quizzesInOrder[2].id],
      ])
    })
  })

  it("drops a deleted quiz's step", async () => {
    await withTestDb(async (tx) => {
      const { path, quizzesInOrder } = await seedThreeSteps(tx)
      await tx.delete(quizzes).where(eq(quizzes.id, quizzesInOrder[1].id))

      const detail = await getPath(path.slug, tx)

      expect(detail?.steps).toHaveLength(2)
      expect(detail?.steps.map((step) => step.quizId)).toEqual([
        quizzesInOrder[0].id,
        quizzesInOrder[2].id,
      ])
    })
  })

  it('returns steps [] when every quiz is hidden', async () => {
    await withTestDb(async (tx) => {
      const { path } = await seedThreeSteps(tx)
      await tx.update(quizzes).set({ isHidden: true })

      const detail = await getPath(path.slug, tx)

      expect(detail).not.toBeNull()
      expect(detail?.steps).toEqual([])
    })
  })

  it('returns null for a hidden path', async () => {
    await withTestDb(async (tx) => {
      const { path } = await seedThreeSteps(tx, { isHidden: true })

      expect(await getPath(path.slug, tx)).toBeNull()
    })
  })

  it('returns null for an unknown slug', async () => {
    await withTestDb(async (tx) => {
      expect(await getPath('no-such-path', tx)).toBeNull()
    })
  })

  it("returns the author's name", async () => {
    await withTestDb(async (tx) => {
      const authorId = await insertUser(tx, 'Ada')
      const path = await insertPath(tx, { authorId })

      const detail = await getPath(path.slug, tx)

      expect(detail?.authorName).toBe('Ada')
    })
  })

  it('returns a null authorName once the author is deleted', async () => {
    await withTestDb(async (tx) => {
      const authorId = await insertUser(tx, 'Ada')
      const path = await insertPath(tx, { authorId })
      await tx.delete(user).where(eq(user.id, authorId))

      const detail = await getPath(path.slug, tx)

      expect(detail).not.toBeNull()
      expect(detail?.authorName).toBeNull()
    })
  })
})
