'use client'

import { useTranslations } from 'next-intl'
import type { PublicOption, RunHistoryEntry } from '@/lib/run/service'
import { cn } from '@/lib/utils'
import { Explanation, TheoryLink, verdictFor } from './feedback-parts'
import { QuestionCode, QuestionImage } from './question-media'
import { QuizText } from './quiz-text'

/**
 * One graded question, kept by the run as it is played. The summary the server
 * sends back is a score and nothing else, and the feedback panel that held the
 * explanation is gone by the time the run ends, so what the review needs has
 * to be the player's own copy.
 *
 * An alias and not a second declaration: a run resumed after a refresh is
 * handed this very shape by the server, which is where it is now defined.
 */
export type Reviewed = RunHistoryEntry

function optionsWithIds(options: PublicOption[], ids: string[]): PublicOption[] {
  return options.filter((option) => ids.includes(option.id))
}

export function RunReview({ items }: { items: Reviewed[] }) {
  const t = useTranslations('run')

  return (
    <section className="flex flex-col gap-4 border-rule border-t pt-6">
      <h3 className="text-ink-quiet text-meta">{t('reviewTitle')}</h3>
      <ol className="divide-y divide-rule border-rule border-y">
        {items.map((item, index) => (
          <li key={item.question.id}>
            <ReviewEntry item={item} position={index + 1} />
          </li>
        ))}
      </ol>
    </section>
  )
}

function ReviewEntry({ item, position }: { item: Reviewed; position: number }) {
  const t = useTranslations('run')

  const verdict = verdictFor(item.result)
  const correctOptions = optionsWithIds(item.question.options, item.result.correctOptionIds)
  const pickedOptions = optionsWithIds(item.question.options, item.selectedOptionIds)
  // Restating the same option under two labels says nothing on a question that
  // was answered right, and a question that timed out has no pick to restate.
  const showPick = !item.result.correct && pickedOptions.length > 0
  // During the run each wrong pick was struck on its own line. A multi-answer
  // miss listed flat loses that: picking [a, c] against [a, b] is two lists
  // that mostly agree, and the strike is what says which pick was the mistake.
  const wrongPickIds = item.selectedOptionIds.filter(
    (id) => !item.result.correctOptionIds.includes(id),
  )

  return (
    // Open on a miss and shut on a hit: the premise of this screen is looking
    // up what went wrong. Native disclosure, so it costs no state and brings
    // its own keyboard and assistive-technology behaviour.
    <details open={!item.result.correct} className="py-3">
      <summary className="cursor-pointer">
        {/* The heading carries the layout rather than the summary: a summary
            set to flex loses its disclosure triangle, and nothing else on the
            line says the entry opens. It stays inline flow rather than
            inline-flex, which is one atomic box that moves below the marker
            whole as soon as it outgrows the line and strands it up there. */}
        <h4 className="inline">
          <span className="text-ink-quiet text-meta">{t('reviewQuestion', { position })}</span>{' '}
          {/* A mark and a word, never colour alone. Inline-flex here because it
              is narrow and its icon must not part from its word. */}
          <span
            className={cn('inline-flex items-center gap-1.5 align-middle text-meta', verdict.tone)}
          >
            <verdict.Icon aria-hidden="true" className="size-4" /> {t(verdict.key)}
          </span>{' '}
          <span className="font-reading [overflow-wrap:anywhere] [word-break:normal]">
            <QuizText value={item.question.prompt} />
          </span>
        </h4>
      </summary>

      <div className="flex flex-col gap-3 pt-3">
        {/* The prompt on its own is not the question: "what is the type of `x`
            below?" means nothing without the snippet, and an image question is
            all image. Same order as the question card showed them. */}
        {item.question.code !== null && (
          <QuestionCode code={item.question.code} language={item.question.codeLanguage} />
        )}

        {item.question.imageUrl && <QuestionImage src={item.question.imageUrl} />}

        <dl className="flex flex-col gap-3">
          <AnswerLine label={t('correctMark')} options={correctOptions} struckOptionIds={[]} />
          {showPick && (
            <AnswerLine
              label={t('yourAnswer')}
              options={pickedOptions}
              struckOptionIds={wrongPickIds}
            />
          )}
        </dl>

        {item.result.explanation && <Explanation value={item.result.explanation} />}

        <TheoryLink url={item.result.theoryUrl} />
      </div>
    </details>
  )
}

type AnswerLineProps = {
  label: string
  options: PublicOption[]
  /** Which of them to strike; empty on the list of what the answer should have been. */
  struckOptionIds: string[]
}

function AnswerLine({ label, options, struckOptionIds }: AnswerLineProps) {
  return (
    <div className="flex flex-col">
      <dt className="text-ink-quiet text-meta">{label}</dt>
      {options.map((option) => (
        <dd
          key={option.id}
          className={cn(
            'font-reading [overflow-wrap:anywhere] [word-break:normal]',
            // The same treatment the option row gave a wrong pick during the run.
            struckOptionIds.includes(option.id) && 'text-suo line-through decoration-suo/50',
          )}
        >
          <QuizText value={option.text} />
        </dd>
      ))}
    </div>
  )
}
