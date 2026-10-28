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
    // Same shell as the run route: a challenge is the same drilling screen
    // reached by a link, so it shares the page width and the alignment column.
    <main className="mx-auto flex w-full max-w-(--page-width) flex-1 flex-col px-6 py-6 md:px-8">
      <div className="mx-auto flex w-full max-w-measure flex-1 flex-col xl:max-w-none">
        {/* The attempt id is request data and the session is read per request,
            so everything below streams in and the shell stays prerendered. */}
        <Suspense fallback={<p className="text-ink-quiet text-meta">{t('loading')}</p>}>
          <ChallengeSetup params={params} />
        </Suspense>
      </div>
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
      {/* Context, not the headline: the invite below is what this page is
          for. Same quiet line as the run page carries. */}
      {/* The measure is 62ch, read from this element's own font size, so the
          wrapper stays at the body size and the quiet line below it keeps the
          same left edge as the panel. */}
      <div className="mx-auto w-full max-w-measure xl:max-w-none">
        <h1 className="text-ink-quiet text-meta">
          <Link
            href={`/q/${invite.quizSlug}`}
            className="underline underline-offset-4 hover:text-ink"
          >
            {invite.quizTitle}
          </Link>
        </h1>
      </div>
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
