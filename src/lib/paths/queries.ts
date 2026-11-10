import { and, asc, count, desc, eq, inArray } from 'drizzle-orm'
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

type StepRow = { quizId: string | null; quizSlug: string | null; quizTitle: string | null }

type PathRow = StepRow & {
  id: string
  slug: string
  title: string
  description: string | null
  authorName: string | null
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
function liveSteps(rows: StepRow[]): LiveStep[] {
  const live = rows.filter((row) => row.quizId !== null)

  return live.map((row, index) => ({
    position: index + 1,
    quizId: row.quizId as string,
    quizSlug: row.quizSlug as string,
    quizTitle: row.quizTitle as string,
  }))
}

export type PathCard = { slug: string; title: string; stepCount: number; quizIds: string[] }

export type PathPlacement = {
  pathSlug: string
  pathTitle: string
  position: number
  total: number
  previous: LiveStep | null
  next: LiveStep | null
}

// 3 queries: the count, the page of paths, then the live steps of that page.
export async function listPaths(params: {
  page: number
  pageSize: number
  executor?: Executor
}): Promise<{ items: PathCard[]; total: number }> {
  const { page, pageSize, executor = db } = params

  const [{ value: total }] = await executor
    .select({ value: count() })
    .from(paths)
    .where(eq(paths.isHidden, false))

  const pagePaths = await executor
    .select({ id: paths.id, slug: paths.slug, title: paths.title })
    .from(paths)
    .where(eq(paths.isHidden, false))
    .orderBy(desc(paths.createdAt), asc(paths.id))
    .limit(pageSize)
    .offset((Math.max(page, 1) - 1) * pageSize)

  if (pagePaths.length === 0) return { items: [], total }

  const stepRows = await executor
    .select({
      pathId: pathSteps.pathId,
      quizId: quizzes.id,
      quizSlug: quizzes.slug,
      quizTitle: quizzes.title,
    })
    .from(pathSteps)
    .innerJoin(quizzes, and(eq(quizzes.id, pathSteps.quizId), eq(quizzes.isHidden, false)))
    .where(
      inArray(
        pathSteps.pathId,
        pagePaths.map((path) => path.id),
      ),
    )
    .orderBy(asc(pathSteps.position))

  const items = pagePaths.map((path) => {
    const steps = liveSteps(stepRows.filter((row) => row.pathId === path.id))

    return {
      slug: path.slug,
      title: path.title,
      stepCount: steps.length,
      quizIds: steps.map((step) => step.quizId),
    }
  })

  return { items, total }
}

// 1 query (via getPlacementsForQuizzes).
export async function getPlacements(
  quizId: string,
  executor: Executor = db,
): Promise<PathPlacement[]> {
  const placements = await getPlacementsForQuizzes([quizId], executor)

  return placements.get(quizId) ?? []
}

type PlacementRow = StepRow & { pathId: string; pathSlug: string; pathTitle: string }

// 1 query for any number of quizzes (0 for empty input), grouped in JS. A quiz in no path is absent.
export async function getPlacementsForQuizzes(
  quizIds: string[],
  executor: Executor = db,
): Promise<Map<string, PathPlacement[]>> {
  const result = new Map<string, PathPlacement[]>()
  if (quizIds.length === 0) return result

  const containingPaths = executor
    .select({ pathId: pathSteps.pathId })
    .from(pathSteps)
    .where(inArray(pathSteps.quizId, quizIds))

  const rows = await executor
    .select({
      pathId: paths.id,
      pathSlug: paths.slug,
      pathTitle: paths.title,
      quizId: quizzes.id,
      quizSlug: quizzes.slug,
      quizTitle: quizzes.title,
    })
    .from(paths)
    .innerJoin(pathSteps, eq(pathSteps.pathId, paths.id))
    .innerJoin(quizzes, and(eq(quizzes.id, pathSteps.quizId), eq(quizzes.isHidden, false)))
    .where(and(eq(paths.isHidden, false), inArray(paths.id, containingPaths)))
    .orderBy(desc(paths.createdAt), asc(paths.id), asc(pathSteps.position))

  const wanted = new Set(quizIds)
  for (const pathRows of groupByPath(rows)) {
    addPlacements(result, pathRows, wanted)
  }

  return result
}

// Rows arrive ordered by path, so each group is contiguous and keeps newest-first order.
function groupByPath(rows: PlacementRow[]): PlacementRow[][] {
  const groups = new Map<string, PlacementRow[]>()
  for (const row of rows) {
    const group = groups.get(row.pathId)
    if (group) group.push(row)
    else groups.set(row.pathId, [row])
  }

  return [...groups.values()]
}

function addPlacements(
  result: Map<string, PathPlacement[]>,
  pathRows: PlacementRow[],
  wanted: Set<string>,
) {
  const steps = liveSteps(pathRows)
  const { pathSlug, pathTitle } = pathRows[0]

  steps.forEach((step, index) => {
    if (!wanted.has(step.quizId)) return

    const placement: PathPlacement = {
      pathSlug,
      pathTitle,
      position: step.position,
      total: steps.length,
      previous: steps[index - 1] ?? null,
      next: steps[index + 1] ?? null,
    }
    result.set(step.quizId, [...(result.get(step.quizId) ?? []), placement])
  })
}
