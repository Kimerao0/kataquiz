import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { getTranslations } from 'next-intl/server'
import { cache, Suspense } from 'react'
import { RunStartPanel } from '@/components/run/run-start-panel'
import { getQuizBySlug } from '@/lib/quizzes/search'
import { getCurrentUser } from '@/lib/session'

type QuizParams = Promise<{ slug: string }>

// generateMetadata and the page below both need the quiz; cache collapses the
// two reads into one query per request.
const loadQuiz = cache((slug: string) => getQuizBySlug(slug))

export async function generateMetadata({ params }: { params: QuizParams }): Promise<Metadata> {
  const { slug } = await params
  const quiz = await loadQuiz(slug)
  if (!quiz) return {}

  return { title: quiz.title }
}

export default function RunPage({ params }: { params: QuizParams }) {
  const t = useTranslations('common')

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-6 py-6 md:px-8">
      {/* The slug is request data and the session is read per request, so
          everything below streams in and the shell stays prerendered. */}
      <Suspense fallback={<p className="text-ink-quiet text-meta">{t('loading')}</p>}>
        <RunSetup params={params} />
      </Suspense>
    </main>
  )
}

async function RunSetup({ params }: { params: QuizParams }) {
  const { slug } = await params
  const quiz = await loadQuiz(slug)
  if (!quiz) notFound()

  const t = await getTranslations('run')
  // Who is playing is settled again inside startRunAction; this only decides
  // whether to ask for a nickname.
  const user = await getCurrentUser()

  return (
    <>
      {/* Context, not the headline. The question is what this screen is for,
          so the quiz it came from is a quiet line above the run and the way
          back sits next to it. */}
      {/* The measure is 62ch, and ch is read from the element's own font
          size: the wrapper has to sit at the body size or this line comes out
          narrower than the run below it and the two left edges disagree. */}
      <div className="mx-auto w-full max-w-measure">
        <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1 text-ink-quiet text-meta">
          <h1>{quiz.title}</h1>
          <Link href={`/q/${slug}`} className="underline underline-offset-4 hover:text-ink">
            {t('backToQuiz')}
          </Link>
        </div>
      </div>
      <RunStartPanel
        slug={slug}
        // What the run will actually be: startRun samples from the bank, so a
        // quiz with fewer questions than questionsPerRun plays what it has.
        questionsPerRun={Math.min(quiz.questionsPerRun, quiz.questionCount)}
        maxErrors={quiz.maxErrors}
        timePerQuestionSec={quiz.timePerQuestionSec}
        askNickname={user === null}
      />
    </>
  )
}
