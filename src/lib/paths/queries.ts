import { and, asc, eq } from 'drizzle-orm'
import type { NodePgQueryResultHKT } from 'drizzle-orm/node-postgres'
import type { PgDatabase } from 'drizzle-orm/pg-core'
import { type Db, db } from '@/db/client'
import { pathSteps, paths, quizzes, user } from '@/db/schema'

type Executor = PgDatabase<NodePgQueryResultHKT, Db['_']['fullSchema']>

export type LiveStep = { position: number; quizId: string; quizSlug: string; quizTitle: string }

export type PathDetail = {
  id: string
  slug: string
  title: string
  description: string | null
  authorName: string | null
  steps: LiveStep[]
}

type PathRow = {
  id: string
  slug: string
  title: string
  description: string | null
  authorName: string | null
  quizId: string | null
  quizSlug: string | null
  quizTitle: string | null
}

export async function getPath(slug: string, executor: Executor = db): Promise<PathDetail | null> {
  const rows = await executor
    .select({
      id: paths.id,
      slug: paths.slug,
      title: paths.title,
      description: paths.description,
      authorName: user.name,
      quizId: quizzes.id,
      quizSlug: quizzes.slug,
      quizTitle: quizzes.title,
    })
    .from(paths)
    .leftJoin(user, eq(paths.authorId, user.id))
    .leftJoin(pathSteps, eq(pathSteps.pathId, paths.id))
    // The hidden filter lives in the join so a path whose quizzes are all hidden still comes back.
    .leftJoin(quizzes, and(eq(quizzes.id, pathSteps.quizId), eq(quizzes.isHidden, false)))
    .where(and(eq(paths.slug, slug), eq(paths.isHidden, false)))
    .orderBy(asc(pathSteps.position))

  if (rows.length === 0) return null

  return toDetail(rows)
}

function toDetail(rows: PathRow[]): PathDetail {
  const { id, slug, title, description, authorName } = rows[0]

  return { id, slug, title, description, authorName, steps: liveSteps(rows) }
}

// Positions are renumbered over what is left, so a hidden quiz leaves no gap.
function liveSteps(rows: PathRow[]): LiveStep[] {
  const live = rows.filter((row) => row.quizId !== null)

  return live.map((row, index) => ({
    position: index + 1,
    quizId: row.quizId as string,
    quizSlug: row.quizSlug as string,
    quizTitle: row.quizTitle as string,
  }))
}
