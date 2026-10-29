import { act, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { RunSummary as RunSummaryData } from '@/lib/run/service'
import { renderWithMessages } from '@/test/intl'
import { type ComparisonState, type ReplayError, RunSummary } from './run-summary'

const mine: RunSummaryData = {
  attemptId: 'attempt-2',
  score: 9,
  errors: 3,
  total: 12,
  passed: true,
}

const theirs: RunSummaryData = {
  attemptId: 'attempt-1',
  score: 7,
  errors: 5,
  total: 12,
  passed: false,
}

function renderSummary(comparison?: ComparisonState) {
  return renderWithMessages(
    <RunSummary summary={mine} quizSlug="road-signs" comparison={comparison} reviewed={[]} />,
  )
}

function ready(overrides: Partial<{ opponentName: string; theirs: RunSummaryData }> = {}) {
  return {
    status: 'ready',
    opponentName: 'Ada',
    mine,
    theirs,
    ...overrides,
  } satisfies ComparisonState
}

// The head-to-head block restates the challenger's own score, which the summary
// header above already shows, so every assertion about it is scoped to it.
function headToHead() {
  const section = screen.getByRole('heading', { name: 'Head to head' }).closest('section')
  if (!section) throw new Error('no head-to-head section')
  return section
}

describe('run summary with a comparison', () => {
  it('shows both scores once a comparison is supplied', () => {
    renderSummary(ready())

    expect(within(headToHead()).getByText('You')).toBeVisible()
    expect(within(headToHead()).getByText('9 of 12 correct')).toBeVisible()
    expect(within(headToHead()).getByText('Ada')).toBeVisible()
    expect(within(headToHead()).getByText('7 of 12 correct')).toBeVisible()
  })

  it('says who won', () => {
    renderSummary(ready())

    expect(within(headToHead()).getByText('You won')).toBeVisible()
  })

  it('says who won when the opponent did', () => {
    renderSummary(ready({ theirs: { ...theirs, score: 11 } }))

    expect(within(headToHead()).getByText('Ada won')).toBeVisible()
    expect(within(headToHead()).queryByText('You won')).not.toBeInTheDocument()
  })

  it('handles a draw', () => {
    renderSummary(ready({ theirs: { ...theirs, score: mine.score } }))

    expect(within(headToHead()).getByText('A draw')).toBeVisible()
    expect(within(headToHead()).queryByText('You won')).not.toBeInTheDocument()
    expect(within(headToHead()).queryByText('Ada won')).not.toBeInTheDocument()
    // Both sides are still shown: a draw is a result, not a missing one.
    expect(within(headToHead()).getAllByText('9 of 12 correct')).toHaveLength(2)
  })

  it('renders a hostile nickname as literal text', () => {
    const hostile = '<script>alert(1)</script>'
    // Winning puts the name in the verdict line as well as the score row.
    const { container } = renderSummary(
      ready({ opponentName: hostile, theirs: { ...theirs, score: 11 } }),
    )

    // The payload is on the page as characters, and as nothing else.
    expect(container.querySelector('script')).toBeNull()
    expect(within(headToHead()).getByText(hostile)).toBeVisible()
    expect(within(headToHead()).getByText(`${hostile} won`)).toBeVisible()
  })

  it('renders an ordinary run unchanged when no comparison is supplied', () => {
    renderSummary()

    expect(screen.getByRole('heading', { name: /Passed/ })).toBeVisible()
    expect(screen.getByText('9 of 12 correct · 3 mistakes')).toBeVisible()
    expect(screen.getByRole('textbox', { name: 'Challenge link' })).toHaveValue(
      'http://localhost:3000/c/attempt-2',
    )
    expect(screen.queryByText('Head to head')).not.toBeInTheDocument()
    expect(screen.queryByText('You won')).not.toBeInTheDocument()
    expect(screen.queryByText('Comparing your scores…')).not.toBeInTheDocument()
  })

  it('offers the challenger their own link to pass on', () => {
    renderSummary(ready())

    // attempt-2, the run just played — not attempt-1, the one it answered.
    expect(screen.getByRole('textbox', { name: 'Challenge link' })).toHaveValue(
      'http://localhost:3000/c/attempt-2',
    )
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeVisible()
  })

  it('says the comparison is on its way rather than showing a gap', () => {
    renderSummary({ status: 'pending' })

    expect(screen.getByText('Comparing your scores…')).toBeVisible()
    // The run's own result does not wait for it.
    expect(screen.getByRole('heading', { name: /Passed/ })).toBeVisible()
    expect(screen.queryByText('Head to head')).not.toBeInTheDocument()
  })

  it('offers a retry when the comparison failed', async () => {
    const retry = vi.fn()
    renderSummary({ status: 'failed', retry })

    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('The scores could not be compared')
    // The result and the share link survived: a failed comparison is not a
    // dead end, it is a missing panel.
    expect(screen.getByText('9 of 12 correct · 3 mistakes')).toBeVisible()
    expect(screen.getByRole('textbox', { name: 'Challenge link' })).toBeVisible()

    await userEvent.click(within(alert).getByRole('button', { name: 'Try again' }))

    expect(retry).toHaveBeenCalledTimes(1)
  })
})

describe('run summary play again', () => {
  function renderReplay(onPlayAgain?: () => Promise<ReplayError | null>) {
    return renderWithMessages(
      <RunSummary summary={mine} quizSlug="road-signs" reviewed={[]} onPlayAgain={onPlayAgain} />,
    )
  }

  // A promise the test settles by hand, to look at the screen while the
  // replay is still in flight.
  function deferred() {
    let settle: (value: ReplayError | null) => void = () => {}
    const promise = new Promise<ReplayError | null>((resolve) => {
      settle = resolve
    })
    return { promise, settle }
  }

  // Defends /c/[attemptId], which passes no callback: leaving for an ordinary
  // run there is a real navigation, and a button would do nothing.
  it('is a link to a new run when there is no callback', () => {
    renderReplay()

    expect(screen.getByRole('link', { name: 'Play again' })).toHaveAttribute(
      'href',
      '/q/road-signs/run',
    )
    expect(screen.queryByRole('button', { name: 'Play again' })).not.toBeInTheDocument()
  })

  // Defends the swap to an in-place replay: a link left behind would reload
  // the page and throw away the state the callback exists to keep.
  it('is a button that calls back once, and no longer a link, when there is a callback', async () => {
    const onPlayAgain = vi.fn().mockResolvedValue(null)
    renderReplay(onPlayAgain)

    expect(screen.queryByRole('link', { name: 'Play again' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Play again' }))

    expect(onPlayAgain).toHaveBeenCalledTimes(1)
  })

  // Defends the feedback while the request travels: without it the player
  // sees nothing happen and clicks again.
  it('says Starting and is disabled while the replay is in flight', async () => {
    const pending = deferred()
    renderReplay(() => pending.promise)

    await userEvent.click(screen.getByRole('button', { name: 'Play again' }))

    expect(screen.getByRole('button', { name: 'Starting…' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Play again' })).not.toBeInTheDocument()
  })

  // Defends against two attempts from an impatient player: the summary's own
  // in-flight flag (and the disabled attribute it drives) is all that stands
  // between a double click and two runs.
  it('calls back once on a double click', async () => {
    const pending = deferred()
    const onPlayAgain = vi.fn(() => pending.promise)
    renderReplay(onPlayAgain)

    await userEvent.dblClick(screen.getByRole('button', { name: 'Play again' }))

    expect(onPlayAgain).toHaveBeenCalledTimes(1)
  })

  // Two codes, not one: a hardcoded message would pass with either alone, and
  // only reading the code passes with both.
  it.each([
    ['rateLimited', 'You have started a lot of runs recently. Try again in a little while.'],
    ['notFound', 'That quiz is no longer available.'],
  ] as const)('shows the %s message and lets the player retry', async (code, message) => {
    const pending = deferred()
    renderReplay(() => pending.promise)

    await userEvent.click(screen.getByRole('button', { name: 'Play again' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    await act(async () => pending.settle(code))

    expect(screen.getByRole('alert')).toHaveTextContent(message)
    // Enabled and back to its idle label, so the failure is not a dead end.
    expect(screen.getByRole('button', { name: 'Play again' })).toBeEnabled()
  })

  // Defends the retry: the failure must clear and the callback must be
  // reachable a second time, not only look enabled.
  it('calls back again on a retry after a failure, and clears the message', async () => {
    const onPlayAgain = vi.fn<() => Promise<ReplayError | null>>()
    onPlayAgain.mockResolvedValueOnce('rateLimited').mockResolvedValueOnce(null)
    renderReplay(onPlayAgain)

    await userEvent.click(screen.getByRole('button', { name: 'Play again' }))
    expect(await screen.findByRole('alert')).toBeVisible()

    await userEvent.click(screen.getByRole('button', { name: 'Play again' }))

    expect(onPlayAgain).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it.each([
    ['without a callback', undefined],
    ['with a callback', () => Promise.resolve(null)],
  ] as const)('links back to the quiz %s', (_, onPlayAgain) => {
    renderReplay(onPlayAgain)

    expect(screen.getByRole('link', { name: 'Back to the quiz' })).toHaveAttribute(
      'href',
      '/q/road-signs',
    )
  })
})
