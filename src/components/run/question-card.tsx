'use client'

import { CheckIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import type { PublicQuestion } from '@/lib/run/service'
import { cn } from '@/lib/utils'

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
}

export function QuestionCard({
  question,
  selected,
  onSelect,
  onCommit,
  locked,
  submitting,
  correctOptionIds,
}: QuestionCardProps) {
  const t = useTranslations('run')
  const multi = question.type === 'multi'
  // The option group is named by pointing at the heading rather than by
  // copying the prompt into an aria-label: one copy of user-supplied text on
  // the page, and the screen reader hears the question once.
  const promptId = `${question.id}-prompt`

  return (
    <section className="flex flex-col gap-4">
      {/* Plain children, never dangerouslySetInnerHTML: the prompt is
          user-supplied and public, so markup in it has to stay text. */}
      <h2 id={promptId} className="font-semibold text-xl">
        {question.prompt}
      </h2>

      {/* Keyed on the URL so a new question starts with a fresh error state. */}
      {question.imageUrl && <QuestionImage key={question.imageUrl} src={question.imageUrl} />}

      <p className="text-muted-foreground text-sm">{multi ? t('chooseAll') : t('chooseOne')}</p>

      {multi ? (
        <MultiOptions
          promptId={promptId}
          question={question}
          selected={selected}
          onSelect={onSelect}
          onCommit={onCommit}
          locked={locked}
          submitting={submitting}
          correctOptionIds={correctOptionIds}
        />
      ) : (
        <SingleOptions
          promptId={promptId}
          question={question}
          selected={selected}
          onSelect={onSelect}
          onCommit={onCommit}
          locked={locked}
          submitting={submitting}
          correctOptionIds={correctOptionIds}
        />
      )}
    </section>
  )
}

function SingleOptions({
  promptId,
  question,
  selected,
  onSelect,
  onCommit,
  locked,
  correctOptionIds,
}: QuestionCardProps & { promptId: string }) {
  return (
    <RadioGroup
      aria-labelledby={promptId}
      disabled={locked}
      value={selected[0] ?? null}
      // Selection only. Arrow keys move through a radio group by changing its
      // value, so committing here would submit the first option a keyboard
      // player arrowed past.
      onValueChange={(value: string) => onSelect([value])}
    >
      {question.options.map((option) => (
        <OptionRow
          key={option.id}
          id={option.id}
          text={option.text}
          locked={locked}
          correctOptionIds={correctOptionIds}
          selected={selected.includes(option.id)}
          // A click — pointer or Space on the focused radio — is the commit.
          onActivate={() => onCommit([option.id])}
        >
          <RadioGroupItem id={option.id} value={option.id} />
        </OptionRow>
      ))}
    </RadioGroup>
  )
}

function MultiOptions({
  promptId,
  question,
  selected,
  onSelect,
  onCommit,
  locked,
  submitting,
  correctOptionIds,
}: QuestionCardProps & { promptId: string }) {
  const t = useTranslations('run')

  return (
    <div className="flex flex-col gap-4">
      <fieldset aria-labelledby={promptId} className="grid w-full gap-2">
        {question.options.map((option) => (
          <OptionRow
            key={option.id}
            id={option.id}
            text={option.text}
            locked={locked}
            correctOptionIds={correctOptionIds}
            selected={selected.includes(option.id)}
            // No commit on click: only the player knows when the set is finished.
            onActivate={undefined}
          >
            <Checkbox
              id={option.id}
              checked={selected.includes(option.id)}
              disabled={locked}
              onCheckedChange={(checked: boolean) => {
                onSelect(
                  checked ? [...selected, option.id] : selected.filter((id) => id !== option.id),
                )
              }}
            />
          </OptionRow>
        ))}
      </fieldset>
      {correctOptionIds === null && (
        <Button type="button" size="lg" disabled={locked} onClick={() => onCommit(selected)}>
          {submitting ? t('checking') : t('confirm')}
        </Button>
      )}
    </div>
  )
}

type OptionRowProps = {
  id: string
  text: string
  locked: boolean
  selected: boolean
  correctOptionIds: string[] | null
  onActivate: (() => void) | undefined
  children: React.ReactNode
}

// The row is the label, so the whole line is the hit target and the control
// keeps its accessible name from the option text.
function OptionRow({
  id,
  text,
  locked,
  selected,
  correctOptionIds,
  onActivate,
  children,
}: OptionRowProps) {
  const t = useTranslations('run')
  const isCorrect = correctOptionIds?.includes(id) ?? false

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
        'flex w-full flex-wrap items-center gap-3 rounded-md border p-3 text-base font-normal',
        locked ? 'cursor-default' : 'cursor-pointer hover:bg-muted',
        isCorrect && 'border-primary bg-muted',
      )}
    >
      {children}
      <span className="min-w-0 flex-1 break-words">{text}</span>
      {/* Words and an icon, not colour: the verdict has to survive a
          monochrome screen and a colour-blind reader alike. */}
      {isCorrect && (
        <Badge variant="default">
          <CheckIcon aria-hidden="true" />
          {t('correctMark')}
        </Badge>
      )}
      {correctOptionIds !== null && selected && <Badge variant="outline">{t('yourAnswer')}</Badge>}
    </Label>
  )
}

// An author-supplied external URL: a plain <img> rather than next/image, which
// would need every host allow-listed. A fixed max height keeps a slow or
// oversized file from pushing the options off the screen, and a broken one
// disappears instead of leaving a torn frame. Nothing here gates answering.
function QuestionImage({ src }: { src: string }) {
  const [broken, setBroken] = useState(false)
  if (broken) return null

  return (
    // next/image would need every remote host allow-listed before a quiz with
    // an image could render at all, and the host set is whatever authors type.
    // biome-ignore lint/performance/noImgElement: author-supplied remote URL
    <img
      src={src}
      // Empty on purpose: the prompt carries the meaning, and an author-written
      // alt does not exist in the schema.
      alt=""
      decoding="async"
      onError={() => setBroken(true)}
      className="max-h-64 w-full rounded-md object-contain"
    />
  )
}
