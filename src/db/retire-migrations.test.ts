import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { SEED_AUTHOR_ID } from '@/lib/quizzes/seed-author'
import { type TestTx, withTestDb } from '@/test/db'
import { attempts, options, pathSteps, paths, questions, quizzes, user } from './schema'

const MIGRATION = 'drizzle/0008_retire-architect-r1.sql'
const PATH_TITLE = 'Road to Software Architect'
const RETIRED_TITLES = [
  'Architect Roadmap 01: React fundamentals',
  'Architect Roadmap 02: React state and events',
  'Architect Roadmap 03: React effects and lifecycle',
  'Architect Roadmap 04: Advanced hooks and custom hooks',
  'Architect Roadmap 05: React performance and rendering',
  "Architect Roadmap 06: What's new in React 19",
]
const KEPT_TITLE = 'Architect Roadmap 07: App Router and routing'

async function runMigration(tx: TestTx) {
  const text = readFileSync(join(process.cwd(), MIGRATION), 'utf8')
  const statements = text.split('--> statement-breakpoint').filter((stmt) => stmt.trim())
  for (const stmt of statements) await tx.execute(sql.raw(stmt))
}

async function insertSeedAuthor(tx: TestTx) {
  await tx
    .insert(user)
    .values({ id: SEED_AUTHOR_ID, name: 'Kataquiz Seeds', email: 'seeds@seed.invalid' })
    .onConflictDoNothing()
}

async function insertUser(tx: TestTx) {
  const id = `user-${crypto.randomUUID()}`
  await tx.insert(user).values({ id, name: 'Author', email: `${id}@example.com` })
  return id
}

async function insertQuiz(tx: TestTx, authorId: string, title: string) {
  const [quiz] = await tx
    .insert(quizzes)
    .values({
      slug: `quiz-${crypto.randomUUID()}`,
      authorId,
      title,
      language: 'en',
      questionsPerRun: 1,
      maxErrors: 0,
    })
    .returning({ id: quizzes.id })
  const [question] = await tx
    .insert(questions)
    .values({ quizId: quiz.id, position: 0, type: 'boolean', prompt: 'Is this retired?' })
    .returning({ id: questions.id })
  await tx
    .insert(options)
    .values({ questionId: question.id, position: 0, text: 'True', isCorrect: true })
  return { quizId: quiz.id, questionId: question.id }
}

async function insertAttempt(
  tx: TestTx,
  quiz: { quizId: string; questionId: string },
  challengeOfAttemptId?: string,
) {
  const [attempt] = await tx
    .insert(attempts)
    .values({ quizId: quiz.quizId, questionIds: [quiz.questionId], challengeOfAttemptId })
    .returning({ id: attempts.id })
  return attempt.id
}

async function insertPath(tx: TestTx, quizIds: string[]) {
  const [path] = await tx
    .insert(paths)
    .values({
      slug: `path-${crypto.randomUUID()}`,
      authorId: SEED_AUTHOR_ID,
      title: PATH_TITLE,
      language: 'en',
    })
    .returning({ id: paths.id })
  await tx
    .insert(pathSteps)
    .values(quizIds.map((quizId, index) => ({ pathId: path.id, quizId, position: index + 1 })))
  return path.id
}

async function arrange(tx: TestTx) {
  await insertSeedAuthor(tx)
  const retired = []
  for (const title of RETIRED_TITLES) retired.push(await insertQuiz(tx, SEED_AUTHOR_ID, title))
  const first = await insertAttempt(tx, retired[0])
  await insertAttempt(tx, retired[0], first)
  const kept = await insertQuiz(tx, SEED_AUTHOR_ID, KEPT_TITLE)
  const keptAttemptId = await insertAttempt(tx, kept)
  const pathId = await insertPath(tx, [retired[0].quizId, kept.quizId])
  const otherUser = await insertUser(tx)
  const foreign = await insertQuiz(tx, otherUser, RETIRED_TITLES[0])
  return { retired, kept, keptAttemptId, pathId, foreign }
}

describe('0008 retire architect R1', () => {
  it('deletes the seed quizzes 01-06 with their questions and attempts', async () => {
    await withTestDb(async (tx) => {
      const { retired } = await arrange(tx)
      await runMigration(tx)

      const quizIds = retired.map((quiz) => quiz.quizId)
      const remaining = await tx
        .select({ id: quizzes.id })
        .from(quizzes)
        .where(and(eq(quizzes.authorId, SEED_AUTHOR_ID), inArray(quizzes.title, RETIRED_TITLES)))
      expect(remaining).toEqual([])
      expect(await tx.select().from(questions).where(inArray(questions.quizId, quizIds))).toEqual(
        [],
      )
      expect(await tx.select().from(attempts).where(inArray(attempts.quizId, quizIds))).toEqual([])
    })
  })

  it('deletes the seed path and its steps', async () => {
    await withTestDb(async (tx) => {
      const { pathId } = await arrange(tx)
      await runMigration(tx)

      const remaining = await tx
        .select({ id: paths.id })
        .from(paths)
        .where(and(eq(paths.authorId, SEED_AUTHOR_ID), eq(paths.title, PATH_TITLE)))
      expect(remaining).toEqual([])
      expect(await tx.select().from(pathSteps).where(eq(pathSteps.pathId, pathId))).toEqual([])
    })
  })

  it("keeps another user's quiz with a retired title", async () => {
    await withTestDb(async (tx) => {
      const { foreign } = await arrange(tx)
      await runMigration(tx)

      const [quiz] = await tx.select().from(quizzes).where(eq(quizzes.id, foreign.quizId))
      expect(quiz?.title).toBe(RETIRED_TITLES[0])
    })
  })

  it('keeps seed quiz 07 and its attempt', async () => {
    await withTestDb(async (tx) => {
      const { kept, keptAttemptId } = await arrange(tx)
      await runMigration(tx)

      const [quiz] = await tx.select().from(quizzes).where(eq(quizzes.id, kept.quizId))
      expect(quiz?.title).toBe(KEPT_TITLE)
      const [attempt] = await tx.select().from(attempts).where(eq(attempts.id, keptAttemptId))
      expect(attempt?.quizId).toBe(kept.quizId)
    })
  })

  it('runs cleanly when there is nothing to retire', async () => {
    await withTestDb(async (tx) => {
      await expect(runMigration(tx)).resolves.toBeUndefined()
    })
  })
})
