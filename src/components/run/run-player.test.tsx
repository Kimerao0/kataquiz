import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TIMER_GRACE_MS } from '@/lib/run/engine'
import type {
  AnswerResult,
  PublicQuestion,
  RunHistoryEntry,
  RunStart,
  RunSummary,
} from '@/lib/run/service'
import { renderWithMessages } from '@/test/intl'
import { ADVANCE_LOCK_MS, RunPlayer } from './run-player'

const { submitAnswerAction, resumeRunAction, fetchChallengeComparisonAction } = vi.hoisted(() => ({
  submitAnswerAction: vi.fn(),
  resumeRunAction: vi.fn(),
  fetchChallengeComparisonAction: vi.fn(),
}))

// A factory mock, so the real module — and the pg Pool it builds at import
// time through @/lib/run/service — never loads in jsdom. The action has its
// own tests against the service.
vi.mock('@/app/(app)/q/[slug]/actions', () => ({ submitAnswerAction, resumeRunAction }))

// Imported by the player for the challenge reveal, and reached by the same pg
// Pool if it were allowed to load for real.
vi.mock('@/app/c/[attemptId]/actions', () => ({ fetchChallengeComparisonAction }))

const single: PublicQuestion = {
  id: 'q1',
  type: 'single',
  prompt: 'What does a red triangular sign mean?',
  imageUrl: null,
  code: null,
  codeLanguage: null,
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
  code: null,
  codeLanguage: null,
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
  code: null,
  codeLanguage: null,
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

// One question already graded and correct, as the server hands it back.
const priorStroke: RunHistoryEntry = {
  question: single,
  selectedOptionIds: ['o1'],
  result: {
    correct: true,
    timedOut: false,
    correctOptionIds: ['o1'],
    explanation: null,
    theoryUrl: null,
    next: null,
    summary: null,
  },
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

// Option input is ignored for ADVANCE_LOCK_MS after the run advances, so a
// test that answers the next question has to let that elapse first. Waiting on
// the lock to lift is also the proof that it lifts on its own.
async function optionAfterAdvance(name: string) {
  const radio = option(name)
  await waitFor(() => expect(radio).not.toHaveAttribute('aria-disabled', 'true'))
  return radio
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
  resumeRunAction.mockResolvedValue({ ok: false, error: 'gone' })
  fetchChallengeComparisonAction.mockResolvedValue({
    ok: true,
    comparison: {
      mine: summary,
      theirs: { attemptId: 'attempt-0', score: 1, errors: 1, total: 2, passed: false },
    },
  })
})

describe('run player', () => {
  it('renders the first question and its options', () => {
    renderRun(single)

    expect(screen.getByRole('heading', { name: single.prompt })).toBeVisible()
    expect(option('Warning')).toBeVisible()
    expect(option('Prohibition')).toBeVisible()
    // The tally draws the position; this sentence is what carries it to a
    // screen reader, and it is deliberately not on screen.
    expect(screen.getByText('Question 1 of 2')).toBeInTheDocument()
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

  it('rings the tapped option, by its text, while its answer is in flight', async () => {
    // Never settles: the moment under test is the gap before the verdict.
    submitAnswerAction.mockReturnValue(new Promise(() => {}))
    renderRun(single)

    // The text, not the radio: a tap on the words commits from the label's own
    // handler and locks the row before the click reaches the input, so the
    // input's change handler never runs.
    await userEvent.click(screen.getByText('Warning'))

    const tapped = option('Warning').closest('label')
    expect(tapped).toHaveClass('ring-ai')
    expect(tapped).not.toHaveClass('opacity-60')
    expect(option('Prohibition').closest('label')).toHaveClass('opacity-60')
  })

  it('lands a verdict tapped by text: the right row pops, the wrong pick shakes', async () => {
    submitAnswerAction.mockResolvedValue({
      ok: true,
      result: resultOf({ correct: false, correctOptionIds: ['o1'] }),
    })
    renderRun(single)

    await userEvent.click(screen.getByText('Prohibition'))

    // By pattern: once graded, each row's name also carries its verdict.
    const row = (name: RegExp) => screen.getByRole('radio', { name }).closest('label')
    await waitFor(() => expect(row(/Prohibition/)).toHaveClass('animate-verdict-shake'))
    expect(row(/Warning/)).toHaveClass('animate-verdict-pop')
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
    // Marked on the row itself. What is on screen there is a mark in the
    // gutter and a struck line; these words are the same verdict for a screen
    // reader, so the assertion is about the row's text and not its visibility
    // — jsdom loads no CSS and could not tell those apart anyway.
    expect(rowOf('Prohibition')).toHaveTextContent('Correct answer')
    expect(rowOf('Warning')).toHaveTextContent('Your answer')
    expect(within(rowOf('Warning')).queryByText('Correct answer')).not.toBeInTheDocument()
    // Not restated underneath: the rows above already say it, and repeating
    // it in the explanation was the loudest thing on the screen.
    expect(screen.queryByText(/The correct answer/)).not.toBeInTheDocument()
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
    expect(screen.getByText('Question 2 of 2')).toBeInTheDocument()
    // A fresh question, with no trace of the last verdict.
    expect(screen.queryByText('Correct')).not.toBeInTheDocument()
    // Answerable again once the brief post-advance lock has lifted, which it
    // does without any further input.
    await optionAfterAdvance('Red')
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

  it('never asks for a comparison on an ordinary run', async () => {
    submitAnswerAction.mockResolvedValue({ ok: true, result: resultOf({ next: null, summary }) })
    renderRun(single)

    await userEvent.click(option('Warning'))
    await userEvent.click(await screen.findByRole('button', { name: 'See your result' }))

    expect(fetchChallengeComparisonAction).not.toHaveBeenCalled()
    expect(screen.queryByText('Head to head')).not.toBeInTheDocument()
  })

  it('asks for the comparison only after the final answer of a challenge run', async () => {
    renderWithMessages(
      <RunPlayer run={runOf(single)} quizSlug="road-signs" challenge={{ opponentName: 'Ada' }} />,
    )

    // First answer of two: the run is not finished, so the opponent's score is
    // not asked for and cannot be on the page.
    await userEvent.click(option('Warning'))
    await screen.findByRole('button', { name: 'Next question' })
    expect(fetchChallengeComparisonAction).not.toHaveBeenCalled()

    submitAnswerAction.mockResolvedValue({ ok: true, result: resultOf({ next: null, summary }) })
    await userEvent.click(screen.getByRole('button', { name: 'Next question' }))
    await userEvent.click(await optionAfterAdvance('Red'))

    expect(fetchChallengeComparisonAction).toHaveBeenCalledTimes(1)
    expect(fetchChallengeComparisonAction).toHaveBeenCalledWith({ attemptId: 'attempt-1' })

    await userEvent.click(await screen.findByRole('button', { name: 'See your result' }))

    expect(await screen.findByText('Head to head')).toBeVisible()
    expect(screen.getByText('You won')).toBeVisible()
  })

  it('offers a retry when the comparison cannot be loaded', async () => {
    fetchChallengeComparisonAction.mockRejectedValueOnce(new Error('fetch failed'))
    submitAnswerAction.mockResolvedValue({ ok: true, result: resultOf({ next: null, summary }) })
    renderWithMessages(
      <RunPlayer run={runOf(single)} quizSlug="road-signs" challenge={{ opponentName: 'Ada' }} />,
    )

    await userEvent.click(option('Warning'))
    await userEvent.click(await screen.findByRole('button', { name: 'See your result' }))

    // The run's own result survived the failure: only the comparison is missing.
    expect(screen.getByText('2 of 2 correct · no mistakes')).toBeVisible()
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('The scores could not be compared')

    await userEvent.click(within(alert).getByRole('button', { name: 'Try again' }))

    expect(await screen.findByText('Head to head')).toBeVisible()
    expect(fetchChallengeComparisonAction).toHaveBeenCalledTimes(2)
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

  it('offers to resume instead of a retry when the answer already landed', async () => {
    submitAnswerAction.mockResolvedValue({ ok: false, error: 'duplicate' })
    renderRun(single)

    await userEvent.click(option('Warning'))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('This question was already answered')
    // Retrying a duplicate only produces another duplicate.
    expect(within(alert).queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument()
    // The answer landed, so the run is alive: the way out is to pick it up, not
    // to abandon it for a new one.
    expect(within(alert).getByRole('button', { name: 'Resume' })).toBeEnabled()
    expect(within(alert).queryByRole('link', { name: 'Start a new run' })).not.toBeInTheDocument()
  })

  it('opens a resumed run where the server left it', () => {
    renderWithMessages(
      <RunPlayer
        run={runOf(second)}
        quizSlug="road-signs"
        resumed={{ answered: 1, history: [priorStroke] }}
      />,
    )

    expect(screen.getByRole('heading', { name: second.prompt })).toBeVisible()
    // Position and prior stroke together: without the history the tally would
    // read 0 correct, and without the offset it would read question 1.
    expect(screen.getByText('Question 2 of 2')).toBeInTheDocument()
    expect(screen.getByText('1 correct, 0 wrong')).toBeInTheDocument()
  })

  it('carries on where the server has the run after resuming from a duplicate', async () => {
    submitAnswerAction.mockResolvedValue({ ok: false, error: 'duplicate' })
    resumeRunAction.mockResolvedValue({
      ok: true,
      run: {
        status: 'playing',
        attemptId: 'attempt-1',
        question: second,
        total: 2,
        timePerQuestionSec: null,
        answered: 1,
        history: [priorStroke],
      },
    })
    renderRun(single)

    // Still on the first question, nothing yet counted.
    expect(screen.getByText('Question 1 of 2')).toBeInTheDocument()
    expect(screen.getByText('0 correct, 0 wrong')).toBeInTheDocument()

    await userEvent.click(option('Warning'))
    await userEvent.click(
      within(await screen.findByRole('alert')).getByRole('button', { name: 'Resume' }),
    )

    expect(await screen.findByRole('heading', { name: second.prompt })).toBeVisible()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByText('Question 2 of 2')).toBeInTheDocument()
    expect(screen.getByText('1 correct, 0 wrong')).toBeInTheDocument()
    expect(resumeRunAction).toHaveBeenCalledTimes(1)
    expect(resumeRunAction).toHaveBeenCalledWith({ slug: 'road-signs', attemptId: 'attempt-1' })
    // Answerable once the advance lock the resume sets has lifted on its own.
    await optionAfterAdvance('Red')
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

  // The keys are the point of the screen: a player drills with a hand on the
  // numbers, not on a mouse. What they must never do is answer by themselves.
  describe('the number keys', () => {
    it('highlights an option without answering it', async () => {
      renderRun(single)

      await userEvent.keyboard('2')

      expect(option('Prohibition')).toBeChecked()
      // The whole reason the second press exists: a habit of tapping a number
      // must not answer a question that was never read.
      expect(submitAnswerAction).not.toHaveBeenCalled()
    })

    it('answers on a second press of the same number', async () => {
      renderRun(single)

      await userEvent.keyboard('22')

      expect(submitAnswerAction).toHaveBeenCalledTimes(1)
      expect(submitAnswerAction).toHaveBeenCalledWith(
        expect.objectContaining({ questionId: 'q1', selectedOptionIds: ['o2'] }),
      )
    })

    it('moves the highlight when a different number is pressed', async () => {
      renderRun(single)

      await userEvent.keyboard('21')

      expect(option('Warning')).toBeChecked()
      expect(option('Prohibition')).not.toBeChecked()
      expect(submitAnswerAction).not.toHaveBeenCalled()
    })

    it('answers the highlighted option on Enter', async () => {
      renderRun(single)

      await userEvent.keyboard('2{Enter}')

      expect(submitAnswerAction).toHaveBeenCalledWith(
        expect.objectContaining({ selectedOptionIds: ['o2'] }),
      )
    })

    it('does nothing on Enter when nothing is highlighted', async () => {
      renderRun(single)

      await userEvent.keyboard('{Enter}')

      expect(submitAnswerAction).not.toHaveBeenCalled()
    })

    it('ignores a number with no option behind it, and ignores zero', async () => {
      renderRun(single)

      await userEvent.keyboard('90')

      expect(option('Warning')).not.toBeChecked()
      expect(option('Prohibition')).not.toBeChecked()
      expect(submitAnswerAction).not.toHaveBeenCalled()
    })

    it('ignores a key that is being held down', async () => {
      renderRun(single)

      // The first press of a hold selects; what must not happen is the repeat
      // stream behind it committing the selection it has just made.
      fireEvent.keyDown(window, { key: '2' })
      fireEvent.keyDown(window, { key: '2', repeat: true })
      fireEvent.keyDown(window, { key: '2', repeat: true })

      expect(option('Prohibition')).toBeChecked()
      expect(submitAnswerAction).not.toHaveBeenCalled()
    })

    it('toggles on a multi question and confirms on Enter', async () => {
      renderRun(multi)

      await userEvent.keyboard('13')
      expect(submitAnswerAction).not.toHaveBeenCalled()

      // The same key again is a toggle here, not a commit: the set is only
      // finished when the player says so.
      await userEvent.keyboard('3')
      await userEvent.keyboard('{Enter}')

      expect(submitAnswerAction).toHaveBeenCalledTimes(1)
      expect(submitAnswerAction).toHaveBeenCalledWith(
        expect.objectContaining({ questionId: 'q3', selectedOptionIds: ['m1'] }),
      )
    })

    it('advances on Enter once the feedback is up, and only once', async () => {
      renderRun(single)

      await userEvent.click(option('Warning'))
      await screen.findByRole('button', { name: 'Next question' })
      await userEvent.keyboard('{Enter}')

      // Two is what a double advance would look like: the Next button has
      // focus and turns Enter into a click of its own.
      expect(screen.getByRole('heading', { name: second.prompt })).toBeVisible()
      expect(screen.getByText('Question 2 of 2')).toBeInTheDocument()
    })

    it('advances on the right arrow as well', async () => {
      renderRun(single)

      await userEvent.click(option('Warning'))
      await screen.findByRole('button', { name: 'Next question' })
      await userEvent.keyboard('{ArrowRight}')

      expect(screen.getByRole('heading', { name: second.prompt })).toBeVisible()
    })

    it('does not answer the next question with a key held through the advance', async () => {
      renderRun(single)

      await userEvent.click(option('Warning'))
      await userEvent.click(await screen.findByRole('button', { name: 'Next question' }))

      // Straight after advancing, inside the input lock.
      fireEvent.keyDown(window, { key: '1' })
      fireEvent.keyDown(window, { key: '1' })

      expect(submitAnswerAction).toHaveBeenCalledTimes(1)
      expect(submitAnswerAction).toHaveBeenCalledWith(expect.objectContaining({ questionId: 'q1' }))
    })
  })

  // The Next button sits roughly where an option lands once the feedback panel
  // goes, so the second click of a double click can answer an unread question.
  describe('the input lock after advancing', () => {
    // Fake timers as in question-timer.test.tsx: the lock is a setTimeout, and
    // fireEvent rather than userEvent because userEvent's own waits and the
    // fake clock deadlock each other.
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    async function answerAndAdvance() {
      renderRun(single)
      fireEvent.click(option('Warning'))
      // Lets the mocked action resolve and the feedback panel render.
      await act(async () => {})
      fireEvent.click(screen.getByRole('button', { name: 'Next question' }))
      expect(screen.getByRole('heading', { name: second.prompt })).toBeVisible()
    }

    it('does not accept an option click immediately after advancing', async () => {
      await answerAndAdvance()

      fireEvent.click(screen.getByRole('radio', { name: 'Red' }))
      await act(async () => {})

      // Still only the answer to the first question: the stray click was
      // swallowed rather than posted as an answer to a question nobody read.
      expect(submitAnswerAction).toHaveBeenCalledTimes(1)
      expect(submitAnswerAction).toHaveBeenCalledWith(expect.objectContaining({ questionId: 'q1' }))
    })

    it('accepts the same click once the lock has elapsed', async () => {
      await answerAndAdvance()

      await act(async () => {
        vi.advanceTimersByTime(ADVANCE_LOCK_MS)
      })
      fireEvent.click(screen.getByRole('radio', { name: 'Red' }))
      await act(async () => {})

      expect(submitAnswerAction).toHaveBeenCalledTimes(2)
      expect(submitAnswerAction).toHaveBeenLastCalledWith(
        expect.objectContaining({ questionId: 'q2', selectedOptionIds: ['p1'] }),
      )
    })
  })

  // The summary only carries a score, so the review is the player's own record
  // of the run, and the tally is read from the same record.
  describe('the record of the run', () => {
    const third: PublicQuestion = {
      id: 'q4',
      type: 'single',
      prompt: 'Which side do you overtake on?',
      imageUrl: null,
      code: null,
      codeLanguage: null,
      options: [
        { id: 'r1', text: 'Left' },
        { id: 'r2', text: 'Right' },
      ],
    }

    it('lists a wrongly answered question in the review on the summary', async () => {
      submitAnswerAction
        .mockResolvedValueOnce({
          ok: true,
          result: resultOf({
            correct: false,
            correctOptionIds: ['o2'],
            explanation: 'A red triangle warns, it does not forbid.',
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          result: resultOf({
            correctOptionIds: ['p1'],
            next: null,
            summary: { ...summary, score: 1, errors: 1, passed: false },
          }),
        })
      renderRun(single)

      await userEvent.click(option('Warning'))
      await userEvent.click(await screen.findByRole('button', { name: 'Next question' }))
      await userEvent.click(await optionAfterAdvance('Red'))
      await userEvent.click(await screen.findByRole('button', { name: 'See your result' }))

      const review = screen.getByRole('heading', { name: 'Your run' }).closest('section')
      if (!review) throw new Error('no review section')
      // Both questions are there, and the first carries what the feedback panel
      // showed during the run: its verdict, the pick the player made, and the
      // explanation that is otherwise gone once the run moves on.
      const [firstEntry, secondEntry] = within(review).getAllByRole('listitem')
      expect(within(firstEntry).getByText(single.prompt)).toBeInTheDocument()
      expect(within(firstEntry).getByText('Wrong')).toBeInTheDocument()
      expect(
        within(firstEntry).getByText('A red triangle warns, it does not forbid.'),
      ).toBeVisible()
      expect(
        within(within(firstEntry).getByText('Your answer').parentElement as HTMLElement).getByText(
          'Warning',
        ),
      ).toBeInTheDocument()
      expect(within(secondEntry).getByText(second.prompt)).toBeInTheDocument()
      expect(within(secondEntry).getByText('Correct')).toBeInTheDocument()
    })

    it('marks correct and wrong answers in the tally as the run progresses', async () => {
      // Wrong, then right, then right: two correct against one wrong, so a
      // tally that swapped the two, or counted every answer as one kind, or
      // lagged a question behind, would each read differently at some step.
      submitAnswerAction
        .mockResolvedValueOnce({
          ok: true,
          result: resultOf({ correct: false, correctOptionIds: ['o2'] }),
        })
        .mockResolvedValueOnce({
          ok: true,
          result: resultOf({ correctOptionIds: ['p1'], next: third }),
        })
        .mockResolvedValueOnce({
          ok: true,
          result: resultOf({
            correctOptionIds: ['r1'],
            next: null,
            summary: { ...summary, total: 3, score: 2, errors: 1, passed: false },
          }),
        })
      renderRun(single, { total: 3 })

      expect(screen.getByText('0 correct, 0 wrong')).toBeInTheDocument()

      await userEvent.click(option('Warning'))
      expect(await screen.findByText('0 correct, 1 wrong')).toBeInTheDocument()

      await userEvent.click(screen.getByRole('button', { name: 'Next question' }))
      await userEvent.click(await optionAfterAdvance('Red'))
      expect(await screen.findByText('1 correct, 1 wrong')).toBeInTheDocument()

      await userEvent.click(screen.getByRole('button', { name: 'Next question' }))
      await userEvent.click(await optionAfterAdvance('Left'))
      expect(await screen.findByText('2 correct, 1 wrong')).toBeInTheDocument()
    })
  })
})
