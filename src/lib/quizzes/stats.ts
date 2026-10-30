import { eq, sql } from 'drizzle-orm'
import type { NodePgQueryResultHKT } from 'drizzle-orm/node-postgres'
import type { PgDatabase } from 'drizzle-orm/pg-core'
import { type Db, db } from '@/db/client'
import { attemptAnswers, options, questions } from '@/db/schema'

// Below this many answers a percentage is noise: one unlucky player would put
// a question at the top of the list.
export const MIN_ANSWERS = 5

// The base class of both `db` and a transaction, so tests can read through the
// rollback harness.
type Executor = PgDatabase<NodePgQueryResultHKT, Db['_']['fullSchema']>

export type QuestionStat = {
  questionId: string
  position: number
  prompt: string
  answers: number
  errorRate: number | null
  topWrongPick: { text: string; count: number } | null
}

// Operators are configured, not stored: there is no admin role in the schema,
// and an unset variable has to mean nobody rather than everybody.
export function operatorIds(raw = process.env.OPERATOR_USER_IDS): Set<string> {
  if (!raw) return new Set()
  const ids = raw.split(',').map((id) => id.trim())
  return new Set(ids.filter((id) => id.length > 0))
}

// An orphaned quiz has no author left to show its stats to, so only an
// operator can still see them.
export function canSeeStats(
  viewer: { id: string } | null,
  quiz: { authorId: string | null },
  operators = operatorIds(),
): boolean {
  if (!viewer) return false
  if (quiz.authorId === viewer.id) return true
  return operators.has(viewer.id)
}

export async function getQuestionStats(
  quizId: string,
  executor: Executor = db,
): Promise<QuestionStat[]> {
  // Every answer counts, finished run or not, player or guest: a question
  // somebody abandoned a run on is still a question they got to. A timeout is
  // stored as a wrong answer, so it counts as one here too.
  const tallies = await executor
    .select({
      questionId: questions.id,
      position: questions.position,
      prompt: questions.prompt,
      // The column, not *: the left join gives an unanswered question one row
      // of nulls, which count(*) would report as an answer.
      answers: sql<number>`count(${attemptAnswers.id})`.mapWith(Number),
      wrong: sql<number>`count(*) filter (where ${attemptAnswers.isCorrect} = false)`.mapWith(
        Number,
      ),
    })
    .from(questions)
    .leftJoin(attemptAnswers, eq(attemptAnswers.questionId, questions.id))
    .where(eq(questions.quizId, quizId))
    .groupBy(questions.id)

  const topPicks = await getTopWrongPicks(quizId, executor)

  return tallies
    .map(({ wrong, ...tally }) => ({
      ...tally,
      errorRate: tally.answers < MIN_ANSWERS ? null : wrong / tally.answers,
      topWrongPick: topPicks.get(tally.questionId) ?? null,
    }))
    .sort(compareStats)
}

// The wrong option each question's wrong answers picked most, keyed by
// question id. A question whose wrong answers picked no wrong option at all —
// timeouts with nothing selected, multi answers that only missed a correct
// option — has no entry.
async function getTopWrongPicks(
  quizId: string,
  executor: Executor,
): Promise<Map<string, { text: string; count: number }>> {
  // unnest belongs in the FROM clause, which the query builder cannot express.
  // The option has to belong to the answered question too: the selection
  // arrives from the client and is stored as sent, so a repeated id in one
  // stored selection must count once.
  const result = await executor.execute<{ questionId: string; text: string; count: number }>(sql`
    select
      ${attemptAnswers.questionId} as "questionId",
      ${options.text} as text,
      count(distinct ${attemptAnswers.id})::int as count
    from ${attemptAnswers}
    inner join ${questions} on ${questions.id} = ${attemptAnswers.questionId}
    cross join unnest(${attemptAnswers.selectedOptionIds}) as picked(option_id)
    inner join ${options}
      on ${options.id} = picked.option_id and ${options.questionId} = ${attemptAnswers.questionId}
    where ${questions.quizId} = ${quizId}
      and ${attemptAnswers.isCorrect} = false
      and ${options.isCorrect} = false
    group by ${attemptAnswers.questionId}, ${options.id}
    order by count(distinct ${attemptAnswers.id}) desc,${options.position} asc
  `)

  // Rows arrive best first, ties already broken by option position, so the
  // first row seen for a question is its answer.
  const picks = new Map<string, { text: string; count: number }>()
  for (const row of result.rows) {
    if (picks.has(row.questionId)) continue
    picks.set(row.questionId, { text: row.text, count: row.count })
  }
  return picks
}

// Rated questions first, worst first; a tie goes to the one more people
// answered, since its rate is the surer one. Unrated questions follow in quiz
// order.
function compareStats(a: QuestionStat, b: QuestionStat): number {
  if (a.errorRate === null && b.errorRate === null) return a.position - b.position
  if (a.errorRate === null) return 1
  if (b.errorRate === null) return -1
  if (a.errorRate !== b.errorRate) return b.errorRate - a.errorRate
  if (a.answers !== b.answers) return b.answers - a.answers
  return a.position - b.position
}
