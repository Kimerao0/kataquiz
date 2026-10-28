import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { getTranslations } from 'next-intl/server'
import { cache, Suspense } from 'react'
import { PageFrame } from '@/components/page-frame'
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
    // The slug is request data, so the quiz streams in below the shell.
    <Suspense
      fallback={
        <PageFrame>
          <p className="pt-4 text-ink-quiet text-meta">{t('loading')}</p>
        </PageFrame>
      }
    >
      <QuizDetail params={params} />
    </Suspense>
  )
}

async function QuizDetail({ params }: { params: QuizParams }) {
  const { slug } = await params
  const quiz = await loadQuiz(slug)
  if (!quiz) notFound()

  const t = await getTranslations('quiz')
  const tCatalog = await getTranslations('catalog')
  // A quiz outlives its author's account, so the byline has to stand in for one.
  const authorName = quiz.authorName ?? tCatalog('deletedAuthor')
  // What a run will actually serve, not what the author asked for: a quiz with
  // fewer questions than questionsPerRun plays what it has, and promising more
  // here than the run panel then offers reads as a bug.
  const questionsPerRun = Math.min(quiz.questionsPerRun, quiz.questionCount)
  const timeValue = quiz.timePerQuestionSec
    ? t('seconds', { seconds: quiz.timePerQuestionSec })
    : t('untimed')
  const settings = [
    ...(quiz.questionCount > questionsPerRun
      ? [{ label: t('questionsInBank'), value: quiz.questionCount }]
      : []),
    { label: t('questionsPerRun'), value: questionsPerRun },
    { label: t('mistakesAllowed'), value: quiz.maxErrors },
    { label: t('timePerQuestion'), value: timeValue },
  ]

  // The title and its byline take the head column; the reading, the run
  // settings and the way in take the body. Start comes last, after the numbers
  // it is about to commit you to.
  return (
    <PageFrame
      title={quiz.title}
      userTitle
      lead={null}
      tools={<p className="text-ink-quiet text-meta">{t('author', { name: authorName })}</p>}
    >
      <div className="flex max-w-measure flex-col gap-8 pt-4">
        {quiz.description && <p className="font-reading text-prose">{quiz.description}</p>}

        {quiz.tags.length > 0 && (
          <ul aria-label={t('tagsLabel')} className="flex flex-wrap gap-x-4">
            {quiz.tags.map((tag) => (
              <li key={tag}>
                <Link href={`/?tag=${encodeURIComponent(tag)}`} className="tag-link">
                  {tag}
                </Link>
              </li>
            ))}
          </ul>
        )}

        <section aria-label={t('settingsLabel')} className="flex flex-col gap-8">
          <dl className="divide-y divide-rule border-rule border-y">
            {settings.map(({ label, value }) => (
              <div key={label} className="flex items-baseline justify-between gap-6 py-3">
                <dt className="text-ink-quiet text-meta">{label}</dt>
                <dd className="font-reading font-semibold text-xl">{value}</dd>
              </div>
            ))}
          </dl>

          <Link
            href={`/q/${quiz.slug}/run`}
            className={buttonVariants({
              size: 'lg',
              className: 'h-12 w-full text-base sm:w-fit sm:px-12',
            })}
          >
            {t('start')}
          </Link>
        </section>
      </div>
    </PageFrame>
  )
}
