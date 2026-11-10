import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { and, eq } from 'drizzle-orm'
import type { NodePgQueryResultHKT } from 'drizzle-orm/node-postgres'
import type { PgDatabase } from 'drizzle-orm/pg-core'
import { type Db, db } from '@/db/client'
import { paths, quizzes, user } from '@/db/schema'
import { isPathText, parsePathText } from '@/lib/paths/file'
import { importPath, PathStepError } from '@/lib/paths/import'
import { parseQuizText } from '@/lib/quiz-schema'
import { importQuiz } from './import'
import { SEED_AUTHOR_ID } from './seed-author'

export { SEED_AUTHOR_ID } from './seed-author'

// The reason a re-run gives, as opposed to the one a broken file gives: only
// the second kind is a failure, and the caller has to tell them apart.
export const ALREADY_IMPORTED = 'already imported'

const SEED_AUTHOR_NAME = 'Kataquiz Seeds'
// .invalid is a reserved TLD (RFC 2606): the address can never receive mail,
// so it cannot collide with a real account nor be mistaken for a contact.
const SEED_AUTHOR_EMAIL = 'seeds@seed.invalid'
const DEFAULT_DIR = 'seeds'
const QUIZ_EXTENSIONS = ['.yaml', '.yml', '.json']

// The base class of both `db` and a transaction, so tests can seed inside the
// rollback harness.
type Executor = PgDatabase<NodePgQueryResultHKT, Db['_']['fullSchema']>

export type SeedOutcome = {
  file: string
  status: 'imported' | 'skipped'
  slug?: string
  reason?: string
  kind?: 'path'
}

export async function seedQuizzes(params: {
  dir?: string
  executor?: Executor
}): Promise<SeedOutcome[]> {
  const { dir = DEFAULT_DIR, executor } = params
  await ensureSeedAuthor(executor)

  const files = readdirSync(dir)
    .filter((file) => QUIZ_EXTENSIONS.some((extension) => file.endsWith(extension)))
    .sort()

  const texts = new Map(files.map((file) => [file, readFileSync(join(dir, file), 'utf8')]))
  const pathFiles = files.filter((file) => isPathText(texts.get(file) ?? ''))
  const quizFiles = files.filter((file) => !pathFiles.includes(file))

  const outcomes: SeedOutcome[] = []
  // One file at a time: they share an executor, and a transaction cannot run
  // two statements at once. Quizzes first: paths name them.
  for (const file of quizFiles) {
    outcomes.push(await seedFile(file, texts.get(file) ?? '', executor))
  }
  for (const file of pathFiles) {
    outcomes.push(await seedPathFile(file, texts.get(file) ?? '', executor))
  }
  return outcomes
}

async function ensureSeedAuthor(executor?: Executor): Promise<void> {
  await (executor ?? db)
    .insert(user)
    .values({ id: SEED_AUTHOR_ID, name: SEED_AUTHOR_NAME, email: SEED_AUTHOR_EMAIL })
    // Covers the id and the unique email alike, so a second run is a no-op
    // rather than a crash.
    .onConflictDoNothing()
}

async function seedFile(file: string, text: string, executor?: Executor): Promise<SeedOutcome> {
  const parsed = parseQuizText(text)
  // One unparseable file must not cost the catalog all the others.
  if (!parsed.ok) return { file, status: 'skipped', reason: parsed.errors.join('; ') }

  // Slugs carry a random suffix, so the title under the seed author is the only
  // identity a re-run can recognise the quiz by.
  const [existing] = await (executor ?? db)
    .select({ slug: quizzes.slug })
    .from(quizzes)
    .where(and(eq(quizzes.title, parsed.data.title), eq(quizzes.authorId, SEED_AUTHOR_ID)))
    .limit(1)
  if (existing) return { file, status: 'skipped', slug: existing.slug, reason: ALREADY_IMPORTED }

  // `executor` is forwarded undefined and all: importQuiz then opens its own
  // transaction, which is what keeps one quiz's three inserts atomic.
  const { slug } = await importQuiz({ file: parsed.data, authorId: SEED_AUTHOR_ID, executor })
  return { file, status: 'imported', slug }
}

async function seedPathFile(file: string, text: string, executor?: Executor): Promise<SeedOutcome> {
  const parsed = parsePathText(text)
  if (!parsed.ok) return { file, status: 'skipped', kind: 'path', reason: parsed.errors.join('; ') }

  const [existing] = await (executor ?? db)
    .select({ slug: paths.slug })
    .from(paths)
    .where(and(eq(paths.title, parsed.data.title), eq(paths.authorId, SEED_AUTHOR_ID)))
    .limit(1)
  if (existing) {
    return { file, status: 'skipped', kind: 'path', slug: existing.slug, reason: ALREADY_IMPORTED }
  }

  try {
    const { slug } = await importPath({
      file: parsed.data,
      authorId: SEED_AUTHOR_ID,
      resolveBy: 'seedTitle',
      executor,
    })
    return { file, status: 'imported', kind: 'path', slug }
  } catch (error) {
    if (error instanceof PathStepError) {
      return { file, status: 'skipped', kind: 'path', reason: error.message }
    }
    throw error
  }
}
