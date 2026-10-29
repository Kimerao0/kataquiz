'use client'

import { CheckIcon, XIcon } from 'lucide-react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { useEffect, useRef, useState } from 'react'
import type { StartRunResult } from '@/app/(app)/q/[slug]/actions'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { RunSummary as RunSummaryData } from '@/lib/run/service'
import { cn } from '@/lib/utils'
import { type Reviewed, RunReview } from './run-review'

const COPIED_FEEDBACK_MS = 2000

// Only a challenge run has one, and only once it is finished: the opponent's
// score is not fetched before that, so there is no 'hidden' case here to get
// wrong. An ordinary run leaves the prop undefined and renders as it always has.
export type ComparisonState =
  | { status: 'pending' }
  | { status: 'failed'; retry: () => void }
  | { status: 'ready'; opponentName: string; mine: RunSummaryData; theirs: RunSummaryData }

// Imported as a type and only as a type: the actions module builds a pg Pool
// the moment it is loaded, and this component also renders in jsdom.
export type ReplayError = Extract<StartRunResult, { ok: false }>['error'] | 'unexpected'

type RunSummaryProps = {
  summary: RunSummaryData
  quizSlug: string
  comparison?: ComparisonState
  /** Every question of the run as it was graded, in the order it was played. */
  reviewed: Reviewed[]
  /**
   * Set where a new run can be started in place, which turns Play again from a
   * page load into a click. Resolving `null` means the run started. Left unset
   * on /c/[attemptId], where leaving for an ordinary run really is a
   * navigation.
   */
  onPlayAgain?: () => Promise<ReplayError | null>
}

export function RunSummary({
  summary,
  quizSlug,
  comparison,
  reviewed,
  onPlayAgain,
}: RunSummaryProps) {
  const t = useTranslations('run')
  // The challenger's own attempt, never the one they were challenged on: the
  // loop only continues if beating a challenge produces a new link to pass on.
  const challengePath = `/c/${summary.attemptId}`

  // The origin is only knowable in the browser. Rendering it straight from
  // `window` would differ between the server pass and the first client one, so
  // the path is shown until an effect can widen it to a full URL.
  const [challengeUrl, setChallengeUrl] = useState(challengePath)
  useEffect(() => {
    setChallengeUrl(new URL(challengePath, window.location.origin).toString())
  }, [challengePath])

  const verdict = summary.passed
    ? { Icon: CheckIcon, title: t('passed'), tone: 'text-ink' }
    : { Icon: XIcon, title: t('failed'), tone: 'text-suo' }

  return (
    <section className="mx-auto flex w-full max-w-measure flex-1 flex-col justify-center gap-10 py-10 md:py-14 xl:mx-0">
      <div className="flex flex-col gap-3">
        <p className="text-ink-quiet text-meta">{t('summaryTitle')}</p>
        {/* Mark and words again: pass or fail must not rest on colour. */}
        <h2
          className={cn(
            'flex items-center gap-3 font-reading font-semibold text-title',
            verdict.tone,
          )}
        >
          <verdict.Icon aria-hidden="true" className="size-[0.8em]" />
          {verdict.title}
        </h2>
        <p className="text-base">
          {t('score', { score: summary.score, total: summary.total })} &middot;{' '}
          {t('errorCount', { errors: summary.errors })}
        </p>
      </div>

      {comparison !== undefined && (
        // One stable live region around all three states, so the reveal is
        // announced when it lands rather than only being painted.
        <div aria-live="polite" className="flex flex-col gap-2">
          <Comparison state={comparison} />
        </div>
      )}

      {/* Guarded rather than always rendered: a heading standing over an empty
          list would be the whole of what the review says. */}
      {reviewed.length > 0 && <RunReview items={reviewed} />}

      <ChallengeLink url={challengeUrl} />

      <Actions quizSlug={quizSlug} onPlayAgain={onPlayAgain} />
    </section>
  )
}

function Actions({
  quizSlug,
  onPlayAgain,
}: {
  quizSlug: string
  onPlayAgain?: () => Promise<ReplayError | null>
}) {
  const t = useTranslations('run')
  const [replaying, setReplaying] = useState(false)
  const [failed, setFailed] = useState<ReplayError | null>(null)

  async function replay() {
    // The `replaying` half sits behind the disabled button and no test can
    // reach it: React drops a click on a disabled control, so a mutation that
    // deletes it survives the suite. It stays because `disabled` is styling
    // that happens to block, and a second attempt is a second attempt row.
    if (onPlayAgain === undefined || replaying) return

    setReplaying(true)
    setFailed(null)
    const error = await onPlayAgain()
    // Left replaying on success: this summary is about to be replaced by the
    // new run, and flicking the label back to idle first would be a lie.
    if (error === null) return

    setFailed(error)
    setReplaying(false)
  }

  return (
    <div className="flex flex-col gap-3">
      {failed !== null && (
        <Alert variant="destructive">
          <AlertTitle>{t('startErrorTitle')}</AlertTitle>
          {/* The retry is the button below, which is enabled again. */}
          <AlertDescription>{t(`startErrors.${failed}`)}</AlertDescription>
        </Alert>
      )}
      <div className="flex flex-col gap-3 sm:flex-row">
        {/* A link where the only way to another run is a page load, a button
            where the caller can start one here. Same sizing either way, so the
            row does not move between the two. */}
        {onPlayAgain === undefined ? (
          <Link
            href={`/q/${quizSlug}/run`}
            className={buttonVariants({
              size: 'lg',
              className: 'h-11 rounded-md text-base sm:px-8',
            })}
          >
            {t('playAgain')}
          </Link>
        ) : (
          <Button
            type="button"
            size="lg"
            disabled={replaying}
            onClick={() => replay()}
            className="h-11 rounded-md text-base sm:px-8"
          >
            {replaying ? t('starting') : t('playAgain')}
          </Button>
        )}
        <Link
          href={`/q/${quizSlug}`}
          className={buttonVariants({
            variant: 'outline',
            size: 'lg',
            className: 'h-11 rounded-md text-base sm:px-8',
          })}
        >
          {t('backToQuiz')}
        </Link>
      </div>
    </div>
  )
}

function Comparison({ state }: { state: ComparisonState }) {
  const t = useTranslations('challenge')
  const tCommon = useTranslations('common')

  if (state.status === 'pending') {
    return <p className="text-ink-quiet text-meta">{t('comparing')}</p>
  }

  if (state.status === 'failed') {
    return (
      <Alert variant="destructive">
        <AlertTitle>{t('comparisonErrorTitle')}</AlertTitle>
        <AlertDescription className="flex flex-col items-start gap-3">
          {/* The run itself is safe above, so this is a retry and never a
              dead end: the score, the pass state and the share link all
              rendered without the comparison. */}
          <p>{t('comparisonErrorBody')}</p>
          <Button type="button" onClick={state.retry}>
            {tCommon('retry')}
          </Button>
        </AlertDescription>
      </Alert>
    )
  }

  return (
    <ComparisonResult opponentName={state.opponentName} mine={state.mine} theirs={state.theirs} />
  )
}

// Raw scores, not a ratio: both players answered the same ordered set, and the
// two totals differ only when a question was deleted between the runs — which
// is why each side is shown with the total it actually played.
function verdictKeyFor(mine: RunSummaryData, theirs: RunSummaryData) {
  if (mine.score > theirs.score) return 'youWon' as const
  if (mine.score < theirs.score) return 'theyWon' as const
  return 'draw' as const
}

function ComparisonResult({
  opponentName,
  mine,
  theirs,
}: {
  opponentName: string
  mine: RunSummaryData
  theirs: RunSummaryData
}) {
  const t = useTranslations('challenge')
  const tRun = useTranslations('run')

  const verdictKey = verdictKeyFor(mine, theirs)
  const verdict = verdictKey === 'theyWon' ? t('theyWon', { name: opponentName }) : t(verdictKey)

  return (
    <section className="flex flex-col gap-4 border-rule border-t pt-6">
      <h3 className="text-ink-quiet text-meta">{t('headToHead')}</h3>
      <p className="font-reading font-semibold text-2xl">{verdict}</p>
      {/* Stacked on a phone, side by side once there is room. */}
      <dl className="flex flex-col gap-3 sm:flex-row sm:gap-12">
        <div className="flex flex-col">
          <dt className="text-ink-quiet text-meta">{t('you')}</dt>
          <dd>{tRun('score', { score: mine.score, total: mine.total })}</dd>
        </div>
        <div className="flex min-w-0 flex-col">
          {/* A nickname chosen by a stranger: interpolated as text, never as
              markup, and already capped in length where it was stored. */}
          <dt className="truncate text-ink-quiet text-meta">{opponentName}</dt>
          <dd>{tRun('score', { score: theirs.score, total: theirs.total })}</dd>
        </div>
      </dl>
    </section>
  )
}

function ChallengeLink({ url }: { url: string }) {
  const t = useTranslations('run')
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const inputRef = useRef<HTMLInputElement>(null)

  // Without this, navigating away mid-timeout sets state on a gone component.
  const timeout = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(timeout.current), [])

  async function copy() {
    try {
      await navigator.clipboard.writeText(url)
      setState('copied')
      clearTimeout(timeout.current)
      timeout.current = setTimeout(() => setState('idle'), COPIED_FEEDBACK_MS)
    } catch {
      // No clipboard permission, or no clipboard at all. The field below still
      // holds the link, so the dead end is a selection away from being fixed.
      setState('failed')
      inputRef.current?.select()
    }
  }

  return (
    <div className="flex flex-col gap-3 border-rule border-t pt-6">
      <h3 className="text-ink-quiet text-meta">{t('shareTitle')}</h3>
      <p className="font-reading text-prose">{t('shareBody')}</p>
      <Label htmlFor="challenge-link" className="sr-only">
        {t('shareLabel')}
      </Label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          id="challenge-link"
          ref={inputRef}
          readOnly
          value={url}
          className="h-10 rounded-md sm:flex-1"
        />
        <Button type="button" onClick={copy} className="h-10 rounded-md">
          {state === 'copied' ? t('copied') : t('copy')}
        </Button>
      </div>
      {/* Announced rather than silently swapped in, since the button it
          belongs to has already moved on. */}
      <p aria-live="polite" className="text-ink-quiet text-meta">
        {state === 'failed' ? t('copyFailed') : ''}
      </p>
    </div>
  )
}
