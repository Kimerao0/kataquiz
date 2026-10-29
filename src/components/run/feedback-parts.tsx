'use client'

import { CheckIcon, TimerOffIcon, XIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import type { AnswerResult } from '@/lib/run/service'
import { QuizText } from './quiz-text'

/**
 * What a graded answer looks like, in the panel during the run and in the
 * review after it. Shared rather than copied: the review exists to show the
 * same verdict the panel gave, and only one definition keeps that true.
 */

// Three verdicts, not two: running out of time is wrong, but saying only
// "wrong" hides why.
export function verdictFor(result: AnswerResult) {
  if (result.timedOut) {
    return { Icon: TimerOffIcon, key: 'feedbackTimedOut' as const, tone: 'text-suo' }
  }
  if (result.correct) {
    return { Icon: CheckIcon, key: 'feedbackCorrect' as const, tone: 'text-ai' }
  }
  return { Icon: XIcon, key: 'feedbackWrong' as const, tone: 'text-suo' }
}

// The one thing on either screen that is genuinely read, so it keeps a reading
// measure where the question and the options drop theirs.
export function Explanation({ value }: { value: string }) {
  return (
    <p className="max-w-measure whitespace-pre-line font-reading text-prose [overflow-wrap:anywhere] [word-break:normal]">
      <QuizText value={value} />
    </p>
  )
}

// External and author-supplied, so a plain anchor rather than the internal
// Link, and no opener handed to the destination. The url is already validated:
// each caller runs `httpUrlOrNull` where it decides whether to render this, so
// the guard stays visible next to the content it is guarding.
export function TheoryLink({ url }: { url: string }) {
  const t = useTranslations('run')

  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer noopener"
      className="w-fit text-ink-quiet text-meta underline underline-offset-4 hover:text-ink"
    >
      {t('theoryLink')}
    </a>
  )
}
