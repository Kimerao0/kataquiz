import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { getTranslations } from 'next-intl/server'
import { cache, Suspense } from 'react'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { getQuizBySlug } from '@/lib/quizzes/search'

type QuizParams = Promise<{ slug: string }>

// generateMetadata and the page below both need the quiz; cache collapses the
// two reads into one query per request.
const loadQuiz = cache((slug: string) => getQuizBySlug(slug))

export async function generateMetadata({ params }: { params: QuizParams }): Promise<Metadata> {
  const { slug } = await params
  const quiz = await loadQuiz(slug)
  if (!quiz) return {}

  return { title: quiz.title, description: quiz.description ?? undefined }
}

export default function QuizPage({ params }: { params: QuizParams }) {
  const t = useTranslations('common')

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-8">
      {/* The slug is request data, so the quiz streams in below the shell. */}
      <Suspense fallback={<p className="opacity-70">{t('loading')}</p>}>
        <QuizDetail params={params} />
      </Suspense>
    </main>
  )
}

async function QuizDetail({ params }: { params: QuizParams }) {
  const { slug } = await params
  const quiz = await loadQuiz(slug)
  if (!quiz) notFound()

  const t = await getTranslations('quiz')
  const tCommon = await getTranslations('common')
  const tCatalog = await getTranslations('catalog')
  // A quiz outlives its author's account, so the byline has to stand in for one.
  const authorName = quiz.authorName ?? tCatalog('deletedAuthor')
  // What a run will actually serve, not what the author asked for: a quiz with
  // fewer questions than questionsPerRun plays what it has, and promising more
  // here than the run panel then offers reads as a bug.
  const questionsPerRun = Math.min(quiz.questionsPerRun, quiz.questionCount)
  const runSettings = quiz.timePerQuestionSec
    ? t('runSettings', {
        questions: questionsPerRun,
        errors: quiz.maxErrors,
        seconds: quiz.timePerQuestionSec,
      })
    : t('runSettingsUntimed', { questions: questionsPerRun, errors: quiz.maxErrors })

  return (
    <article className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="font-bold text-3xl">{quiz.title}</h1>
        <p className="opacity-70">{t('author', { name: authorName })}</p>
      </div>

      {quiz.description && <p>{quiz.description}</p>}

      {quiz.tags.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {quiz.tags.map((tag) => (
            <Badge key={tag} variant="outline">
              {tag}
            </Badge>
          ))}
        </div>
      )}

      <ul className="flex flex-col gap-1 opacity-70">
        <li>{tCommon('questionCount', { count: quiz.questionCount })}</li>
        <li>{runSettings}</li>
      </ul>

      <Link href={`/q/${quiz.slug}/run`} className={buttonVariants({ size: 'lg' })}>
        {t('start')}
      </Link>
    </article>
  )
}
