'use client'

import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'

/** What the server said about a question that has already been graded. */
export type TallyOutcome = 'correct' | 'wrong'

type RunTallyProps = {
  /** How many questions this run will serve, which is how many strokes there are. */
  total: number
  /** 1-based index of the question on screen. */
  position: number
  /** One entry per question already graded, in the order they were answered. */
  outcomes: TallyOutcome[]
}

type StrokeState = TallyOutcome | 'current' | 'pending'

/**
 * 正 is counted in five strokes, one per item, and it is how reps are actually
 * tallied. Drawn here as SVG rather than set as a glyph: each stroke has to
 * carry the state of one question, and a character in a font is one colour.
 *
 * Standard stroke order, in a 24×24 box: the top bar, the vertical, the
 * middle-left bar, the short left vertical, the bottom bar.
 */
const STROKES = ['M3 4 H21', 'M12 4 V20', 'M3 12 H12', 'M3 12 V20', 'M3 20 H21'] as const

const STROKES_PER_CHARACTER = STROKES.length

const STROKE_CLASS: Record<StrokeState, string> = {
  correct: 'stroke-ink',
  wrong: 'stroke-suo',
  current: 'stroke-ai',
  pending: 'stroke-rule',
}

function strokeStateOf(index: number, position: number, outcomes: TallyOutcome[]): StrokeState {
  // Graded first: the moment an answer lands, the stroke for the question in
  // hand stops being the current one and becomes its verdict.
  if (index < outcomes.length) return outcomes[index]
  if (index === position - 1) return 'current'
  return 'pending'
}

export function RunTally({ total, position, outcomes }: RunTallyProps) {
  const t = useTranslations('run')
  const correct = outcomes.filter((outcome) => outcome === 'correct').length
  const wrong = outcomes.length - correct
  const characters = Math.ceil(total / STROKES_PER_CHARACTER)

  return (
    // flex-1 takes the slack from the clock in the chrome row; in the drill
    // rail the two are stacked, and keeping it would stretch the tally down
    // the whole rail and strand the clock at the bottom of it.
    <p className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-2 sm:gap-x-2.5 xl:flex-none xl:gap-x-3 xl:gap-y-3">
      {/* The characters are a picture of this sentence, so they are hidden
          from assistive technology and the sentence carries the state. Two
          spans rather than one string: each half is a message of its own, and
          the paragraph reads as one line either way. */}
      <span className="sr-only">
        <span>{t('progress', { position, total })}</span>
        {', '}
        <span>{t('tallyCounts', { correct, wrong })}</span>
      </span>

      {Array.from({ length: characters }, (_, character) => (
        <svg
          // biome-ignore lint/suspicious/noArrayIndexKey: character n always counts questions 5n to 5n+4, so the index is the identity and the row never reorders
          key={character}
          aria-hidden="true"
          viewBox="0 0 24 24"
          // Sized by .tally-mark in globals.css: the character grows with the
          // viewport the way the question does, and grows again once the drill
          // rail gives it a wall. The strokes scale with it for free.
          className="tally-mark"
        >
          {STROKES.map((path, stroke) => {
            const index = character * STROKES_PER_CHARACTER + stroke
            // The last character of a run that is not a multiple of five is
            // left unfinished: a stroke standing for no question is a lie
            // about how long the run is.
            if (index >= total) return null
            const state = strokeStateOf(index, position, outcomes)

            return (
              <path
                key={path}
                d={path}
                fill="none"
                strokeLinecap="square"
                // Thicker as well as indigo, so the question in hand is not
                // told apart by colour alone.
                strokeWidth={state === 'current' ? 3 : 2}
                className={cn(STROKE_CLASS[state])}
              />
            )
          })}
        </svg>
      ))}
    </p>
  )
}
