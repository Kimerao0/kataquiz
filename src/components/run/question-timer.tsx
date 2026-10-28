'use client'

import { useTranslations } from 'next-intl'
import { useEffect, useRef, useState } from 'react'
import { TIMER_GRACE_MS } from '@/lib/run/engine'

// Sub-second, so the countdown never visibly skips a number and the auto-submit
// lands promptly once the deadline passes.
const TICK_MS = 250

type QuestionTimerProps = {
  timePerQuestionSec: number | null
  /** Epoch ms the current question was shown at. Changing it restarts the clock. */
  startedAt: number
  /** False freezes the display where it stands: reading the explanation is untimed. */
  running: boolean
  onExpire: () => void
}

export function QuestionTimer({
  timePerQuestionSec,
  startedAt,
  running,
  onExpire,
}: QuestionTimerProps) {
  const t = useTranslations('run')
  const [now, setNow] = useState(startedAt)

  // The callback changes identity on every render of the player, and listing it
  // as a dependency would tear down and rebuild the interval each time — which
  // is how a countdown ends up never advancing. The ref keeps the dependency
  // array honest about what actually restarts the clock.
  const onExpireRef = useRef(onExpire)
  useEffect(() => {
    onExpireRef.current = onExpire
  })

  useEffect(() => {
    if (timePerQuestionSec === null || !running) return

    // The server calls it a timeout only beyond limit + TIMER_GRACE_MS, so the
    // auto-submit waits for that moment rather than firing at the zero the
    // player sees. The grace is the last chance to land a Confirm, and the
    // elapsed time reported is the real one either way.
    const deadline = startedAt + timePerQuestionSec * 1000 + TIMER_GRACE_MS
    let expired = false

    const tick = () => {
      const current = Date.now()
      setNow(current)
      if (expired || current <= deadline) return
      expired = true
      onExpireRef.current()
    }

    tick()
    const id = setInterval(tick, TICK_MS)
    return () => clearInterval(id)
  }, [timePerQuestionSec, startedAt, running])

  if (timePerQuestionSec === null) return null

  const remainingMs = startedAt + timePerQuestionSec * 1000 - now
  const seconds = Math.max(0, Math.ceil(remainingMs / 1000))

  return (
    // role="timer" is a live region that defaults to aria-live="off": a value
    // announced every second would bury the prompt a screen reader is on.
    <p
      role="timer"
      aria-label={t('timerLabel')}
      className="text-muted-foreground text-sm tabular-nums"
    >
      {seconds === 0 ? t('timeUp') : t('timeLeft', { seconds })}
    </p>
  )
}
