import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { SEED_AUTHOR_ID } from '@/lib/quizzes/seed-author'
import { type TestTx, withTestDb } from '@/test/db'
import { attempts, options, pathSteps, paths, questions, quizzes, user } from './schema'

const PATH_TITLE = 'Road to Software Architect'
const R1_MIGRATION = 'drizzle/0008_retire-architect-r1.sql'
const R1_RETIRED_TITLES = [
  'Architect Roadmap 01: React fundamentals',
  'Architect Roadmap 02: React state and events',
  'Architect Roadmap 03: React effects and lifecycle',
  'Architect Roadmap 04: Advanced hooks and custom hooks',
  'Architect Roadmap 05: React performance and rendering',
  "Architect Roadmap 06: What's new in React 19",
]
const R1_KEPT_TITLE = 'Architect Roadmap 07: App Router and routing'
const R2_MIGRATION = 'drizzle/0009_retire-architect-r2.sql'
const R2_RETIRED_TITLES = [
  'Architect Roadmap 07: App Router and routing',
  'Architect Roadmap 08: Server and Client Components',
  'Architect Roadmap 09: Data fetching, caching and Server Actions',
  'Architect Roadmap 10: Next.js in production',
  'Architect Roadmap 11: Design patterns in React',
  'Architect Roadmap 12: State architecture',
  'Architect Roadmap 13: Next.js as a backend [SCENARIO]',
  'Architect Roadmap 15: System design of a production Next.js app [SCENARIO]',
]
const R2_KEPT_TITLE = 'Architect Roadmap 14: Rendering and caching strategies at scale [SCENARIO]'
const R3_MIGRATION = 'drizzle/0010_retire-architect-r3.sql'
const R3_RETIRED_TITLES = [
  'Architect Roadmap 16: Node.js core concepts and the event loop',
  'Architect Roadmap 17: Node.js asynchronous patterns',
  'Architect Roadmap 18: Node.js streams',
  'Architect Roadmap 19: GoF design patterns in Node.js',
  'Architect Roadmap 20: Scalability and messaging in Node.js',
  'Architect Roadmap 21: Node.js performance and debugging',
  'Architect Roadmap 22: APIs and data in Node.js services',
  'Architect Roadmap 23: Reliability and security in Node.js',
]
const R3_KEPT_TITLE = 'Architect Roadmap 24: Event-driven architecture fundamentals'
const R4_MIGRATION = 'drizzle/0011_retire-architect-r4.sql'
const R4_RETIRED_TITLES = [
  'Architect Roadmap 24: Event-driven architecture fundamentals',
  'Architect Roadmap 25: Event sourcing and CQRS',
  'Architect Roadmap 27: Messaging platforms',
  'Architect Roadmap 28: Architectural styles and DDD',
  'Architect Roadmap 29: Distributed systems fundamentals',
  'Architect Roadmap 30: Relational databases in depth',
  'Architect Roadmap 31: NoSQL and data modeling',
  'Architect Roadmap 32: Caching at scale',
  'Architect Roadmap 33: Infrastructure as Code and CI/CD',
  'Architect Roadmap 34: Containers and Kubernetes',
  'Architect Roadmap 35: SRE and observability',
  'Architect Roadmap 36: Security architecture',
  'Architect Roadmap 37: Costs and FinOps',
  'Architect Roadmap 38: Quality attributes',
  'Architect Roadmap 39: Documenting the architecture',
  'Architect Roadmap 41: System design case studies',
]
const R4_KEPT_TITLE = 'Architect Roadmap 40: Organization and teams'

async function runMigration(tx: TestTx, file: string) {
  const text = readFileSync(join(process.cwd(), file), 'utf8')
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

async function insertPath(tx: TestTx, quizIds: string[], authorId = SEED_AUTHOR_ID) {
  const [path] = await tx
    .insert(paths)
    .values({
      slug: `path-${crypto.randomUUID()}`,
      authorId,
      title: PATH_TITLE,
      language: 'en',
    })
    .returning({ id: paths.id })
  await tx
    .insert(pathSteps)
    .values(quizIds.map((quizId, index) => ({ pathId: path.id, quizId, position: index + 1 })))
  return path.id
}

async function arrange(tx: TestTx, retiredTitles: string[], keptTitle: string) {
  await insertSeedAuthor(tx)
  const retired = []
  for (const title of retiredTitles) retired.push(await insertQuiz(tx, SEED_AUTHOR_ID, title))
  const first = await insertAttempt(tx, retired[0])
  await insertAttempt(tx, retired[0], first)
  const kept = await insertQuiz(tx, SEED_AUTHOR_ID, keptTitle)
  const keptAttemptId = await insertAttempt(tx, kept)
  const pathId = await insertPath(tx, [retired[0].quizId, kept.quizId])
  const otherUser = await insertUser(tx)
  const foreign = await insertQuiz(tx, otherUser, retiredTitles[0])
  return { retired, kept, keptAttemptId, pathId, foreign, otherUser }
}

describe('0008 retire architect R1', () => {
  it('deletes the seed quizzes 01-06 with their questions and attempts', async () => {
    await withTestDb(async (tx) => {
      const { retired } = await arrange(tx, R1_RETIRED_TITLES, R1_KEPT_TITLE)
      await runMigration(tx, R1_MIGRATION)

      const quizIds = retired.map((quiz) => quiz.quizId)
      const remaining = await tx
        .select({ id: quizzes.id })
        .from(quizzes)
        .where(and(eq(quizzes.authorId, SEED_AUTHOR_ID), inArray(quizzes.title, R1_RETIRED_TITLES)))
      expect(remaining).toEqual([])
      expect(await tx.select().from(questions).where(inArray(questions.quizId, quizIds))).toEqual(
        [],
      )
      expect(await tx.select().from(attempts).where(inArray(attempts.quizId, quizIds))).toEqual([])
    })
  })

  it('deletes the seed path and its steps', async () => {
    await withTestDb(async (tx) => {
      const { pathId } = await arrange(tx, R1_RETIRED_TITLES, R1_KEPT_TITLE)
      await runMigration(tx, R1_MIGRATION)

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
      const { foreign } = await arrange(tx, R1_RETIRED_TITLES, R1_KEPT_TITLE)
      await runMigration(tx, R1_MIGRATION)

      const [quiz] = await tx.select().from(quizzes).where(eq(quizzes.id, foreign.quizId))
      expect(quiz?.title).toBe(R1_RETIRED_TITLES[0])
    })
  })

  it("keeps another user's path with the retired title", async () => {
    await withTestDb(async (tx) => {
      const { kept, otherUser } = await arrange(tx, R1_RETIRED_TITLES, R1_KEPT_TITLE)
      const foreignPathId = await insertPath(tx, [kept.quizId], otherUser)
      await runMigration(tx, R1_MIGRATION)

      const [path] = await tx.select().from(paths).where(eq(paths.id, foreignPathId))
      expect(path?.title).toBe(PATH_TITLE)
    })
  })

  it('keeps seed quiz 07 and its attempt', async () => {
    await withTestDb(async (tx) => {
      const { kept, keptAttemptId } = await arrange(tx, R1_RETIRED_TITLES, R1_KEPT_TITLE)
      await runMigration(tx, R1_MIGRATION)

      const [quiz] = await tx.select().from(quizzes).where(eq(quizzes.id, kept.quizId))
      expect(quiz?.title).toBe(R1_KEPT_TITLE)
      const [attempt] = await tx.select().from(attempts).where(eq(attempts.id, keptAttemptId))
      expect(attempt?.quizId).toBe(kept.quizId)
    })
  })

  it('runs cleanly when there is nothing to retire', async () => {
    await withTestDb(async (tx) => {
      await expect(runMigration(tx, R1_MIGRATION)).resolves.toBeUndefined()
    })
  })
})

describe('0009 retire architect R2', () => {
  it('deletes the seed quizzes 07-13 and 15 with their questions and attempts, and the seed path with its steps', async () => {
    await withTestDb(async (tx) => {
      const { retired, pathId } = await arrange(tx, R2_RETIRED_TITLES, R2_KEPT_TITLE)
      await runMigration(tx, R2_MIGRATION)

      const quizIds = retired.map((quiz) => quiz.quizId)
      const remaining = await tx
        .select({ id: quizzes.id })
        .from(quizzes)
        .where(and(eq(quizzes.authorId, SEED_AUTHOR_ID), inArray(quizzes.title, R2_RETIRED_TITLES)))
      expect(remaining).toEqual([])
      expect(await tx.select().from(questions).where(inArray(questions.quizId, quizIds))).toEqual(
        [],
      )
      expect(await tx.select().from(attempts).where(inArray(attempts.quizId, quizIds))).toEqual([])
      const remainingPaths = await tx
        .select({ id: paths.id })
        .from(paths)
        .where(and(eq(paths.authorId, SEED_AUTHOR_ID), eq(paths.title, PATH_TITLE)))
      expect(remainingPaths).toEqual([])
      expect(await tx.select().from(pathSteps).where(eq(pathSteps.pathId, pathId))).toEqual([])
    })
  })

  it('keeps seed quiz 14 and its attempt', async () => {
    await withTestDb(async (tx) => {
      const { kept, keptAttemptId } = await arrange(tx, R2_RETIRED_TITLES, R2_KEPT_TITLE)
      await runMigration(tx, R2_MIGRATION)

      const [quiz] = await tx.select().from(quizzes).where(eq(quizzes.id, kept.quizId))
      expect(quiz?.title).toBe(R2_KEPT_TITLE)
      const [attempt] = await tx.select().from(attempts).where(eq(attempts.id, keptAttemptId))
      expect(attempt?.quizId).toBe(kept.quizId)
    })
  })

  it("keeps another user's quiz with a retired title", async () => {
    await withTestDb(async (tx) => {
      const { foreign } = await arrange(tx, R2_RETIRED_TITLES, R2_KEPT_TITLE)
      await runMigration(tx, R2_MIGRATION)

      const [quiz] = await tx.select().from(quizzes).where(eq(quizzes.id, foreign.quizId))
      expect(quiz?.title).toBe(R2_RETIRED_TITLES[0])
    })
  })

  it("keeps another user's path with the retired title", async () => {
    await withTestDb(async (tx) => {
      const { kept, otherUser } = await arrange(tx, R2_RETIRED_TITLES, R2_KEPT_TITLE)
      const foreignPathId = await insertPath(tx, [kept.quizId], otherUser)
      await runMigration(tx, R2_MIGRATION)

      const [path] = await tx.select().from(paths).where(eq(paths.id, foreignPathId))
      expect(path?.title).toBe(PATH_TITLE)
    })
  })

  it('runs cleanly when there is nothing to retire', async () => {
    await withTestDb(async (tx) => {
      await expect(runMigration(tx, R2_MIGRATION)).resolves.toBeUndefined()
    })
  })
})

describe('0010 retire architect R3', () => {
  it('deletes the seed quizzes 16-23 with their questions and attempts, and the seed path with its steps', async () => {
    await withTestDb(async (tx) => {
      const { retired, pathId } = await arrange(tx, R3_RETIRED_TITLES, R3_KEPT_TITLE)
      await runMigration(tx, R3_MIGRATION)

      const quizIds = retired.map((quiz) => quiz.quizId)
      const remaining = await tx
        .select({ id: quizzes.id })
        .from(quizzes)
        .where(and(eq(quizzes.authorId, SEED_AUTHOR_ID), inArray(quizzes.title, R3_RETIRED_TITLES)))
      expect(remaining).toEqual([])
      expect(await tx.select().from(questions).where(inArray(questions.quizId, quizIds))).toEqual(
        [],
      )
      expect(await tx.select().from(attempts).where(inArray(attempts.quizId, quizIds))).toEqual([])
      const remainingPaths = await tx
        .select({ id: paths.id })
        .from(paths)
        .where(and(eq(paths.authorId, SEED_AUTHOR_ID), eq(paths.title, PATH_TITLE)))
      expect(remainingPaths).toEqual([])
      expect(await tx.select().from(pathSteps).where(eq(pathSteps.pathId, pathId))).toEqual([])
    })
  })

  it('keeps seed quiz 24 and its attempt', async () => {
    await withTestDb(async (tx) => {
      const { kept, keptAttemptId } = await arrange(tx, R3_RETIRED_TITLES, R3_KEPT_TITLE)
      await runMigration(tx, R3_MIGRATION)

      const [quiz] = await tx.select().from(quizzes).where(eq(quizzes.id, kept.quizId))
      expect(quiz?.title).toBe(R3_KEPT_TITLE)
      const [attempt] = await tx.select().from(attempts).where(eq(attempts.id, keptAttemptId))
      expect(attempt?.quizId).toBe(kept.quizId)
    })
  })

  it("keeps another user's quiz with a retired title", async () => {
    await withTestDb(async (tx) => {
      const { foreign } = await arrange(tx, R3_RETIRED_TITLES, R3_KEPT_TITLE)
      await runMigration(tx, R3_MIGRATION)

      const [quiz] = await tx.select().from(quizzes).where(eq(quizzes.id, foreign.quizId))
      expect(quiz?.title).toBe(R3_RETIRED_TITLES[0])
    })
  })

  it("keeps another user's path with the retired title", async () => {
    await withTestDb(async (tx) => {
      const { kept, otherUser } = await arrange(tx, R3_RETIRED_TITLES, R3_KEPT_TITLE)
      const foreignPathId = await insertPath(tx, [kept.quizId], otherUser)
      await runMigration(tx, R3_MIGRATION)

      const [path] = await tx.select().from(paths).where(eq(paths.id, foreignPathId))
      expect(path?.title).toBe(PATH_TITLE)
    })
  })

  it('runs cleanly when there is nothing to retire', async () => {
    await withTestDb(async (tx) => {
      await expect(runMigration(tx, R3_MIGRATION)).resolves.toBeUndefined()
    })
  })
})

describe('0011 retire architect R4', () => {
  it('deletes the seed quizzes 24-39 and 41 (all but 26 and 40) with their questions and attempts, and the seed path with its steps', async () => {
    await withTestDb(async (tx) => {
      const { retired, pathId } = await arrange(tx, R4_RETIRED_TITLES, R4_KEPT_TITLE)
      await runMigration(tx, R4_MIGRATION)

      const quizIds = retired.map((quiz) => quiz.quizId)
      const remaining = await tx
        .select({ id: quizzes.id })
        .from(quizzes)
        .where(and(eq(quizzes.authorId, SEED_AUTHOR_ID), inArray(quizzes.title, R4_RETIRED_TITLES)))
      expect(remaining).toEqual([])
      expect(await tx.select().from(questions).where(inArray(questions.quizId, quizIds))).toEqual(
        [],
      )
      expect(await tx.select().from(attempts).where(inArray(attempts.quizId, quizIds))).toEqual([])
      const remainingPaths = await tx
        .select({ id: paths.id })
        .from(paths)
        .where(and(eq(paths.authorId, SEED_AUTHOR_ID), eq(paths.title, PATH_TITLE)))
      expect(remainingPaths).toEqual([])
      expect(await tx.select().from(pathSteps).where(eq(pathSteps.pathId, pathId))).toEqual([])
    })
  })

  it('keeps seed quiz 40 and its attempt', async () => {
    await withTestDb(async (tx) => {
      const { kept, keptAttemptId } = await arrange(tx, R4_RETIRED_TITLES, R4_KEPT_TITLE)
      await runMigration(tx, R4_MIGRATION)

      const [quiz] = await tx.select().from(quizzes).where(eq(quizzes.id, kept.quizId))
      expect(quiz?.title).toBe(R4_KEPT_TITLE)
      const [attempt] = await tx.select().from(attempts).where(eq(attempts.id, keptAttemptId))
      expect(attempt?.quizId).toBe(kept.quizId)
    })
  })

  it("keeps another user's quiz with a retired title", async () => {
    await withTestDb(async (tx) => {
      const { foreign } = await arrange(tx, R4_RETIRED_TITLES, R4_KEPT_TITLE)
      await runMigration(tx, R4_MIGRATION)

      const [quiz] = await tx.select().from(quizzes).where(eq(quizzes.id, foreign.quizId))
      expect(quiz?.title).toBe(R4_RETIRED_TITLES[0])
    })
  })

  it("keeps another user's path with the retired title", async () => {
    await withTestDb(async (tx) => {
      const { kept, otherUser } = await arrange(tx, R4_RETIRED_TITLES, R4_KEPT_TITLE)
      const foreignPathId = await insertPath(tx, [kept.quizId], otherUser)
      await runMigration(tx, R4_MIGRATION)

      const [path] = await tx.select().from(paths).where(eq(paths.id, foreignPathId))
      expect(path?.title).toBe(PATH_TITLE)
    })
  })

  it('runs cleanly when there is nothing to retire', async () => {
    await withTestDb(async (tx) => {
      await expect(runMigration(tx, R4_MIGRATION)).resolves.toBeUndefined()
    })
  })
})
