'use client'

import { CheckCircle2Icon, TimerOffIcon, XCircleIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useEffect, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import type { AnswerResult } from '@/lib/run/service'
import { cn } from '@/lib/utils'

type FeedbackPanelProps = {
  result: AnswerResult
  /** The texts behind result.correctOptionIds, resolved by the player. */
  correctOptionTexts: string[]
  onNext: () => void
}

// Deliberately untimed. The clock stopped the instant the answer was submitted,
// and reading this is the part of the run that teaches anything.
// Quiz content is uploaded by strangers. Upload validation already restricts
// theoryUrl to http(s), so this is a second line rather than the only one —
// but the Milestone 2 editor will be a second way into the same column, and a
// javascript: href here would run in the player's session.
function httpUrlOrNull(value: string | null): string | null {
  if (!value) return null
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null
  } catch {
    return null
  }
}

export function FeedbackPanel({ result, correctOptionTexts, onNext }: FeedbackPanelProps) {
  const t = useTranslations('run')
  const nextRef = useRef<HTMLButtonElement>(null)
  const safeTheoryUrl = httpUrlOrNull(result.theoryUrl)

  // The panel appears below the options the player has just left, so keyboard
  // focus moves to the one control that continues the run.
  useEffect(() => {
    nextRef.current?.focus()
  }, [])

  // Three verdicts, not two: running out of time is wrong, but saying only
  // "wrong" hides why.
  const verdict = result.timedOut
    ? { Icon: TimerOffIcon, title: t('feedbackTimedOut') }
    : result.correct
      ? { Icon: CheckCircle2Icon, title: t('feedbackCorrect') }
      : { Icon: XCircleIcon, title: t('feedbackWrong') }

  return (
    <section
      aria-live="polite"
      className={cn(
        'flex flex-col gap-4 rounded-lg border p-4',
        result.correct ? 'border-primary' : 'border-destructive',
      )}
    >
      {/* An icon and words, never colour alone. */}
      <h3 className="flex items-center gap-2 font-semibold text-lg">
        <verdict.Icon aria-hidden="true" className="size-5" />
        {verdict.title}
      </h3>

      {result.timedOut && <p>{t('feedbackTimedOutBody')}</p>}

      {!result.correct && correctOptionTexts.length > 0 && (
        <p>{t('correctAnswerWas', { options: correctOptionTexts.join(', ') })}</p>
      )}

      {result.explanation && (
        <>
          <Separator />
          <p className="whitespace-pre-line">{result.explanation}</p>
        </>
      )}

      {safeTheoryUrl && (
        // External and author-supplied, so a plain anchor rather than the
        // internal Link, and no opener handed to the destination.
        <a
          href={safeTheoryUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="w-fit underline underline-offset-4"
        >
          {t('theoryLink')}
        </a>
      )}

      <Button ref={nextRef} type="button" size="lg" onClick={onNext}>
        {result.summary === null ? t('next') : t('seeResult')}
      </Button>
    </section>
  )
}
