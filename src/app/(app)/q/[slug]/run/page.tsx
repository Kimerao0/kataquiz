import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { getTranslations } from 'next-intl/server'
import { cache, Suspense } from 'react'
import { RunStartPanel } from '@/components/run/run-start-panel'
import { getQuizBySlug } from '@/lib/quizzes/search'
import { readPlayer } from '@/lib/run/identity'
import { findResumableRun, lastNicknameFor } from '@/lib/run/service'

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
    // The same width and the same gutter as the header, so the run's left edge
    // lands under the wordmark instead of being inset a second time inside it.
    <main className="mx-auto flex w-full max-w-(--page-width) flex-1 flex-col px-6 py-6 md:px-8">
      {/* One alignment column for everything on this screen. Up to lg it is
          the reading measure, which is what the quiet title line and the run
          have always shared; from xl it steps aside and the drill composition
          below takes the full width of the page. */}
      <div className="mx-auto flex w-full max-w-measure flex-1 flex-col xl:max-w-none">
        {/* The slug is request data and the session is read per request, so
            everything below streams in and the shell stays prerendered. */}
        <Suspense fallback={<p className="text-ink-quiet text-meta">{t('loading')}</p>}>
          <RunSetup params={params} />
        </Suspense>
      </div>
    </main>
  )
}

async function RunSetup({ params }: { params: QuizParams }) {
  const { slug } = await params
  const quiz = await loadQuiz(slug)
  if (!quiz) notFound()

  const t = await getTranslations('run')
  // Read-only, because this is a render: a visitor with no guest cookie yet has
  // played nothing, so there is nothing to look up and no cookie to mint. Who
  // is playing is settled again inside startRunAction; here it decides only
  // whether to ask for a nickname, what name to put in the field, and whether
  // there is a run to pick back up.
  const player = await readPlayer()
  // Two independent reads about the same player, so they go together: in
  // series this screen would wait out two round trips of latency instead of
  // one.
  const [resumable, initialNickname] = player
    ? await Promise.all([
        findResumableRun({ quizId: quiz.id, player }),
        lastNicknameFor({ quizId: quiz.id, player }),
      ])
    : [null, null]

  return (
    <>
      {/* Context, not the headline. The question is what this screen is for,
          so the quiz it came from is a quiet line above the run and the way
          back sits next to it. */}
      {/* The measure is 62ch, and ch is read from the element's own font
          size: the wrapper has to sit at the body size or this line comes out
          narrower than the run below it and the two left edges disagree. From
          xl the drill below is the full width of the page and this line
          follows it, so the two still share an edge. */}
      <div className="mx-auto w-full max-w-measure xl:max-w-none">
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
        askNickname={player?.kind !== 'user'}
        initialNickname={initialNickname}
        resumable={resumable}
      />
    </>
  )
}
