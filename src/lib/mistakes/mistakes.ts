import { and, arrayContains, asc, desc, eq, inArray, type SQL, sql } from 'drizzle-orm'
import type { NodePgQueryResultHKT } from 'drizzle-orm/node-postgres'
import type { PgDatabase } from 'drizzle-orm/pg-core'
import { z } from 'zod'
import { type Db, db } from '@/db/client'
import { attemptAnswers, attempts, options, type Question, questions, quizzes } from '@/db/schema'

// The base class of both `db` and a transaction, so tests can read through the
// rollback harness.
type Executor = PgDatabase<NodePgQueryResultHKT, Db['_']['fullSchema']>

const MAX_TAG_LENGTH = 64

export type MistakeOption = { text: string; isCorrect: boolean }

export type Mistake = {
  questionId: string
  type: Question['type']
  prompt: string
  code: string | null
  codeLanguage: string | null
  imageUrl: string | null
  explanation: string | null
  theoryUrl: string | null
  quiz: { slug: string; title: string; tags: string[] }
  options: MistakeOption[]
  timesWrong: number
  lastWrongAt: Date
}

// The file the aws-flashcards study app reads. Spelled out field by field
// rather than derived from Mistake: it is a published contract, and a column
// added to the query must not leak into it unversioned.
export type MistakesExportV1 = {
  format: 'kataquiz-mistakes'
  version: 1
  exportedAt: string
  tag: string | null
  mistakes: {
    questionId: string
    type: Question['type']
    prompt: string
    code: string | null
    codeLanguage: string | null
    imageUrl: string | null
    options: MistakeOption[]
    explanation: string | null
    theoryUrl: string | null
    quiz: { slug: string; title: string; tags: string[] }
    timesWrong: number
    lastWrongAt: string
  }[]
}

const tagSchema = z.string().trim().min(1).max(MAX_TAG_LENGTH)

// The tag arrives in the query string; anything that is not a plausible tag
// means no filter rather than an error.
export function parseMistakesTag(value: unknown): string | null {
  const parsed = tagSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

// A wrong answer the player gave signed in, on a quiz still listed. Guest runs
// never count: their attempts carry no user id. Expects attempt_answers joined
// to attempts and quizzes.
function wrongAnswersOf(userId: string): SQL {
  return sql`${eq(attempts.userId, userId)}
    and ${eq(attemptAnswers.isCorrect, false)}
    and ${eq(quizzes.isHidden, false)}`
}

// What the page lists: no options, so no second query and no answers sent to
// a page that must not show them.
export type MistakeSummary = {
  questionId: string
  prompt: string
  quizTitle: string
  timesWrong: number
  lastWrongAt: Date
}

type MistakeFilter = { tag: string | null }

// One row per question the player got wrong, most recent mistake first. Shared
// by the page and the export so the two can never disagree on what counts.
async function getWrongQuestionRows(userId: string, filter: MistakeFilter, executor: Executor) {
  const lastWrongAt = sql<Date>`max(${attemptAnswers.answeredAt})`.mapWith(
    attemptAnswers.answeredAt,
  )
  const tagFilter = filter.tag ? arrayContains(quizzes.tags, [filter.tag]) : undefined
  return executor
    .select({
      questionId: questions.id,
      type: questions.type,
      prompt: questions.prompt,
      code: questions.code,
      codeLanguage: questions.codeLanguage,
      imageUrl: questions.imageUrl,
      explanation: questions.explanation,
      theoryUrl: questions.theoryUrl,
      quizSlug: quizzes.slug,
      quizTitle: quizzes.title,
      quizTags: quizzes.tags,
      timesWrong: sql<number>`count(${attemptAnswers.id})`.mapWith(Number),
      lastWrongAt,
    })
    .from(attemptAnswers)
    .innerJoin(attempts, eq(attempts.id, attemptAnswers.attemptId))
    .innerJoin(questions, eq(questions.id, attemptAnswers.questionId))
    .innerJoin(quizzes, eq(quizzes.id, questions.quizId))
    .where(and(wrongAnswersOf(userId), tagFilter))
    .groupBy(questions.id, quizzes.id)
    .orderBy(desc(lastWrongAt), asc(questions.id))
}

export async function getMistakeSummaries(
  userId: string,
  filter: MistakeFilter,
  executor: Executor = db,
): Promise<MistakeSummary[]> {
  const rows = await getWrongQuestionRows(userId, filter, executor)
  return rows.map((row) => ({
    questionId: row.questionId,
    prompt: row.prompt,
    quizTitle: row.quizTitle,
    timesWrong: row.timesWrong,
    lastWrongAt: row.lastWrongAt,
  }))
}

export async function getMistakes(
  userId: string,
  filter: MistakeFilter,
  executor: Executor = db,
): Promise<Mistake[]> {
  const rows = await getWrongQuestionRows(userId, filter, executor)
  const optionsByQuestion = await getOptions(
    rows.map((row) => row.questionId),
    executor,
  )

  return rows.map(({ quizSlug, quizTitle, quizTags, ...row }) => ({
    ...row,
    quiz: { slug: quizSlug, title: quizTitle, tags: quizTags },
    options: optionsByQuestion.get(row.questionId) ?? [],
  }))
}

async function getOptions(
  questionIds: string[],
  executor: Executor,
): Promise<Map<string, MistakeOption[]>> {
  const byQuestion = new Map<string, MistakeOption[]>()
  if (questionIds.length === 0) return byQuestion

  // One inArray is fine at current sizes, but Postgres caps a statement at 65535 params.
  const rows = await executor
    .select({ questionId: options.questionId, text: options.text, isCorrect: options.isCorrect })
    .from(options)
    .where(inArray(options.questionId, questionIds))
    .orderBy(asc(options.questionId), asc(options.position))

  for (const { questionId, ...option } of rows) {
    const list = byQuestion.get(questionId) ?? []
    list.push(option)
    byQuestion.set(questionId, list)
  }
  return byQuestion
}

export async function getMistakeTags(userId: string, executor: Executor = db): Promise<string[]> {
  // unnest belongs in the FROM clause, which the query builder cannot express.
  const result = await executor.execute<{ tag: string }>(sql`
    select distinct tag
    from ${attemptAnswers}
    inner join ${attempts} on ${attempts.id} = ${attemptAnswers.attemptId}
    inner join ${questions} on ${questions.id} = ${attemptAnswers.questionId}
    inner join ${quizzes} on ${quizzes.id} = ${questions.quizId}
    cross join unnest(${quizzes.tags}) as tag
    where ${wrongAnswersOf(userId)}
    order by tag asc
  `)

  return result.rows.map((row) => row.tag)
}

export function toMistakesExport(
  mistakes: Mistake[],
  tag: string | null,
  now: Date,
): MistakesExportV1 {
  return {
    format: 'kataquiz-mistakes',
    version: 1,
    exportedAt: now.toISOString(),
    tag,
    mistakes: mistakes.map((mistake) => ({
      questionId: mistake.questionId,
      type: mistake.type,
      prompt: mistake.prompt,
      code: mistake.code,
      codeLanguage: mistake.codeLanguage,
      imageUrl: mistake.imageUrl,
      options: mistake.options.map(({ text, isCorrect }) => ({ text, isCorrect })),
      explanation: mistake.explanation,
      theoryUrl: mistake.theoryUrl,
      quiz: { slug: mistake.quiz.slug, title: mistake.quiz.title, tags: mistake.quiz.tags },
      timesWrong: mistake.timesWrong,
      lastWrongAt: mistake.lastWrongAt.toISOString(),
    })),
  }
}
