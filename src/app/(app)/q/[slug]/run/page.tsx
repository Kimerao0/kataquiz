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
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-8">
      {/* The slug is request data and the session is read per request, so
          everything below streams in and the shell stays prerendered. */}
      <Suspense fallback={<p className="opacity-70">{t('loading')}</p>}>
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
      <div className="flex flex-col gap-1">
        <h1 className="font-bold text-3xl">{quiz.title}</h1>
        <Link href={`/q/${slug}`} className="w-fit text-muted-foreground text-sm underline">
          {t('backToQuiz')}
        </Link>
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
