import { and, arrayContains, desc, eq, type SQL, sql } from 'drizzle-orm'
import type { NodePgQueryResultHKT } from 'drizzle-orm/node-postgres'
import type { PgDatabase } from 'drizzle-orm/pg-core'
import { type Db, db } from '@/db/client'
import { questions, quizzes, user } from '@/db/schema'

export const PAGE_SIZE = 20

const POPULAR_TAGS_LIMIT = 20

// The base class of both `db` and a transaction, so tests can read through the
// rollback harness.
type Executor = PgDatabase<NodePgQueryResultHKT, Db['_']['fullSchema']>

export type QuizSummary = {
  id: string
  slug: string
  title: string
  description: string | null
  tags: string[]
  questionCount: number
  questionsPerRun: number
  maxErrors: number
  timePerQuestionSec: number | null
  // Null once the author deletes their account: the quiz survives, the link does
  // not. Every read below therefore joins `user` on the left.
  authorName: string | null
  createdAt: Date
}

// Correlated rather than joined, so a quiz with no questions still reports 0.
const questionCount = sql<number>`(
  select count(*) from ${questions} where ${questions.quizId} = ${quizzes.id}
)`.mapWith(Number)

const summaryFields = {
  id: quizzes.id,
  slug: quizzes.slug,
  title: quizzes.title,
  description: quizzes.description,
  tags: quizzes.tags,
  questionCount,
  questionsPerRun: quizzes.questionsPerRun,
  maxErrors: quizzes.maxErrors,
  timePerQuestionSec: quizzes.timePerQuestionSec,
  authorName: user.name,
  createdAt: quizzes.createdAt,
}

export async function searchQuizzes(params: {
  q?: string
  tag?: string
  page?: number
  executor?: Executor
}): Promise<{ items: QuizSummary[]; total: number }> {
  const { q, tag, page = 1, executor = db } = params
  const words = q?.trim()
  // An empty box means "show everything", not a search for the empty string.
  const query = words ? sql`websearch_to_tsquery('simple', ${words})` : null

  // Hidden is not a filter the caller can turn off: an admin-hidden quiz has to
  // be unreachable by search, by tag and by its own URL alike.
  const filters: SQL[] = [eq(quizzes.isHidden, false)]
  if (query) filters.push(sql`${quizzes.searchVector} @@ ${query}`)
  if (tag) filters.push(arrayContains(quizzes.tags, [tag]))
  const where = and(...filters)

  const orderBy = query
    ? [desc(sql`ts_rank(${quizzes.searchVector}, ${query})`), desc(quizzes.createdAt)]
    : [desc(quizzes.createdAt)]

  const [counted] = await executor
    .select({ total: sql<number>`count(*)`.mapWith(Number) })
    .from(quizzes)
    .where(where)

  const items = await executor
    .select(summaryFields)
    .from(quizzes)
    // Left, not inner: an orphaned quiz would otherwise drop out of the catalog
    // entirely, and the count above already includes it.
    .leftJoin(user, eq(quizzes.authorId, user.id))
    .where(where)
    .orderBy(...orderBy)
    .limit(PAGE_SIZE)
    .offset((Math.max(page, 1) - 1) * PAGE_SIZE)

  return { items, total: counted.total }
}

export async function getQuizBySlug(
  slug: string,
  executor: Executor = db,
): Promise<QuizSummary | null> {
  const [quiz] = await executor
    .select(summaryFields)
    .from(quizzes)
    // Left, as above: an orphaned quiz still has a page.
    .leftJoin(user, eq(quizzes.authorId, user.id))
    .where(and(eq(quizzes.slug, slug), eq(quizzes.isHidden, false)))
    .limit(1)

  return quiz ?? null
}

export async function listPopularTags(
  limit = POPULAR_TAGS_LIMIT,
  executor: Executor = db,
): Promise<string[]> {
  // unnest belongs in the FROM clause, which the query builder cannot express.
  const result = await executor.execute<{ tag: string }>(sql`
    select tag
    from ${quizzes}, unnest(${quizzes.tags}) as tag
    where ${quizzes.isHidden} = false
    group by tag
    order by count(*) desc, tag asc
    limit ${limit}
  `)

  return result.rows.map((row) => row.tag)
}
