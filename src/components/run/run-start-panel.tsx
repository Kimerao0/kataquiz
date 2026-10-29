'use client'

import { useTranslations } from 'next-intl'
import { type FormEvent, useState } from 'react'
import { resumeRunAction, type StartRunResult, startRunAction } from '@/app/(app)/q/[slug]/actions'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { ResumableRun, RunResume, RunStart, RunSummary } from '@/lib/run/service'
import { RunPlayer } from './run-player'
import type { Reviewed } from './run-review'
import { RunSummary as RunSummaryPanel } from './run-summary'

type StartErrorCode =
  | Extract<StartRunResult, { ok: false }>['error']
  | 'unexpected'
  | 'resumeGone'
  | 'resumeLimited'

// One state for all three ways this panel ends, so a resume and a fresh start
// can never be on screen at once or disagree about which run is being played.
type Started =
  | { kind: 'playing'; run: RunStart; resumed?: { answered: number; history: Reviewed[] } }
  | { kind: 'finished'; summary: RunSummary; history: Reviewed[] }

type RunStartPanelProps = {
  slug: string
  questionsPerRun: number
  maxErrors: number
  timePerQuestionSec: number | null
  /** Signed-out players name themselves; a signed-in one already has a name. */
  askNickname: boolean
  /** An unfinished run on this quiz, which the player is offered back. */
  resumable: ResumableRun | null
}

function startedFrom(resume: RunResume): Started {
  if (resume.status === 'finished') {
    // The run was finished elsewhere while this tab was away. The summary
    // stands on its own, so there is nothing here to invent.
    return { kind: 'finished', summary: resume.summary, history: resume.history }
  }

  return {
    kind: 'playing',
    run: {
      attemptId: resume.attemptId,
      question: resume.question,
      total: resume.total,
      timePerQuestionSec: resume.timePerQuestionSec,
    },
    resumed: { answered: resume.answered, history: resume.history },
  }
}

// The run is started from a click and never from a render: startRunAction mints
// the guest cookie, and Next forbids writing a cookie while rendering. That is
// the whole reason this panel exists instead of the page auto-starting.
export function RunStartPanel({
  slug,
  questionsPerRun,
  maxErrors,
  timePerQuestionSec,
  askNickname,
  resumable,
}: RunStartPanelProps) {
  const t = useTranslations('run')
  const tQuiz = useTranslations('quiz')

  const [started, setStarted] = useState<Started | null>(null)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<StartErrorCode | null>(null)
  const [nickname, setNickname] = useState('')
  // Seeded from the prop rather than read from it, so a resume the server
  // refuses can take the offer off the screen.
  const [offer, setOffer] = useState(resumable)
  const [resuming, setResuming] = useState(false)

  // Each handler guards on both flags and both buttons are disabled by both:
  // that cross-guard is what keeps a single run on screen. With only one
  // request ever in flight there is no second response left to land on a panel
  // that has already handed the run to <RunPlayer> — which React reconciles
  // rather than remounts, so a late reply would swap the attempt while the
  // question, the position and the review stayed on the other one.
  async function begin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (starting || resuming) return

    setStarting(true)
    setError(null)
    try {
      const result = await startRunAction({ slug, nickname: askNickname ? nickname : undefined })
      if (result.ok) {
        // Left mounted and starting stays true: the panel is about to be
        // replaced by the run, so the button must not flicker back to idle.
        setStarted({ kind: 'playing', run: result.run })
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
      const result = await resumeRunAction({ slug, attemptId: offer.attemptId })
      if (result.ok) {
        // Left mounted and resuming stays true, for the same reason begin
        // leaves starting set: the run is about to take this panel's place.
        setStarted(startedFrom(result.run))
        return
      }
      if (result.error === 'rateLimited') {
        // Only this request was refused: the run is still there to pick up, so
        // the offer stays and the message says to come back to it.
        setError('resumeLimited')
      } else {
        // Nothing to pick up any more, so the offer goes with the message: what
        // is left on screen is a run to start from the top.
        setOffer(null)
        setError('resumeGone')
      }
    } catch {
      setError('unexpected')
    }
    setResuming(false)
  }

  if (started?.kind === 'playing') {
    return <RunPlayer run={started.run} quizSlug={slug} resumed={started.resumed} />
  }

  if (started?.kind === 'finished') {
    return <RunSummaryPanel summary={started.summary} quizSlug={slug} reviewed={started.history} />
  }

  const settings =
    timePerQuestionSec === null
      ? tQuiz('runSettingsUntimed', { questions: questionsPerRun, errors: maxErrors })
      : tQuiz('runSettings', {
          questions: questionsPerRun,
          errors: maxErrors,
          seconds: timePerQuestionSec,
        })
  // Starting over leaves the unfinished run behind, which is already what
  // happens to every run somebody walks away from.
  const beginLabel = offer === null ? t('begin') : t('startOver')

  return (
    <form
      onSubmit={begin}
      className="mx-auto flex w-full max-w-measure flex-1 flex-col justify-center gap-8 py-10 md:py-14 xl:mx-0"
    >
      <div className="flex flex-col gap-3">
        <h2 className="font-reading font-semibold text-title">{t('title')}</h2>
        <p className="text-ink-quiet text-meta">{settings}</p>
      </div>

      {offer !== null && (
        <div className="flex flex-col items-start gap-3">
          <p className="text-ink-quiet text-meta">
            {t('resumeBody', { answered: offer.answered, total: offer.total })}
          </p>
          <Button
            type="button"
            size="lg"
            disabled={starting || resuming}
            onClick={() => resume()}
            className="h-12 w-full rounded-md text-base sm:w-fit sm:px-10"
          >
            {resuming ? t('resuming') : t('resume')}
          </Button>
        </div>
      )}

      {askNickname && (
        <div className="flex flex-col gap-2">
          <Label htmlFor="nickname">{t('nicknameLabel')}</Label>
          <Input
            id="nickname"
            name="nickname"
            value={nickname}
            maxLength={40}
            placeholder={t('nicknamePlaceholder')}
            aria-describedby="nickname-hint"
            onChange={(event) => setNickname(event.target.value)}
            className="h-11 max-w-sm rounded-md text-base"
          />
          <p id="nickname-hint" className="text-ink-quiet text-meta">
            {t('nicknameHint')}
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
        {starting ? t('starting') : beginLabel}
      </Button>
    </form>
  )
}
