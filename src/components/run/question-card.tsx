'use client'

import { CheckIcon, XIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import type { PublicQuestion } from '@/lib/run/service'
import { cn } from '@/lib/utils'
import { QuestionCode, QuestionImage } from './question-media'
import { QuizText } from './quiz-text'

/**
 * How many options a number key can reach. Zero is deliberately not one of
 * them: it misfires on some layouts, and an option nobody can see the key for
 * is better than one that answers by accident.
 */
const KEYED_OPTIONS = 9

type QuestionCardProps = {
  question: PublicQuestion
  selected: string[]
  onSelect: (optionIds: string[]) => void
  /** Called when the player commits an answer: a click for single, Confirm for multi. */
  onCommit: (optionIds: string[]) => void
  /**
   * True whenever option input must be ignored: a submission is in flight, the
   * question has been answered, or it has only just appeared and a click left
   * over from the previous one could still land.
   */
  locked: boolean
  /**
   * True only while an answer is actually in flight. Separate from `locked`
   * because it is what the Confirm button says, and a button that claims to be
   * checking when nothing has been sent is a lie.
   */
  submitting: boolean
  /** Null until the server has graded this question; the client never derives it. */
  correctOptionIds: string[] | null
  /**
   * Whether the number-key badges are shown. A badge that says "press 2" on a
   * phone with no keyboard is an instruction nobody can follow, so the player
   * decides this by owning a keyboard rather than the component by assuming it.
   */
  showKeys: boolean
}

export function QuestionCard({
  question,
  selected,
  onSelect,
  onCommit,
  locked,
  submitting,
  correctOptionIds,
  showKeys,
}: QuestionCardProps) {
  const t = useTranslations('run')
  const multi = question.type === 'multi'
  const answered = correctOptionIds !== null
  // The option group is named by pointing at the heading rather than by
  // copying the prompt into an aria-label: one copy of user-supplied text on
  // the page, and the screen reader hears the question once.
  const promptId = `${question.id}-prompt`
  const multiHintId = `${question.id}-multi`

  const rows = question.options.map((option, index) => ({
    id: option.id,
    text: option.text,
    // Shown only while the key would do something, and only for the options a
    // single key can reach.
    keyHint: showKeys && !answered && index < KEYED_OPTIONS ? index + 1 : null,
    selected: selected.includes(option.id),
    isCorrect: correctOptionIds?.includes(option.id) ?? false,
  }))

  return (
    <section className="flex flex-col gap-7 xl:gap-9">
      {/* Plain children, never dangerouslySetInnerHTML: the prompt is
          user-supplied and public, so markup in it has to stay text. */}
      <h2
        id={promptId}
        // Literata, and heavy: the default face is mono, and the question is
        // the one thing on this screen that is read rather than operated.
        className="text-balance font-reading font-semibold text-question [overflow-wrap:anywhere] [word-break:normal]"
      >
        <QuizText value={question.prompt} />
      </h2>

      {/* Read with the question, not after scanning past the options: a player
          who assumes one answer has already chosen by the time a line under
          the list, or the Confirm button below it, could tell them otherwise.
          A single-answer question says nothing here — the round control and
          the absence of this line are what it has to say. */}
      {multi && (
        <p
          id={multiHintId}
          // Quiet, but not so quiet it loses the race with a 67px question on
          // a wide display: it has to be read before the options are.
          className="-mt-4 text-ink-quiet text-meta xl:-mt-5 xl:text-base 2xl:text-lg"
        >
          {t('multiHint')}
        </p>
      )}

      {question.code !== null && (
        <QuestionCode code={question.code} language={question.codeLanguage} />
      )}

      {/* Keyed on the URL so a new question starts with a fresh error state. */}
      {question.imageUrl && <QuestionImage key={question.imageUrl} src={question.imageUrl} />}

      {multi ? (
        <fieldset
          aria-labelledby={promptId}
          aria-describedby={multiHintId}
          className="grid w-full gap-0 divide-y divide-rule border-rule border-t"
        >
          {rows.map((row) => (
            <OptionRow
              key={row.id}
              {...row}
              answered={answered}
              locked={locked}
              pending={submitting}
              control={{
                kind: 'checkbox',
                onCheckedChange: (checked: boolean) => {
                  onSelect(checked ? [...selected, row.id] : selected.filter((id) => id !== row.id))
                },
              }}
              // No commit on click: only the player knows when the set is finished.
              onActivate={undefined}
            />
          ))}
        </fieldset>
      ) : (
        <RadioGroup
          aria-labelledby={promptId}
          disabled={locked}
          value={selected[0] ?? null}
          // Selection only. Arrow keys move through a radio group by changing its
          // value, so committing here would submit the first option a keyboard
          // player arrowed past.
          onValueChange={(value: string) => onSelect([value])}
          className="gap-0 divide-y divide-rule border-rule border-t"
        >
          {rows.map((row) => (
            <OptionRow
              key={row.id}
              {...row}
              answered={answered}
              locked={locked}
              pending={submitting}
              control={{ kind: 'radio' }}
              // A click — pointer or Space on the focused radio — is the commit.
              onActivate={() => onCommit([row.id])}
            />
          ))}
        </RadioGroup>
      )}

      {/* The status line of a terminal: what to do, and the keys that do it.
          It doubles as the rule under the last option. */}
      {!answered && (
        <p className="-mt-3 xl:-mt-4 border-rule border-t pt-4 text-ink-quiet text-meta">
          {/* One line, not two: where the key badges are on screen they say
              what to do, and the prose version only repeats them longer. */}
          {showKeys
            ? multi
              ? t('keysMulti')
              : t('keysSingle')
            : multi
              ? t('chooseAll')
              : t('chooseOne')}
        </p>
      )}

      {multi && !answered && (
        <Button
          type="button"
          size="lg"
          disabled={locked}
          onClick={() => onCommit(selected)}
          className="h-11 w-full rounded-md text-base sm:w-fit sm:px-8 xl:h-13 xl:px-10 xl:text-lg"
        >
          {submitting ? t('checking') : t('confirm')}
        </Button>
      )}
    </section>
  )
}

type OptionControl =
  | { kind: 'radio' }
  | { kind: 'checkbox'; onCheckedChange: (checked: boolean) => void }

type OptionRowProps = {
  id: string
  text: string
  keyHint: number | null
  selected: boolean
  isCorrect: boolean
  answered: boolean
  locked: boolean
  /** An answer is in flight: the gap between the tap and the verdict. */
  pending: boolean
  control: OptionControl
  onActivate: (() => void) | undefined
}

/**
 * Once the answer is graded the row carries the verdict itself: a mark in the
 * gutter, a struck line through what was picked and turned out wrong, and a
 * word for a screen reader. Not a badge per row — three "Correct answer" pills
 * on a multi question shout over the text they are annotating.
 */
function rowMarker(selected: boolean, isCorrect: boolean) {
  if (isCorrect) {
    return {
      // Filled means "you picked this one", so a correct option nobody picked
      // is an outline: the fill and the mark say different things.
      Icon: CheckIcon,
      iconClass: selected ? 'text-primary-foreground' : 'text-ai',
      controlClass: 'border-ai',
    }
  }
  if (selected) {
    return {
      Icon: XIcon,
      iconClass: 'text-primary-foreground',
      // The checked radio paints itself indigo, which is the one colour a
      // wrong answer must not be, so the checked state is overridden rather
      // than merely sat on top of.
      controlClass:
        'border-suo data-checked:border-suo data-checked:bg-suo dark:data-checked:bg-suo',
    }
  }
  return null
}

// The row is the label, so the whole line is the hit target and the control
// keeps its accessible name from the option text.
function OptionRow({
  id,
  text,
  keyHint,
  selected,
  isCorrect,
  answered,
  locked,
  pending,
  control,
  onActivate,
}: OptionRowProps) {
  const t = useTranslations('run')
  const marker = answered ? rowMarker(selected, isCorrect) : null
  const struck = answered && selected && !isCorrect
  // The control is disabled the instant the row is tapped, and the primitive
  // dims a disabled control: the one row the player just chose would read as
  // the one that went away. Full strength on the chosen row only.
  const chosenWhilePending = pending && selected

  return (
    // The click handler rides on the label rather than on the control: a
    // label click is forwarded to the control it owns, so the keyboard path,
    // the focus ring and the accessible name all stay where they belong.
    <Label
      htmlFor={id}
      onClick={() => {
        // The label's own handler runs whatever the control does, so the lock
        // has to be re-checked here or a disabled row would still submit.
        if (locked) return
        onActivate?.()
      }}
      className={cn(
        // text-option, not text-prose: an option is operated rather than read,
        // and it has to keep up with the question above it. The leading
        // tightens where the face is large, the way the question's does.
        'flex w-full items-start gap-4 py-4 font-normal text-option leading-relaxed',
        'xl:gap-5 xl:py-5 xl:leading-snug 2xl:py-6',
        // The press state below replaces the browser's grey tap flash, which
        // would otherwise paint over it on every touch. Scale is a property of
        // its own in Tailwind v4, not a transform, so it is named as one here.
        'transition-[scale,background-color,opacity] duration-100 ease-out [-webkit-tap-highlight-color:transparent]',
        // On a phone the finger covers the control, so the row itself has to
        // answer the touch: a step past the selected tint, so the press reads
        // even on a row that is already chosen, and a give under the finger
        // for anyone who has not asked for less motion.
        locked
          ? 'cursor-default'
          : 'cursor-pointer hover:bg-surface active:bg-ai/15 motion-safe:active:scale-[0.98]',
        !answered && selected && 'bg-accent',
        // While the answer is in flight the 10% tint is too faint to hold the
        // choice on its own, so the chosen row is outlined in the indigo the
        // control already wears and the rest step back.
        chosenWhilePending && 'ring-2 ring-ai ring-inset',
        pending && !selected && 'opacity-60',
        answered && isCorrect && 'animate-verdict-pop motion-reduce:animate-none',
        struck && 'animate-verdict-shake motion-reduce:animate-none',
      )}
    >
      <span className="relative mt-[0.15em] inline-flex size-7 shrink-0 xl:size-8 2xl:size-9">
        {control.kind === 'radio' ? (
          <RadioGroupItem
            id={id}
            value={id}
            className={cn(
              // Round, where the checkbox below is square. The key cap over
              // it hides the dot and the tick alike, so the outline is the
              // only thing left saying how many answers this question takes —
              // and it says it in a shape, without colour and without a
              // sentence to read.
              'size-full rounded-full',
              // The dot would show through the digit sitting on top of it.
              (keyHint !== null || marker !== null) &&
                '[&_[data-slot=radio-group-indicator]]:hidden',
              chosenWhilePending && 'disabled:opacity-100',
              marker?.controlClass,
            )}
          />
        ) : (
          <Checkbox
            id={id}
            checked={selected}
            disabled={locked}
            onCheckedChange={control.onCheckedChange}
            className={cn(
              // Square, and deliberately so: see the radio above.
              'size-full rounded-sm',
              (keyHint !== null || marker !== null) && '[&_[data-slot=checkbox-indicator]]:hidden',
              chosenWhilePending && 'disabled:opacity-100',
              marker?.controlClass,
            )}
          />
        )}

        {/* Laid over the control, not beside it: the key cap is the control.
            Absolute, because the control is itself positioned and would
            otherwise paint over anything sharing its box. Hidden from
            assistive technology — a key is a way to act, not part of the
            option's name. */}
        <span
          aria-hidden="true"
          className={cn(
            'pointer-events-none absolute inset-0 z-10 grid place-items-center font-mono text-meta leading-none xl:text-base 2xl:text-lg',
            marker?.iconClass ?? (selected ? 'text-primary-foreground' : 'text-ink-quiet'),
          )}
        >
          {marker !== null ? <marker.Icon className="size-4 xl:size-5 2xl:size-6" /> : keyHint}
        </span>
      </span>

      <span
        className={cn(
          'min-w-0 flex-1 font-reading [overflow-wrap:anywhere] [word-break:normal]',
          struck && 'text-suo line-through decoration-suo/50',
          answered && !selected && !isCorrect && 'text-ink-quiet',
          answered && isCorrect && 'font-medium',
        )}
      >
        <QuizText value={text} />
      </span>

      {/* The mark above is the verdict for anyone who can see it; this is the
          same verdict for anyone who cannot, and it never becomes a pill. */}
      {answered && isCorrect && <span className="sr-only">{t('correctMark')}</span>}
      {answered && selected && <span className="sr-only">{t('yourAnswer')}</span>}
    </Label>
  )
}
