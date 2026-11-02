'use client'

import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { type FormEvent, useState } from 'react'
import { resumeRunAction } from '@/app/(app)/q/[slug]/actions'
import { type StartChallengeResult, startChallengeRunAction } from '@/app/c/[attemptId]/actions'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { ResumableRun, RunStart } from '@/lib/run/service'
import { RunPlayer } from './run-player'
import type { Reviewed } from './run-review'

type StartErrorCode =
  | Extract<StartChallengeResult, { ok: false }>['error']
  | 'unexpected'
  | 'resumeGone'
  | 'resumeLimited'

// One state for what took this panel's place, so a resume and a fresh start can
// never disagree about which run is being played.
type Started = { run: RunStart; resumed?: { answered: number; history: Reviewed[] } }

type ChallengeInvitePanelProps = {
  attemptId: string
  quizSlug: string
  /** Already resolved to printable copy by getChallenge; free text all the same. */
  opponentName: string
  /** What is left of the original set, which is what this run will play. */
  questionCount: number
  /** Signed-out players name themselves; a signed-in one already has a name. */
  askNickname: boolean
  /** An unfinished run on this challenge, which the player is offered back. */
  resumable: ResumableRun | null
}

// The same shape as RunStartPanel, and for the same reason: the run starts from
// a click and never from a render, because startChallengeRunAction mints the
// guest cookie and Next forbids writing a cookie while rendering.
//
// There is no score on this screen and none in its props. The invite the server
// sends carries none, so there is nothing here to hide — which is the point.
export function ChallengeInvitePanel({
  attemptId,
  quizSlug,
  opponentName,
  questionCount,
  askNickname,
  resumable,
}: ChallengeInvitePanelProps) {
  const t = useTranslations('challenge')
  const tRun = useTranslations('run')
  const tCommon = useTranslations('common')

  const [started, setStarted] = useState<Started | null>(null)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<StartErrorCode | null>(null)
  const [nickname, setNickname] = useState('')
  // Seeded from the prop rather than read from it, so a resume the server
  // refuses can take the offer off the screen.
  const [offer, setOffer] = useState(resumable)
  const [resuming, setResuming] = useState(false)

  // Each handler guards on both flags and both buttons are disabled by both,
  // as in RunStartPanel: with one request ever in flight, no second response
  // can land after a run has already taken this panel's place.
  async function begin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (starting || resuming) return

    setStarting(true)
    setError(null)
    try {
      const result = await startChallengeRunAction({
        attemptId,
        nickname: askNickname ? nickname : undefined,
      })
      if (result.ok) {
        // Left mounted and starting stays true: the panel is about to be
        // replaced by the run, so the button must not flicker back to idle.
        setStarted({ run: result.run })
        return
      }
      setError(result.error)
    } catch {
      setError('unexpected')
    }
    setStarting(false)
  }

  async function resume() {
    if (offer === null || starting || resuming) return

    setResuming(true)
    setError(null)
    try {
      // resumeRun is scoped to the quiz and the owner, not to plain runs, so the
      // quiz page's action opens a challenge attempt just as well.
      const result = await resumeRunAction({ slug: quizSlug, attemptId: offer.attemptId })
      if (result.ok && result.run.status === 'playing') {
        const { attemptId, question, total, timePerQuestionSec, answered, history } = result.run
        // Left mounted and resuming stays true: the run is about to take this
        // panel's place, so the button must not flicker back to idle.
        setStarted({
          run: { attemptId, question, total, timePerQuestionSec },
          resumed: { answered, history },
        })
        return
      }
      if (!result.ok && result.error === 'rateLimited') {
        // Only this request was refused: the run is still there to pick up, so
        // the offer stays and the message says to come back to it.
        setError('resumeLimited')
      } else {
        // Nothing to pick up any more. A run that finished between the render
        // and the click lands here too: its comparison lives inside RunPlayer,
        // out of reach from this panel, and the window is only a race.
        setOffer(null)
        setError('resumeGone')
      }
    } catch {
      setError('unexpected')
    }
    setResuming(false)
  }

  if (started !== null) {
    return (
      // Keyed on the attempt so a later replay remounts instead of landing inside
      // the previous run; see the reconciliation hazard in run-start-panel.tsx.
      <RunPlayer
        key={started.run.attemptId}
        run={started.run}
        quizSlug={quizSlug}
        challenge={{ opponentName }}
        resumed={started.resumed}
      />
    )
  }

  // Every question of the original set has since been deleted. Offering a
  // Begin button here would only produce the same answer from the server, so
  // the way on is the quiz itself.
  if (questionCount === 0) {
    return (
      <section className="mx-auto flex w-full max-w-measure flex-col gap-6 py-10 xl:mx-0">
        <div className="flex flex-col gap-3">
          <h2 className="font-reading font-semibold text-title">{t('emptyTitle')}</h2>
          <p className="font-reading text-prose">{t('emptyBody')}</p>
        </div>
        <Link
          href={`/q/${quizSlug}`}
          className={buttonVariants({
            variant: 'outline',
            size: 'lg',
            className: 'h-11 w-full rounded-md text-base sm:w-fit sm:px-8',
          })}
        >
          {t('viewQuiz')}
        </Link>
      </section>
    )
  }

  // Starting over leaves the unfinished run behind, which is already what
  // happens to every run somebody walks away from.
  const beginLabel = offer === null ? t('begin') : tRun('startOver')

  return (
    <form
      onSubmit={begin}
      className="mx-auto flex w-full max-w-measure flex-1 flex-col justify-center gap-8 py-10 md:py-14 xl:mx-0"
    >
      <div className="flex flex-col gap-3">
        {/* A name a stranger chose, interpolated as text and nothing else. */}
        <h2 className="font-reading font-semibold text-title [overflow-wrap:anywhere]">
          {t('invitedBy', { name: opponentName })}
        </h2>
        <p className="text-ink-quiet text-meta">
          {tCommon('questionCount', { count: questionCount })}
        </p>
        <p className="font-reading text-prose">{t('intro')}</p>
      </div>

      {offer !== null && (
        <div className="flex flex-col items-start gap-3">
          <p className="text-ink-quiet text-meta">
            {tRun('resumeBody', { answered: offer.answered, total: offer.total })}
          </p>
          <Button
            type="button"
            size="lg"
            disabled={starting || resuming}
            onClick={() => resume()}
            className="h-12 w-full rounded-md text-base sm:w-fit sm:px-10"
          >
            {resuming ? tRun('resuming') : tRun('resume')}
          </Button>
        </div>
      )}

      {askNickname && (
        <div className="flex flex-col gap-2">
          <Label htmlFor="nickname">{tRun('nicknameLabel')}</Label>
          <Input
            id="nickname"
            name="nickname"
            value={nickname}
            maxLength={40}
            placeholder={tRun('nicknamePlaceholder')}
            aria-describedby="nickname-hint"
            onChange={(event) => setNickname(event.target.value)}
            className="h-11 max-w-sm rounded-md text-base"
          />
          <p id="nickname-hint" className="text-ink-quiet text-meta">
            {tRun('nicknameHint')}
          </p>
        </div>
      )}

      {error !== null && (
        <Alert variant="destructive">
          <AlertTitle>{t('startErrorTitle')}</AlertTitle>
          {/* The retry is the Begin button itself, which stays enabled. */}
          <AlertDescription>{t(`startErrors.${error}`)}</AlertDescription>
        </Alert>
      )}

      <Button
        type="submit"
        size="lg"
        disabled={starting || resuming}
        className="h-12 w-full rounded-md text-base sm:w-fit sm:px-10"
      >
        {starting ? tRun('starting') : beginLabel}
      </Button>
    </form>
  )
}
