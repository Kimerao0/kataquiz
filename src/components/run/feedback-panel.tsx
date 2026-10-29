'use client'

import { useTranslations } from 'next-intl'
import { useEffect, useRef } from 'react'
import { Button } from '@/components/ui/button'
import type { AnswerResult } from '@/lib/run/service'
import { cn } from '@/lib/utils'
import { Explanation, TheoryLink, verdictFor } from './feedback-parts'

type FeedbackPanelProps = {
  result: AnswerResult
  /** Whether the keyboard way on is worth mentioning; see RunPlayer. */
  showKeys: boolean
  onNext: () => void
}

// Deliberately untimed. The clock stopped the instant the answer was submitted,
// and reading this is the part of the run that teaches anything.
export function FeedbackPanel({ result, showKeys, onNext }: FeedbackPanelProps) {
  const t = useTranslations('run')
  const nextRef = useRef<HTMLButtonElement>(null)

  // The panel appears below the options the player has just left, so keyboard
  // focus moves to the one control that continues the run.
  useEffect(() => {
    nextRef.current?.focus()
  }, [])

  const verdict = verdictFor(result)

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
        {t(verdict.key)}
      </h3>

      {result.timedOut && <p className="text-ink-quiet text-meta">{t('feedbackTimedOutBody')}</p>}

      {/* Which option was right is marked on the option itself, directly
          above; restating it here only says the same thing twice. */}
      {result.explanation && <Explanation value={result.explanation} />}

      <TheoryLink url={result.theoryUrl} />

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
