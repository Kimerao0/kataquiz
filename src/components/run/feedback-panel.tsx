'use client'

import { CheckIcon, TimerOffIcon, XIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useEffect, useRef } from 'react'
import { Button } from '@/components/ui/button'
import type { AnswerResult } from '@/lib/run/service'
import { cn } from '@/lib/utils'
import { QuizText } from './quiz-text'

type FeedbackPanelProps = {
  result: AnswerResult
  /** Whether the keyboard way on is worth mentioning; see RunPlayer. */
  showKeys: boolean
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

export function FeedbackPanel({ result, showKeys, onNext }: FeedbackPanelProps) {
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
    ? { Icon: TimerOffIcon, title: t('feedbackTimedOut'), tone: 'text-suo' }
    : result.correct
      ? { Icon: CheckIcon, title: t('feedbackCorrect'), tone: 'text-ai' }
      : { Icon: XIcon, title: t('feedbackWrong'), tone: 'text-suo' }

  return (
    <section aria-live="polite" className="flex flex-col gap-5 border-rule border-t pt-6">
      {/* A mark and a word, never colour alone. Mono and small: the verdict is
          chrome, and the explanation under it is the part worth reading. */}
      <h3
        className={cn(
          // Still chrome, but chrome a player can find: at the chrome size a
          // verdict next to a 67px question is a line nobody looks at.
          'flex items-center gap-2 font-medium text-meta tracking-normal xl:text-base 2xl:text-lg',
          verdict.tone,
        )}
      >
        <verdict.Icon aria-hidden="true" className="size-4 xl:size-5" />
        {verdict.title}
      </h3>

      {result.timedOut && <p className="text-ink-quiet text-meta">{t('feedbackTimedOutBody')}</p>}

      {/* Which option was right is marked on the option itself, directly
          above; restating it here only says the same thing twice. */}
      {result.explanation && (
        // The one thing on this screen that is genuinely read, so it keeps a
        // reading measure where the question and the options drop theirs.
        <p className="max-w-measure whitespace-pre-line font-reading text-prose [overflow-wrap:anywhere] [word-break:normal]">
          <QuizText value={result.explanation} />
        </p>
      )}

      {safeTheoryUrl && (
        // External and author-supplied, so a plain anchor rather than the
        // internal Link, and no opener handed to the destination.
        <a
          href={safeTheoryUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="w-fit text-ink-quiet text-meta underline underline-offset-4 hover:text-ink"
        >
          {t('theoryLink')}
        </a>
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Button
          ref={nextRef}
          type="button"
          size="lg"
          onClick={onNext}
          className="h-11 w-full rounded-md text-base sm:w-fit sm:px-8 xl:h-13 xl:px-10 xl:text-lg"
        >
          {result.summary === null ? t('next') : t('seeResult')}
        </Button>
        {showKeys && <p className="text-ink-quiet text-meta">{t('keysNext')}</p>}
      </div>
    </section>
  )
}
