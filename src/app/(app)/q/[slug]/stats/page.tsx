import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { getTranslations } from 'next-intl/server'
import { cache, Suspense } from 'react'
import { PageFrame } from '@/components/page-frame'
import { getQuizBySlug } from '@/lib/quizzes/search'
import { canSeeStats, getQuestionStats, type QuestionStat } from '@/lib/quizzes/stats'
import { getCurrentUser } from '@/lib/session'

type QuizParams = Promise<{ slug: string }>

// The quiz only if this viewer may see its stats. Anyone else gets the same
// null as for a missing quiz, so the page and its title alike 404 without
// confirming the quiz has stats to hide. Cached because generateMetadata and
// the page both ask.
const loadVisibleQuiz = cache(async (slug: string) => {
  const [quiz, viewer] = await Promise.all([getQuizBySlug(slug), getCurrentUser()])
  if (!quiz || !canSeeStats(viewer, quiz)) return null
  return quiz
})

export async function generateMetadata({ params }: { params: QuizParams }): Promise<Metadata> {
  const { slug } = await params
  const quiz = await loadVisibleQuiz(slug)
  if (!quiz) return {}

  const t = await getTranslations('stats')
  return { title: t('title', { title: quiz.title }), robots: { index: false } }
}

export default function QuizStatsPage({ params }: { params: QuizParams }) {
  const t = useTranslations('common')

  return (
    // The slug is request data and the session is read per request, so the
    // stats stream in below the shell.
    <Suspense
      fallback={
        <PageFrame>
          <p className="pt-4 text-ink-quiet text-meta">{t('loading')}</p>
        </PageFrame>
      }
    >
      <QuizStats params={params} />
    </Suspense>
  )
}

async function QuizStats({ params }: { params: QuizParams }) {
  const { slug } = await params
  const quiz = await loadVisibleQuiz(slug)
  if (!quiz) notFound()

  const t = await getTranslations('stats')
  const stats = await getQuestionStats(quiz.id)
  const totalAnswers = stats.reduce((sum, stat) => sum + stat.answers, 0)

  return (
    <PageFrame
      title={quiz.title}
      userTitle
      lead={null}
      tools={
        <Link
          href={`/q/${quiz.slug}`}
          className="w-fit text-ink-quiet text-meta underline underline-offset-4 hover:text-ink"
        >
          {t('back')}
        </Link>
      }
    >
      <div className="flex max-w-measure flex-col gap-8 pt-4">
        <p className="text-ink-quiet text-meta">{t('totalAnswers', { count: totalAnswers })}</p>

        <ol aria-label={t('listLabel')} className="divide-y divide-rule border-rule border-y">
          {stats.map((stat) => (
            <QuestionRow key={stat.questionId} stat={stat} />
          ))}
        </ol>
      </div>
    </PageFrame>
  )
}

function QuestionRow({ stat }: { stat: QuestionStat }) {
  const t = useTranslations('stats')
  const rate =
    stat.errorRate === null
      ? t('notEnoughData')
      : t('percentWrong', { percent: Math.round(stat.errorRate * 100) })

  return (
    <li className="flex flex-col gap-2 py-4">
      <p className="line-clamp-3 font-reading text-prose">{stat.prompt}</p>
      <p className="flex flex-wrap gap-x-5 text-ink-quiet text-meta">
        <span>{t('answers', { count: stat.answers })}</span>
        <span>{rate}</span>
      </p>
      {stat.topWrongPick && (
        <p className="text-ink-quiet text-meta">
          {t('topWrongPick', { text: stat.topWrongPick.text, count: stat.topWrongPick.count })}
        </p>
      )}
    </li>
  )
}
