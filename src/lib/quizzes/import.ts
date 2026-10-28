import type { NodePgQueryResultHKT } from 'drizzle-orm/node-postgres'
import type { PgDatabase } from 'drizzle-orm/pg-core'
import { nanoid } from 'nanoid'
import { type Db, db } from '@/db/client'
import { options, questions, quizzes } from '@/db/schema'
import type { QuizFile } from '@/lib/quiz-schema'

export const MAX_UPLOAD_BYTES = 1_048_576

const SLUG_MAX_LENGTH = 60
const SLUG_SUFFIX_LENGTH = 6
const SLUG_FALLBACK = 'quiz'

// The base class of both `db` and a transaction, so the import can run inside
// a transaction the caller already opened.
type Executor = PgDatabase<NodePgQueryResultHKT, Db['_']['fullSchema']>

export function slugify(title: string): string {
  const slug = title
    .normalize('NFD')
    // The combining marks NFD split off: 'è' becomes 'e' plus one of these.
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, SLUG_MAX_LENGTH)
    .replace(/^-+|-+$/g, '')

  return slug || SLUG_FALLBACK
}

export async function importQuiz(params: {
  file: QuizFile
  authorId: string
  executor?: Executor
}): Promise<{ quizId: string; slug: string }> {
  const { file, authorId, executor } = params
  const slug = `${slugify(file.title)}-${nanoid(SLUG_SUFFIX_LENGTH)}`

  // A caller that passes an executor owns the transaction boundary: opening a
  // second one here would only be a savepoint, which rolls back without the
  // outer caller ever learning the import failed.
  if (!executor) return db.transaction((tx) => insertQuiz(tx, file, authorId, slug))
  return insertQuiz(executor, file, authorId, slug)
}

async function insertQuiz(
  executor: Executor,
  file: QuizFile,
  authorId: string,
  slug: string,
): Promise<{ quizId: string; slug: string }> {
  const [quiz] = await executor
    .insert(quizzes)
    .values({
      slug,
      authorId,
      title: file.title,
      description: file.description,
      language: file.language,
      tags: file.tags,
      questionsPerRun: file.run.questionsPerRun,
      maxErrors: file.run.maxErrors,
      timePerQuestionSec: file.run.timePerQuestionSec,
    })
    .returning({ id: quizzes.id })

  const inserted = await executor
    .insert(questions)
    .values(
      file.questions.map((question, position) => ({
        quizId: quiz.id,
        position,
        type: question.type,
        prompt: question.prompt,
        imageUrl: question.imageUrl,
        explanation: question.explanation,
        theoryUrl: question.theoryUrl,
        code: question.code,
        codeLanguage: question.codeLanguage,
      })),
    )
    .returning({ id: questions.id })

  await executor.insert(options).values(
    file.questions.flatMap((question, index) =>
      question.options.map((option, position) => ({
        questionId: inserted[index].id,
        position,
        text: option.text,
        isCorrect: option.correct,
      })),
    ),
  )

  return { quizId: quiz.id, slug }
}
