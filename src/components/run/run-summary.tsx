'use client'

import { CheckCircle2Icon, XCircleIcon } from 'lucide-react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { useEffect, useRef, useState } from 'react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import type { RunSummary as RunSummaryData } from '@/lib/run/service'
import { cn } from '@/lib/utils'

const COPIED_FEEDBACK_MS = 2000

// Only a challenge run has one, and only once it is finished: the opponent's
// score is not fetched before that, so there is no 'hidden' case here to get
// wrong. An ordinary run leaves the prop undefined and renders as it always has.
export type ComparisonState =
  | { status: 'pending' }
  | { status: 'failed'; retry: () => void }
  | { status: 'ready'; opponentName: string; mine: RunSummaryData; theirs: RunSummaryData }

type RunSummaryProps = {
  summary: RunSummaryData
  quizSlug: string
  comparison?: ComparisonState
}

export function RunSummary({ summary, quizSlug, comparison }: RunSummaryProps) {
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
    ? { Icon: CheckCircle2Icon, title: t('passed') }
    : { Icon: XCircleIcon, title: t('failed') }

  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <p className="text-muted-foreground text-sm">{t('summaryTitle')}</p>
        {/* Icon and words again: pass or fail must not rest on colour. */}
        <h2
          className={cn(
            'flex items-center gap-2 font-bold text-3xl',
            summary.passed ? 'text-foreground' : 'text-destructive',
          )}
        >
          <verdict.Icon aria-hidden="true" className="size-7" />
          {verdict.title}
        </h2>
        <p className="text-lg">
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

      <Separator />

      <ChallengeLink url={challengeUrl} />

      <div className="flex flex-wrap gap-3">
        <Link href={`/q/${quizSlug}/run`} className={buttonVariants({ size: 'lg' })}>
          {t('playAgain')}
        </Link>
        <Link
          href={`/q/${quizSlug}`}
          className={buttonVariants({ variant: 'outline', size: 'lg' })}
        >
          {t('backToQuiz')}
        </Link>
      </div>
    </section>
  )
}

function Comparison({ state }: { state: ComparisonState }) {
  const t = useTranslations('challenge')
  const tCommon = useTranslations('common')

  if (state.status === 'pending') {
    return <p className="text-muted-foreground">{t('comparing')}</p>
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
    <section className="flex flex-col gap-3 rounded-lg border p-4">
      <h3 className="font-semibold text-lg">{t('headToHead')}</h3>
      <p className="font-bold text-2xl">{verdict}</p>
      {/* Stacked on a phone, side by side once there is room. */}
      <dl className="flex flex-col gap-3 sm:flex-row sm:gap-10">
        <div className="flex flex-col">
          <dt className="text-muted-foreground text-sm">{t('you')}</dt>
          <dd className="text-lg">{tRun('score', { score: mine.score, total: mine.total })}</dd>
        </div>
        <div className="flex flex-col">
          {/* A nickname chosen by a stranger: interpolated as text, never as
              markup, and already capped in length where it was stored. */}
          <dt className="text-muted-foreground text-sm">{opponentName}</dt>
          <dd className="text-lg">{tRun('score', { score: theirs.score, total: theirs.total })}</dd>
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
    <div className="flex flex-col gap-2">
      <h3 className="font-semibold text-lg">{t('shareTitle')}</h3>
      <p className="text-muted-foreground text-sm">{t('shareBody')}</p>
      <Label htmlFor="challenge-link" className="sr-only">
        {t('shareLabel')}
      </Label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input id="challenge-link" ref={inputRef} readOnly value={url} className="sm:flex-1" />
        <Button type="button" onClick={copy}>
          {state === 'copied' ? t('copied') : t('copy')}
        </Button>
      </div>
      {/* Announced rather than silently swapped in, since the button it
          belongs to has already moved on. */}
      <p aria-live="polite" className="text-muted-foreground text-sm">
        {state === 'failed' ? t('copyFailed') : ''}
      </p>
    </div>
  )
}
