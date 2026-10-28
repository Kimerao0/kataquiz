import { act, fireEvent, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TIMER_GRACE_MS } from '@/lib/run/engine'
import type { AnswerResult, PublicQuestion, RunStart, RunSummary } from '@/lib/run/service'
import { renderWithMessages } from '@/test/intl'
import { RunPlayer } from './run-player'

const { submitAnswerAction } = vi.hoisted(() => ({ submitAnswerAction: vi.fn() }))

// A factory mock, so the real module — and the pg Pool it builds at import
// time through @/lib/run/service — never loads in jsdom. The action has its
// own tests against the service.
vi.mock('@/app/(app)/q/[slug]/actions', () => ({ submitAnswerAction }))

const single: PublicQuestion = {
  id: 'q1',
  type: 'single',
  prompt: 'What does a red triangular sign mean?',
  imageUrl: null,
  options: [
    { id: 'o1', text: 'Warning' },
    { id: 'o2', text: 'Prohibition' },
  ],
}

const second: PublicQuestion = {
  id: 'q2',
  type: 'single',
  prompt: 'What colour is a stop sign?',
  imageUrl: null,
  options: [
    { id: 'p1', text: 'Red' },
    { id: 'p2', text: 'Blue' },
  ],
}

const multi: PublicQuestion = {
  id: 'q3',
  type: 'multi',
  prompt: 'Which of these warn of danger?',
  imageUrl: null,
  options: [
    { id: 'm1', text: 'Triangle' },
    { id: 'm2', text: 'Circle' },
    { id: 'm3', text: 'Square' },
  ],
}

const summary: RunSummary = {
  attemptId: 'attempt-1',
  score: 2,
  errors: 0,
  total: 2,
  passed: true,
}

function runOf(question: PublicQuestion, overrides: Partial<RunStart> = {}): RunStart {
  return { attemptId: 'attempt-1', question, total: 2, timePerQuestionSec: null, ...overrides }
}

function resultOf(overrides: Partial<AnswerResult> = {}): AnswerResult {
  return {
    correct: true,
    timedOut: false,
    correctOptionIds: ['o1'],
    explanation: null,
    theoryUrl: null,
    next: second,
    summary: null,
    ...overrides,
  }
}

function renderRun(question: PublicQuestion, overrides?: Partial<RunStart>) {
  return renderWithMessages(<RunPlayer run={runOf(question, overrides)} quizSlug="road-signs" />)
}

function option(name: string) {
  return screen.getByRole('radio', { name })
}

// The row is the <label> that owns the control, so it is where the per-option
// verdict badges land.
function rowOf(text: string) {
  const row = screen.getByText(text).closest('label')
  if (!row) throw new Error(`no option row for ${text}`)
  return row
}

beforeEach(() => {
  vi.clearAllMocks()
  submitAnswerAction.mockResolvedValue({ ok: true, result: resultOf() })
})

describe('run player', () => {
  it('renders the first question and its options', () => {
    renderRun(single)

    expect(screen.getByRole('heading', { name: single.prompt })).toBeVisible()
    expect(option('Warning')).toBeVisible()
    expect(option('Prohibition')).toBeVisible()
    expect(screen.getByText('Question 1 of 2')).toBeVisible()
    // Nothing is given away before the answer: no verdict anywhere on screen.
    expect(screen.queryByText('Correct answer')).not.toBeInTheDocument()
  })

  it('renders a script tag in a prompt as literal text', async () => {
    const hostile = '<script>alert(1)</script> Which sign?'
    const { container } = renderWithMessages(
      <RunPlayer run={runOf({ ...single, prompt: hostile })} quizSlug="road-signs" />,
    )

    // The payload is on the page as characters, and as nothing else: no
    // element was parsed out of it, and the text node still reads literally.
    expect(screen.getByRole('heading', { name: hostile })).toBeVisible()
    expect(container.querySelector('script')).toBeNull()
    expect(screen.getByText(hostile)).toHaveTextContent('<script>alert(1)</script>', {
      normalizeWhitespace: false,
    })
  })

  it('submits a single-choice answer on click', async () => {
    renderRun(single)

    await userEvent.click(option('Warning'))

    expect(submitAnswerAction).toHaveBeenCalledTimes(1)
    expect(submitAnswerAction).toHaveBeenCalledWith({
      attemptId: 'attempt-1',
      questionId: 'q1',
      selectedOptionIds: ['o1'],
      elapsedMs: expect.any(Number),
    })
  })

  it('does not submit a multi question until Confirm is pressed', async () => {
    renderRun(multi)

    await userEvent.click(screen.getByRole('checkbox', { name: 'Triangle' }))
    await userEvent.click(screen.getByRole('checkbox', { name: 'Square' }))

    // Two ticks and no round trip: only the player knows the set is finished.
    expect(submitAnswerAction).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: 'Confirm answer' }))

    expect(submitAnswerAction).toHaveBeenCalledTimes(1)
    expect(submitAnswerAction).toHaveBeenCalledWith(
      expect.objectContaining({ questionId: 'q3', selectedOptionIds: ['m1', 'm3'] }),
    )
  })

  it('shows the explanation and theory link after answering', async () => {
    submitAnswerAction.mockResolvedValue({
      ok: true,
      result: resultOf({
        explanation: 'Triangular signs warn of danger ahead.',
        theoryUrl: 'https://example.com/signs',
      }),
    })
    renderRun(single)

    await userEvent.click(option('Warning'))

    expect(await screen.findByText('Correct')).toBeVisible()
    expect(screen.getByText('Triangular signs warn of danger ahead.')).toBeVisible()
    expect(screen.getByRole('link', { name: 'Read the theory' })).toHaveAttribute(
      'href',
      'https://example.com/signs',
    )
  })

  it.each([
    ['javascript:alert(1)'],
    ['data:text/html,<script>alert(1)</script>'],
    ['vbscript:msgbox(1)'],
  ])('does not render %s as a theory link', async (hostileUrl) => {
    // Upload validation rejects these, so this is the second line of defence.
    // It matters because the Milestone 2 editor writes the same column, and a
    // javascript: href would run in the player's own session.
    submitAnswerAction.mockResolvedValue({
      ok: true,
      result: resultOf({ explanation: 'Why.', theoryUrl: hostileUrl }),
    })
    renderRun(single)

    await userEvent.click(option('Warning'))

    expect(await screen.findByText('Why.')).toBeVisible()
    expect(screen.queryByRole('link', { name: 'Read the theory' })).toBeNull()
  })

  it('shows the correct options after a wrong answer', async () => {
    submitAnswerAction.mockResolvedValue({
      ok: true,
      result: resultOf({ correct: false, correctOptionIds: ['o2'] }),
    })
    renderRun(single)

    await userEvent.click(option('Warning'))

    expect(await screen.findByText('Wrong')).toBeVisible()
    // Marked on the option itself, in words rather than by colour…
    expect(within(rowOf('Prohibition')).getByText('Correct answer')).toBeVisible()
    expect(within(rowOf('Warning')).getByText('Your answer')).toBeVisible()
    expect(within(rowOf('Warning')).queryByText('Correct answer')).not.toBeInTheDocument()
    // …and restated where the eye already is.
    expect(screen.getByText('The correct answer: Prohibition')).toBeVisible()
  })

  it('disables the options while a submission is in flight', async () => {
    // Never resolves: the request is still out, which is the state a double
    // click actually lands in.
    submitAnswerAction.mockReturnValue(new Promise(() => {}))
    renderRun(single)

    await userEvent.click(option('Warning'))

    // base-ui radios are spans, so the lock is aria-disabled rather than the
    // disabled attribute a native input would carry.
    expect(option('Warning')).toHaveAttribute('aria-disabled', 'true')
    expect(option('Prohibition')).toHaveAttribute('aria-disabled', 'true')

    await userEvent.click(option('Prohibition'))
    await userEvent.click(option('Warning'))

    // The guard, not just the styling: still exactly one answer posted.
    expect(submitAnswerAction).toHaveBeenCalledTimes(1)
  })

  it('advances to the next question after Next', async () => {
    renderRun(single)

    await userEvent.click(option('Warning'))
    await userEvent.click(await screen.findByRole('button', { name: 'Next question' }))

    expect(screen.getByRole('heading', { name: second.prompt })).toBeVisible()
    expect(screen.getByText('Question 2 of 2')).toBeVisible()
    // A fresh question, with no trace of the last verdict.
    expect(screen.queryByText('Correct')).not.toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Red' })).not.toHaveAttribute('aria-disabled', 'true')
  })

  it('shows the summary after the final question', async () => {
    submitAnswerAction.mockResolvedValue({
      ok: true,
      result: resultOf({ next: null, summary }),
    })
    renderRun(single)

    await userEvent.click(option('Warning'))
    await userEvent.click(await screen.findByRole('button', { name: 'See your result' }))

    expect(screen.getByRole('heading', { name: /Passed/ })).toBeVisible()
    expect(screen.getByText('2 of 2 correct · no mistakes')).toBeVisible()
    expect(screen.getByRole('textbox', { name: 'Challenge link' })).toHaveValue(
      'http://localhost:3000/c/attempt-1',
    )
  })

  it('surfaces a submit error with a retry that works', async () => {
    submitAnswerAction
      .mockRejectedValueOnce(new Error('fetch failed'))
      .mockResolvedValueOnce({ ok: true, result: resultOf({ explanation: 'Because.' }) })
    renderRun(single)

    await userEvent.click(option('Warning'))

    expect(await screen.findByRole('alert')).toHaveTextContent('Your answer did not reach')
    // The options come back: the answer never landed, so the run is not stuck.
    expect(option('Warning')).not.toHaveAttribute('aria-disabled', 'true')

    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))

    expect(await screen.findByText('Because.')).toBeVisible()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(submitAnswerAction).toHaveBeenCalledTimes(2)
    // Replayed verbatim, elapsedMs included: a retry must not turn an answer
    // given in time into a timeout.
    expect(submitAnswerAction.mock.calls[1][0]).toEqual(submitAnswerAction.mock.calls[0][0])
  })

  it('offers a way out instead of a retry when the answer already landed', async () => {
    submitAnswerAction.mockResolvedValue({ ok: false, error: 'duplicate' })
    renderRun(single)

    await userEvent.click(option('Warning'))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('This question was already answered')
    // Retrying a duplicate only produces another duplicate.
    expect(within(alert).queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument()
    expect(within(alert).getByRole('link', { name: 'Start a new run' })).toHaveAttribute(
      'href',
      '/q/road-signs/run',
    )
  })

  it('auto-submits whatever is selected when the clock runs out', async () => {
    vi.useFakeTimers()
    try {
      renderWithMessages(
        <RunPlayer run={runOf(multi, { timePerQuestionSec: 5 })} quizSlug="road-signs" />,
      )

      // fireEvent rather than userEvent: userEvent's own waits and the fake
      // clock deadlock each other.
      fireEvent.click(screen.getByRole('checkbox', { name: 'Triangle' }))
      expect(submitAnswerAction).not.toHaveBeenCalled()

      // Past the limit and past the grace the server allows for it.
      await act(async () => {
        vi.advanceTimersByTime(5_000 + TIMER_GRACE_MS + 1_000)
      })

      expect(submitAnswerAction).toHaveBeenCalledTimes(1)
      // Whatever was ticked but never confirmed, and the honest elapsed time:
      // the server, not this component, decides that it timed out.
      expect(submitAnswerAction).toHaveBeenCalledWith(
        expect.objectContaining({ questionId: 'q3', selectedOptionIds: ['m1'] }),
      )
      expect(submitAnswerAction.mock.calls[0][0].elapsedMs).toBeGreaterThan(5_000 + TIMER_GRACE_MS)
    } finally {
      vi.useRealTimers()
    }
  })
})
