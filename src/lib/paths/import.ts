import { and, eq, inArray } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { db } from '@/db/client'
import { pathSteps, paths, quizzes } from '@/db/schema'
import { type Executor, SLUG_SUFFIX_LENGTH, slugify } from '@/lib/quizzes/import'
import { SEED_AUTHOR_ID } from '@/lib/quizzes/seed'
import type { PathFile, PathStepRef } from './file'

type ResolveBy = 'slug' | 'seedTitle'

// `step` is 1-based, matching the parser's duplicate error; Zod's `steps.<n>`
// paths stay 0-based.
export class PathStepError extends Error {
  readonly step: number

  constructor(step: number, reason: string) {
    super(`step ${step}: ${reason}`)
    this.name = 'PathStepError'
    this.step = step
  }
}

export async function importPath(params: {
  file: PathFile
  authorId: string
  resolveBy: ResolveBy
  executor?: Executor
}): Promise<{ pathId: string; slug: string }> {
  const { file, authorId, resolveBy, executor } = params
  const slug = `${slugify(file.title)}-${nanoid(SLUG_SUFFIX_LENGTH)}`

  // A caller that passes an executor owns the transaction boundary: opening a
  // second one here would only be a savepoint, which rolls back without the
  // outer caller ever learning the import failed.
  if (!executor) return db.transaction((tx) => insertPath(tx, file, authorId, resolveBy, slug))
  return insertPath(executor, file, authorId, resolveBy, slug)
}

async function insertPath(
  executor: Executor,
  file: PathFile,
  authorId: string,
  resolveBy: ResolveBy,
  slug: string,
): Promise<{ pathId: string; slug: string }> {
  // Resolved before any insert: with a caller-owned transaction nothing rolls
  // a half-written path back.
  const quizIds = await resolveSteps(executor, file.steps, resolveBy)

  const [path] = await executor
    .insert(paths)
    .values({
      slug,
      authorId,
      title: file.title,
      description: file.description,
      language: file.language,
    })
    .returning({ id: paths.id })

  await executor
    .insert(pathSteps)
    .values(quizIds.map((quizId, index) => ({ pathId: path.id, quizId, position: index + 1 })))

  return { pathId: path.id, slug }
}

async function resolveSteps(
  executor: Executor,
  steps: PathStepRef[],
  resolveBy: ResolveBy,
): Promise<string[]> {
  const keys = steps.map((step, index) => stepKey(step, index + 1, resolveBy))
  const live = await liveQuizIds(executor, keys, resolveBy)

  const firstStepOf = new Map<string, number>()
  return keys.map((key, index) => {
    const step = index + 1
    const quizId = live.get(key)
    if (quizId === undefined) throw new PathStepError(step, missingReason(key, resolveBy))

    // The parser only compares step text, so two different refs can still
    // name one quiz.
    const first = firstStepOf.get(quizId)
    if (first !== undefined) throw new PathStepError(step, `names the same quiz as step ${first}`)
    firstStepOf.set(quizId, step)
    return quizId
  })
}

function stepKey(step: PathStepRef, position: number, resolveBy: ResolveBy): string {
  if (resolveBy === 'slug') {
    if ('quiz' in step) return step.quiz
    throw new PathStepError(position, 'name the quiz by its slug with quiz:, not by title')
  }
  if ('title' in step) return step.title
  throw new PathStepError(position, 'seed paths name quizzes by title, not by slug')
}

function missingReason(key: string, resolveBy: ResolveBy): string {
  if (resolveBy === 'slug') return `no public quiz with slug "${key}"`
  return `no seed quiz titled "${key}"`
}

// Key (slug or seed title) to quiz id, live quizzes only, in one query.
async function liveQuizIds(
  executor: Executor,
  keys: string[],
  resolveBy: ResolveBy,
): Promise<Map<string, string>> {
  const rows = await selectLiveQuizzes(executor, keys, resolveBy)
  return new Map(rows.map((row) => [row.key, row.id]))
}

function selectLiveQuizzes(executor: Executor, keys: string[], resolveBy: ResolveBy) {
  if (resolveBy === 'slug') {
    return executor
      .select({ key: quizzes.slug, id: quizzes.id })
      .from(quizzes)
      .where(and(inArray(quizzes.slug, keys), eq(quizzes.isHidden, false)))
  }
  return executor
    .select({ key: quizzes.title, id: quizzes.id })
    .from(quizzes)
    .where(
      and(
        inArray(quizzes.title, keys),
        eq(quizzes.authorId, SEED_AUTHOR_ID),
        eq(quizzes.isHidden, false),
      ),
    )
}
