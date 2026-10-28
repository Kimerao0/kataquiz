import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { quizzes, user } from '@/db/schema'
import { type TestTx, withTestDb } from '@/test/db'
import { SEED_AUTHOR_ID, seedQuizzes } from './seed'

const createdDirs: string[] = []

// Fixtures, never the real `seeds/`: what those files contain is somebody
// else's decision and must not decide whether this suite passes.
function fixtureDir(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'kataquiz-seed-'))
  createdDirs.push(dir)
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content)
  }
  return dir
}

function quizYaml(title: string): string {
  return `version: 1
title: ${title}
language: en
run:
  questionsPerRun: 1
  maxErrors: 0
questions:
  - type: boolean
    prompt: A seeded quiz is imported once.
    answer: true
  - type: single
    prompt: What does the seeder do with a file it has already imported?
    options:
      - { text: Skips it, correct: true }
      - { text: Imports it again, correct: false }
`
}

function quizJson(title: string): string {
  return JSON.stringify({
    version: 1,
    title,
    language: 'en',
    run: { questionsPerRun: 1, maxErrors: 0 },
    questions: [
      {
        type: 'single',
        prompt: 'Which file extensions does the seeder read?',
        options: [
          { text: '.yaml, .yml and .json', correct: true },
          { text: '.yaml only', correct: false },
        ],
      },
    ],
  })
}

// A single-option question: the schema rejects it, so the file never parses.
const INVALID_YAML = `version: 1
title: Seed Fixture Broken
language: en
run:
  questionsPerRun: 1
  maxErrors: 0
questions:
  - type: single
    prompt: A question with one option is not valid.
    options:
      - { text: Alone, correct: true }
`

function seededQuizzes(tx: TestTx) {
  return tx
    .select({ title: quizzes.title })
    .from(quizzes)
    .where(eq(quizzes.authorId, SEED_AUTHOR_ID))
    .orderBy(quizzes.title)
}

async function findSeedAuthor(tx: TestTx) {
  const [author] = await tx.select().from(user).where(eq(user.id, SEED_AUTHOR_ID))
  return author
}

afterAll(() => {
  for (const dir of createdDirs) rmSync(dir, { recursive: true, force: true })
})

describe('seedQuizzes', () => {
  it('imports every quiz file in the directory', async () => {
    await withTestDb(async (tx) => {
      const dir = fixtureDir({
        'alpha.yaml': quizYaml('Seed Fixture Alpha'),
        'beta.yml': quizYaml('Seed Fixture Beta'),
        'gamma.json': quizJson('Seed Fixture Gamma'),
      })

      const outcomes = await seedQuizzes({ dir, executor: tx })

      expect(outcomes.map((outcome) => outcome.status)).toEqual([
        'imported',
        'imported',
        'imported',
      ])
      expect(await seededQuizzes(tx)).toEqual([
        { title: 'Seed Fixture Alpha' },
        { title: 'Seed Fixture Beta' },
        { title: 'Seed Fixture Gamma' },
      ])
    })
  })

  it('creates the seed author when absent', async () => {
    await withTestDb(async (tx) => {
      const dir = fixtureDir({ 'alpha.yaml': quizYaml('Seed Fixture Alpha') })
      expect(await findSeedAuthor(tx)).toBeUndefined()

      await seedQuizzes({ dir, executor: tx })

      const author = await findSeedAuthor(tx)
      expect(author?.name).toBe('Kataquiz Seeds')
      // Non-routable on purpose: nobody can be mailed at it, by us or by anyone.
      expect(author?.email).toMatch(/@seed\.invalid$/)
    })
  })

  it('reuses the seed author on a second run', async () => {
    await withTestDb(async (tx) => {
      const dir = fixtureDir({ 'alpha.yaml': quizYaml('Seed Fixture Alpha') })

      await seedQuizzes({ dir, executor: tx })
      await seedQuizzes({ dir, executor: tx })

      // A second insert of the same email would have thrown on the unique
      // constraint long before this assertion.
      expect(await tx.select().from(user).where(eq(user.id, SEED_AUTHOR_ID))).toHaveLength(1)
    })
  })

  it('is idempotent: a second run imports nothing and reports every file skipped', async () => {
    await withTestDb(async (tx) => {
      const dir = fixtureDir({
        'alpha.yaml': quizYaml('Seed Fixture Alpha'),
        'beta.yml': quizYaml('Seed Fixture Beta'),
      })
      await seedQuizzes({ dir, executor: tx })
      const afterFirstRun = await seededQuizzes(tx)
      expect(afterFirstRun).toHaveLength(2)

      const outcomes = await seedQuizzes({ dir, executor: tx })

      expect(outcomes.map((outcome) => outcome.status)).toEqual(['skipped', 'skipped'])
      expect(await seededQuizzes(tx)).toEqual(afterFirstRun)
    })
  })

  it('skips a file that fails validation and still imports the rest', async () => {
    await withTestDb(async (tx) => {
      const dir = fixtureDir({
        'broken.yaml': INVALID_YAML,
        'valid.yaml': quizYaml('Seed Fixture Valid'),
      })

      const outcomes = await seedQuizzes({ dir, executor: tx })

      expect(outcomes).toEqual([
        expect.objectContaining({ file: 'broken.yaml', status: 'skipped' }),
        expect.objectContaining({ file: 'valid.yaml', status: 'imported' }),
      ])
      expect(await seededQuizzes(tx)).toEqual([{ title: 'Seed Fixture Valid' }])
    })
  })

  it('reports the parse errors for a skipped file', async () => {
    await withTestDb(async (tx) => {
      const dir = fixtureDir({ 'broken.yaml': INVALID_YAML })

      const [outcome] = await seedQuizzes({ dir, executor: tx })

      expect(outcome.status).toBe('skipped')
      expect(outcome.reason).toContain('must have between 2 and 10 options')
    })
  })

  it('returns one outcome per file', async () => {
    await withTestDb(async (tx) => {
      const dir = fixtureDir({
        'alpha.yaml': quizYaml('Seed Fixture Alpha'),
        'beta.yml': quizYaml('Seed Fixture Beta'),
        'gamma.json': quizJson('Seed Fixture Gamma'),
      })

      const outcomes = await seedQuizzes({ dir, executor: tx })

      expect(outcomes.map((outcome) => outcome.file)).toEqual([
        'alpha.yaml',
        'beta.yml',
        'gamma.json',
      ])
    })
  })

  it('imports nothing from an empty directory', async () => {
    await withTestDb(async (tx) => {
      const outcomes = await seedQuizzes({ dir: fixtureDir({}), executor: tx })

      expect(outcomes).toEqual([])
    })
  })
})
