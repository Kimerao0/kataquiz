import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { cache, Suspense } from 'react'
import { ChallengeInvitePanel } from '@/components/run/challenge-invite-panel'
import { getChallenge } from '@/lib/run/challenge'
import { getCurrentUser } from '@/lib/session'
import { isUuid } from '@/lib/uuid'

type ChallengeParams = Promise<{ attemptId: string }>

// generateMetadata and the page below both need the invite; cache collapses the
// two reads into one query per request. The id is a URL segment, so its shape
// is checked before the lookup: Postgres answers a malformed uuid with an
// error, and /c/<typo> has to be a 404 rather than a 500.
const loadChallenge = cache(async (attemptId: string) =>
  isUuid(attemptId) ? getChallenge(attemptId) : null,
)

export async function generateMetadata({ params }: { params: ChallengeParams }): Promise<Metadata> {
  const { attemptId } = await params
  const invite = await loadChallenge(attemptId)
  if (!invite) return {}

  // The quiz, never the result: this string is the browser tab and the link
  // preview of a page whose whole point is that the score is still secret.
  return { title: invite.quizTitle }
}

export default function ChallengePage({ params }: { params: ChallengeParams }) {
  const t = useTranslations('common')

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-8">
      {/* The attempt id is request data and the session is read per request, so
          everything below streams in and the shell stays prerendered. */}
      <Suspense fallback={<p className="opacity-70">{t('loading')}</p>}>
        <ChallengeSetup params={params} />
      </Suspense>
    </main>
  )
}

async function ChallengeSetup({ params }: { params: ChallengeParams }) {
  const { attemptId } = await params
  // Null for an id that is not a uuid, an attempt that does not exist, one that
  // was abandoned, or one whose quiz is hidden. The visitor is told none of
  // those apart: all four are a link that leads nowhere.
  const invite = await loadChallenge(attemptId)
  if (!invite) notFound()

  // Who is playing is settled again inside startChallengeRunAction; this only
  // decides whether to ask for a nickname.
  const user = await getCurrentUser()

  return (
    <>
      <h1 className="font-bold text-3xl">
        <Link href={`/q/${invite.quizSlug}`} className="underline-offset-4 hover:underline">
          {invite.quizTitle}
        </Link>
      </h1>
      <ChallengeInvitePanel
        attemptId={invite.attemptId}
        quizSlug={invite.quizSlug}
        opponentName={invite.opponentName}
        questionCount={invite.questionCount}
        askNickname={user === null}
      />
    </>
  )
}
