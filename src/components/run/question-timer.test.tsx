import { act, screen } from '@testing-library/react'
import { useState } from 'react'
import { TIMER_GRACE_MS } from '@/lib/run/engine'
import { renderWithMessages } from '@/test/intl'
import { QuestionTimer } from './question-timer'

const onExpire = vi.fn()
const STARTED_AT = 1_700_000_000_000
const LIMIT_SEC = 10

// `running` is flipped by the player the moment an answer is submitted, so the
// harness drives it the same way rather than re-rendering from outside.
function TimerHarness({ timePerQuestionSec }: { timePerQuestionSec: number | null }) {
  const [running, setRunning] = useState(true)

  return (
    <>
      <QuestionTimer
        timePerQuestionSec={timePerQuestionSec}
        startedAt={STARTED_AT}
        running={running}
        onExpire={onExpire}
      />
      <button type="button" onClick={() => setRunning(false)}>
        submit
      </button>
    </>
  )
}

function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms)
  })
}

function submitAnswer() {
  act(() => {
    screen.getByRole('button', { name: 'submit' }).click()
  })
}

function timerText() {
  return screen.getByRole('timer').textContent
}

beforeEach(() => {
  vi.clearAllMocks()
  // Fakes Date as well as the timers, which is what lets the countdown be
  // driven forwards without waiting for real seconds.
  vi.useFakeTimers()
  vi.setSystemTime(STARTED_AT)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('question timer', () => {
  it('does not render when timePerQuestionSec is null', () => {
    const { container } = renderWithMessages(<TimerHarness timePerQuestionSec={null} />)

    expect(screen.queryByRole('timer')).not.toBeInTheDocument()
    // Nothing at all, not a hidden or empty frame where the clock would be.
    expect(container.querySelectorAll('p')).toHaveLength(0)

    advance(60_000)
    expect(onExpire).not.toHaveBeenCalled()
  })

  it('counts down while the question is unanswered', () => {
    renderWithMessages(<TimerHarness timePerQuestionSec={LIMIT_SEC} />)

    expect(timerText()).toBe('10s left')

    advance(3_000)
    expect(timerText()).toBe('7s left')

    advance(4_000)
    expect(timerText()).toBe('3s left')
  })

  it('freezes once an answer is submitted', () => {
    renderWithMessages(<TimerHarness timePerQuestionSec={LIMIT_SEC} />)

    advance(4_000)
    expect(timerText()).toBe('6s left')

    submitAnswer()

    // Reading the explanation is untimed by design: well past the limit, the
    // display is still where the answer left it and nothing auto-submits.
    advance(30_000)
    expect(timerText()).toBe('6s left')
    expect(onExpire).not.toHaveBeenCalled()
  })

  it('auto-submits an empty answer at zero', () => {
    renderWithMessages(<TimerHarness timePerQuestionSec={LIMIT_SEC} />)

    advance(LIMIT_SEC * 1000)
    // "Last chance", not "Time is up": an answer landed now still counts, and
    // a countdown that claims otherwise is a lie the player can catch.
    expect(timerText()).toBe('Last chance')
    // Still inside the grace the server allows, so the player can still land a
    // Confirm and nothing has fired yet.
    expect(onExpire).not.toHaveBeenCalled()

    advance(TIMER_GRACE_MS + 1_000)
    expect(onExpire).toHaveBeenCalledTimes(1)

    // Once only: a second call would post a second answer for the same question.
    advance(30_000)
    expect(onExpire).toHaveBeenCalledTimes(1)
  })
})
