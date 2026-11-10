import { asc, eq } from 'drizzle-orm'
import { pathSteps, paths, quizzes, user } from '@/db/schema'
import { SEED_AUTHOR_ID } from '@/lib/quizzes/seed'
import { type TestTx, withTestDb } from '@/test/db'
import type { PathFile, PathStepRef } from './file'
import { importPath, PathStepError } from './import'

async function insertUser(tx: TestTx) {
  const id = `user-${crypto.randomUUID()}`
  await tx.insert(user).values({ id, name: 'Author', email: `${id}@example.com` })
  return id
}

async function insertSeedAuthor(tx: TestTx) {
  await tx
    .insert(user)
    .values({ id: SEED_AUTHOR_ID, name: 'Kataquiz Seeds', email: 'seeds@seed.invalid' })
    .onConflictDoNothing()
}

async function insertQuiz(
  tx: TestTx,
  params: { authorId: string; title?: string; isHidden?: boolean },
) {
  const [quiz] = await tx
    .insert(quizzes)
    .values({
      slug: `quiz-${crypto.randomUUID()}`,
      authorId: params.authorId,
      title: params.title ?? 'Italian Driving Licence - Road Signs',
      language: 'it',
      questionsPerRun: 1,
      maxErrors: 0,
      isHidden: params.isHidden ?? false,
    })
    .returning({ id: quizzes.id, slug: quizzes.slug })
  return quiz
}

// Built by hand rather than parsed, so a test can hand importPath what the
// parser would never let through.
function pathFile(steps: PathStepRef[], title = `Road to the licence ${crypto.randomUUID()}`) {
  const file: PathFile = { version: 1, kind: 'path', title, language: 'it', steps }
  return file
}

function readSteps(tx: TestTx, pathId: string) {
  return tx
    .select({ quizId: pathSteps.quizId, position: pathSteps.position })
    .from(pathSteps)
    .where(eq(pathSteps.pathId, pathId))
    .orderBy(asc(pathSteps.position))
}

function pathsTitled(tx: TestTx, title: string) {
  return tx.select().from(paths).where(eq(paths.title, title))
}

async function caughtError(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise
  } catch (error) {
    return error
  }
  return null
}

async function expectStepError(promise: Promise<unknown>, step: number) {
  const error = await caughtError(promise)
  if (!(error instanceof PathStepError)) {
    throw new Error(`expected a PathStepError, got ${String(error)}`)
  }
  expect(error.step).toBe(step)
  expect(error.message).toMatch(new RegExp(`^step ${step}: `))
}

describe('importPath', () => {
  it('imports steps in file order', async () => {
    await withTestDb(async (tx) => {
      const authorId = await insertUser(tx)
      const first = await insertQuiz(tx, { authorId })
      const second = await insertQuiz(tx, { authorId })
      const third = await insertQuiz(tx, { authorId })
      // Not the order the quizzes were created in, so insertion order cannot
      // pass for file order.
      const file = pathFile([{ quiz: third.slug }, { quiz: first.slug }, { quiz: second.slug }])

      const { pathId, slug } = await importPath({ file, authorId, resolveBy: 'slug', executor: tx })

      const [path] = await tx.select().from(paths).where(eq(paths.id, pathId))
      expect(path.slug).toBe(slug)
      expect(path.slug).toMatch(/^road-to-the-licence-/)
      expect(path.authorId).toBe(authorId)
      expect(path.title).toBe(file.title)
      expect(await readSteps(tx, pathId)).toEqual([
        { quizId: third.id, position: 1 },
        { quizId: first.id, position: 2 },
        { quizId: second.id, position: 3 },
      ])
    })
  })

  it('rejects an unknown slug', async () => {
    await withTestDb(async (tx) => {
      const authorId = await insertUser(tx)
      const known = await insertQuiz(tx, { authorId })
      const file = pathFile([{ quiz: known.slug }, { quiz: `missing-${crypto.randomUUID()}` }])

      await expectStepError(importPath({ file, authorId, resolveBy: 'slug', executor: tx }), 2)

      // The caller owns this transaction, so nothing rolls a half-written path
      // back: the steps have to be resolved before anything is inserted.
      expect(await pathsTitled(tx, file.title)).toEqual([])
    })
  })

  it('rejects a hidden quiz', async () => {
    await withTestDb(async (tx) => {
      const authorId = await insertUser(tx)
      const live = await insertQuiz(tx, { authorId })
      const hidden = await insertQuiz(tx, { authorId, isHidden: true })
      const file = pathFile([{ quiz: live.slug }, { quiz: hidden.slug }])

      await expectStepError(importPath({ file, authorId, resolveBy: 'slug', executor: tx }), 2)
      expect(await pathsTitled(tx, file.title)).toEqual([])
    })
  })

  it('rejects a title step when resolving by slug', async () => {
    await withTestDb(async (tx) => {
      const authorId = await insertUser(tx)
      const title = `Road signs ${crypto.randomUUID()}`
      const first = await insertQuiz(tx, { authorId })
      // A live quiz carries the title, so the mode is the only reason to refuse.
      await insertQuiz(tx, { authorId, title })
      const file = pathFile([{ quiz: first.slug }, { title }])

      await expectStepError(importPath({ file, authorId, resolveBy: 'slug', executor: tx }), 2)
      expect(await pathsTitled(tx, file.title)).toEqual([])
    })
  })

  it('rejects two steps that resolve to the same quiz', async () => {
    await withTestDb(async (tx) => {
      const authorId = await insertUser(tx)
      const quiz = await insertQuiz(tx, { authorId })
      const file = pathFile([{ quiz: quiz.slug }, { quiz: quiz.slug }])

      await expectStepError(importPath({ file, authorId, resolveBy: 'slug', executor: tx }), 2)
      expect(await pathsTitled(tx, file.title)).toEqual([])
    })
  })

  it("resolves seed titles among the seed author's quizzes only", async () => {
    await withTestDb(async (tx) => {
      await insertSeedAuthor(tx)
      const otherAuthorId = await insertUser(tx)
      const sharedTitle = `Architect Roadmap 01 ${crypto.randomUUID()}`
      const otherOnlyTitle = `Architect Roadmap 02 ${crypto.randomUUID()}`
      // Created first, so a lookup that ignored the author would find it first.
      await insertQuiz(tx, { authorId: otherAuthorId, title: sharedTitle })
      const seeded = await insertQuiz(tx, { authorId: SEED_AUTHOR_ID, title: sharedTitle })
      await insertQuiz(tx, { authorId: otherAuthorId, title: otherOnlyTitle })

      const matched = pathFile([{ title: sharedTitle }])
      const { pathId } = await importPath({
        file: matched,
        authorId: SEED_AUTHOR_ID,
        resolveBy: 'seedTitle',
        executor: tx,
      })
      expect(await readSteps(tx, pathId)).toEqual([{ quizId: seeded.id, position: 1 }])

      const unmatched = pathFile([{ title: sharedTitle }, { title: otherOnlyTitle }])
      await expectStepError(
        importPath({
          file: unmatched,
          authorId: SEED_AUTHOR_ID,
          resolveBy: 'seedTitle',
          executor: tx,
        }),
        2,
      )
      expect(await pathsTitled(tx, unmatched.title)).toEqual([])
    })
  })
})
