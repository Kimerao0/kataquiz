import { eq } from 'drizzle-orm'
import { pathSteps, paths, quizzes, user } from '@/db/schema'
import { type TestTx, withTestDb } from '@/test/db'
import { getPath, getPlacements, getPlacementsForQuizzes, listPaths } from './queries'

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

type PathSeed = { authorId?: string | null; isHidden?: boolean; title?: string; createdAt?: Date }

async function insertPath(tx: TestTx, seed: PathSeed = {}) {
  const slug = `path-${crypto.randomUUID()}`
  const [path] = await tx
    .insert(paths)
    .values({
      slug,
      authorId: seed.authorId ?? null,
      title: seed.title ?? 'A path',
      ...(seed.createdAt ? { createdAt: seed.createdAt } : {}),
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

// now() is frozen inside a test transaction, so recency needs explicit, far-future timestamps.
const day = (n: number) => new Date(Date.UTC(2099, 0, n))

describe('listPaths', () => {
  it('lists paths newest first', async () => {
    await withTestDb(async (tx) => {
      const old = await insertPath(tx, { createdAt: day(1) })
      const mid = await insertPath(tx, { createdAt: day(2) })
      const recent = await insertPath(tx, { createdAt: day(3) })

      const { items } = await listPaths({ page: 1, pageSize: 3, executor: tx })

      expect(items.map((item) => item.slug)).toEqual([recent.slug, mid.slug, old.slug])
    })
  })

  it('paginates with a 1-based page', async () => {
    await withTestDb(async (tx) => {
      await insertPath(tx, { createdAt: day(3) })
      await insertPath(tx, { createdAt: day(2) })
      const third = await insertPath(tx, { createdAt: day(1) })

      const { items } = await listPaths({ page: 2, pageSize: 2, executor: tx })

      expect(items[0].slug).toBe(third.slug)
    })
  })

  it('excludes a hidden path from items and total', async () => {
    await withTestDb(async (tx) => {
      const before = await listPaths({ page: 1, pageSize: 100, executor: tx })
      const visible = await insertPath(tx, { createdAt: day(2) })
      const hidden = await insertPath(tx, { createdAt: day(3), isHidden: true })

      const { items, total } = await listPaths({ page: 1, pageSize: 100, executor: tx })

      expect(items.map((item) => item.slug)).toContain(visible.slug)
      expect(items.map((item) => item.slug)).not.toContain(hidden.slug)
      expect(total).toBe(before.total + 1)
    })
  })

  it('counts live steps only in stepCount and quizIds', async () => {
    await withTestDb(async (tx) => {
      const { path, quizzesInOrder } = await seedThreeSteps(tx, { createdAt: day(5) })
      await tx.update(quizzes).set({ isHidden: true }).where(eq(quizzes.id, quizzesInOrder[1].id))

      const { items } = await listPaths({ page: 1, pageSize: 1, executor: tx })

      expect(items[0].slug).toBe(path.slug)
      expect(items[0].stepCount).toBe(2)
      expect(items[0].quizIds).toEqual([quizzesInOrder[0].id, quizzesInOrder[2].id])
    })
  })
})

describe('getPlacements', () => {
  it('returns previous and next around a middle step', async () => {
    await withTestDb(async (tx) => {
      const { path, quizzesInOrder } = await seedThreeSteps(tx)
      const [first, second, third] = quizzesInOrder

      const placements = await getPlacements(second.id, tx)

      expect(placements).toEqual([
        {
          pathSlug: path.slug,
          pathTitle: 'A path',
          position: 2,
          total: 3,
          previous: { position: 1, quizId: first.id, quizSlug: first.slug, quizTitle: 'First' },
          next: { position: 3, quizId: third.id, quizSlug: third.slug, quizTitle: 'Third' },
        },
      ])
    })
  })

  it('has no previous on the first step and no next on the last', async () => {
    await withTestDb(async (tx) => {
      const { quizzesInOrder } = await seedThreeSteps(tx)

      const [atFirst] = await getPlacements(quizzesInOrder[0].id, tx)
      const [atLast] = await getPlacements(quizzesInOrder[2].id, tx)

      expect(atFirst.previous).toBeNull()
      expect(atFirst.next?.quizId).toBe(quizzesInOrder[1].id)
      expect(atLast.next).toBeNull()
      expect(atLast.previous?.quizId).toBe(quizzesInOrder[1].id)
    })
  })

  it('skips a hidden quiz in position, total and neighbours', async () => {
    await withTestDb(async (tx) => {
      const { quizzesInOrder } = await seedThreeSteps(tx)
      await tx.update(quizzes).set({ isHidden: true }).where(eq(quizzes.id, quizzesInOrder[1].id))

      const [placement] = await getPlacements(quizzesInOrder[2].id, tx)

      expect(placement.position).toBe(2)
      expect(placement.total).toBe(2)
      expect(placement.previous?.quizId).toBe(quizzesInOrder[0].id)
      expect(placement.previous?.position).toBe(1)
    })
  })

  it('returns every path containing the quiz, newest path first', async () => {
    await withTestDb(async (tx) => {
      const quiz = await insertQuiz(tx)
      const old = await insertPath(tx, { createdAt: day(1) })
      const recent = await insertPath(tx, { createdAt: day(2) })
      await addSteps(tx, old.id, [{ quizId: quiz.id, position: 1 }])
      await addSteps(tx, recent.id, [{ quizId: quiz.id, position: 1 }])

      const placements = await getPlacements(quiz.id, tx)

      expect(placements.map((placement) => placement.pathSlug)).toEqual([recent.slug, old.slug])
    })
  })

  it('excludes a hidden path', async () => {
    await withTestDb(async (tx) => {
      const { quizzesInOrder } = await seedThreeSteps(tx, { isHidden: true })

      expect(await getPlacements(quizzesInOrder[0].id, tx)).toEqual([])
    })
  })

  it('returns [] for a quiz in no path', async () => {
    await withTestDb(async (tx) => {
      const quiz = await insertQuiz(tx)

      expect(await getPlacements(quiz.id, tx)).toEqual([])
    })
  })
})

describe('getPlacementsForQuizzes', () => {
  it('returns every path per quiz for several quizzes', async () => {
    await withTestDb(async (tx) => {
      const a = await insertQuiz(tx)
      const b = await insertQuiz(tx)
      const old = await insertPath(tx, { createdAt: day(1) })
      const recent = await insertPath(tx, { createdAt: day(2) })
      await addSteps(tx, old.id, [
        { quizId: a.id, position: 1 },
        { quizId: b.id, position: 2 },
      ])
      await addSteps(tx, recent.id, [{ quizId: a.id, position: 1 }])

      const map = await getPlacementsForQuizzes([a.id, b.id], tx)

      expect(map.get(a.id)?.map((placement) => placement.pathSlug)).toEqual([recent.slug, old.slug])
      expect(map.get(b.id)?.map((placement) => placement.pathSlug)).toEqual([old.slug])
      expect(map.get(b.id)?.[0]).toMatchObject({ position: 2, total: 2, next: null })
    })
  })

  it('leaves a quiz in no path out of the map', async () => {
    await withTestDb(async (tx) => {
      const { quizzesInOrder } = await seedThreeSteps(tx)
      const loner = await insertQuiz(tx)

      const map = await getPlacementsForQuizzes([quizzesInOrder[0].id, loner.id], tx)

      expect(map.has(loner.id)).toBe(false)
      expect(map.has(quizzesInOrder[0].id)).toBe(true)
    })
  })

  it('returns an empty map for empty input', async () => {
    await withTestDb(async (tx) => {
      const map = await getPlacementsForQuizzes([], tx)

      expect(map.size).toBe(0)
    })
  })
})
