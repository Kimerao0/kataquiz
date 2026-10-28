import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { RunStart } from '@/lib/run/service'
import { renderWithMessages } from '@/test/intl'
import { ChallengeInvitePanel } from './challenge-invite-panel'

const { startChallengeRunAction, fetchChallengeComparisonAction, submitAnswerAction } = vi.hoisted(
  () => ({
    startChallengeRunAction: vi.fn(),
    fetchChallengeComparisonAction: vi.fn(),
    submitAnswerAction: vi.fn(),
  }),
)

// Factory mocks, so the real modules — and the pg Pool they build at import
// time through @/lib/run/challenge — never load in jsdom. Both actions have
// their own tests against the service.
vi.mock('@/app/c/[attemptId]/actions', () => ({
  startChallengeRunAction,
  fetchChallengeComparisonAction,
}))

// Reached once the run starts and RunPlayer mounts.
vi.mock('@/app/(app)/q/[slug]/actions', () => ({ submitAnswerAction }))

const run: RunStart = {
  attemptId: 'attempt-2',
  question: {
    id: 'q1',
    type: 'single',
    prompt: 'What does a red triangular sign mean?',
    imageUrl: null,
    options: [
      { id: 'o1', text: 'Warning' },
      { id: 'o2', text: 'Prohibition' },
    ],
  },
  total: 12,
  timePerQuestionSec: null,
}

function renderPanel(overrides: Partial<Parameters<typeof ChallengeInvitePanel>[0]> = {}) {
  return renderWithMessages(
    <ChallengeInvitePanel
      attemptId="attempt-1"
      quizSlug="road-signs"
      opponentName="Ada"
      questionCount={12}
      askNickname={true}
      {...overrides}
    />,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  startChallengeRunAction.mockResolvedValue({ ok: true, run })
})

describe('challenge invite panel', () => {
  it('shows who challenged you and the question count', () => {
    renderPanel()

    expect(screen.getByRole('heading', { name: 'Ada challenged you' })).toBeVisible()
    expect(screen.getByText('12 questions')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Take the challenge' })).toBeVisible()
  })

  it('shows no score anywhere before the run', () => {
    // The opponent of this fixture finished 9 of 12. Nothing on this screen may
    // carry that number, and nothing may carry a score at all: the invite the
    // server sends has no score field, so a 9 on the page could only come from
    // a second fetch somebody added.
    const { container } = renderPanel()

    const text = container.textContent ?? ''
    expect(text).not.toContain('9')
    // The question count is the only number this screen is allowed to carry.
    // The copy does say the word "score", which is the rule being explained,
    // so it is the digits that are asserted on rather than the vocabulary.
    expect(text.match(/\d+/g)).toEqual(['12'])
    expect(text).not.toMatch(/correct/i)
    expect(screen.queryByText(/passed/i)).not.toBeInTheDocument()
    // Not merely absent from the DOM: never asked for.
    expect(fetchChallengeComparisonAction).not.toHaveBeenCalled()
  })

  it('lets a signed-out visitor enter a nickname', async () => {
    renderPanel()

    await userEvent.type(screen.getByLabelText('Nickname'), 'Bea')
    await userEvent.click(screen.getByRole('button', { name: 'Take the challenge' }))

    expect(startChallengeRunAction).toHaveBeenCalledWith({
      attemptId: 'attempt-1',
      nickname: 'Bea',
    })
    // The run replaces the panel, same as the ordinary pre-run panel does.
    expect(await screen.findByRole('heading', { name: run.question.prompt })).toBeVisible()
  })

  it('asks a signed-in visitor for no nickname', async () => {
    renderPanel({ askNickname: false })

    expect(screen.queryByLabelText('Nickname')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Take the challenge' }))

    expect(startChallengeRunAction).toHaveBeenCalledWith({
      attemptId: 'attempt-1',
      nickname: undefined,
    })
  })

  it('renders a hostile opponent name as literal text', () => {
    const hostile = '<script>alert(1)</script>'
    const { container } = renderPanel({ opponentName: hostile })

    expect(container.querySelector('script')).toBeNull()
    expect(screen.getByRole('heading', { name: `${hostile} challenged you` })).toBeVisible()
  })

  it('offers the quiz instead of a dead Begin button when nothing is left to play', () => {
    renderPanel({ questionCount: 0 })

    expect(screen.getByRole('heading', { name: 'There is nothing left to play' })).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Take the challenge' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'See the quiz' })).toHaveAttribute(
      'href',
      '/q/road-signs',
    )
  })

  it('disables the button while the start is in flight', async () => {
    // Never resolves: the request is still out, which is the state a double
    // click actually lands in.
    startChallengeRunAction.mockReturnValue(new Promise(() => {}))
    renderPanel()

    await userEvent.click(screen.getByRole('button', { name: 'Take the challenge' }))

    const button = screen.getByRole('button', { name: 'Starting…' })
    expect(button).toBeDisabled()

    await userEvent.click(button)

    // The guard, not just the styling: still exactly one run started.
    expect(startChallengeRunAction).toHaveBeenCalledTimes(1)
  })

  it('explains a refused start and leaves the button usable', async () => {
    startChallengeRunAction.mockResolvedValue({ ok: false, error: 'rateLimited' })
    renderPanel()

    await userEvent.click(screen.getByRole('button', { name: 'Take the challenge' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'You have started a lot of runs recently',
    )
    expect(screen.getByRole('button', { name: 'Take the challenge' })).toBeEnabled()
  })

  it('explains a challenge whose questions are all gone', async () => {
    startChallengeRunAction.mockResolvedValue({ ok: false, error: 'empty' })
    renderPanel()

    await userEvent.click(screen.getByRole('button', { name: 'Take the challenge' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Every question from that run has since been removed',
    )
  })

  it('reports an unreachable server rather than failing silently', async () => {
    startChallengeRunAction.mockRejectedValue(new Error('fetch failed'))
    renderPanel()

    await userEvent.click(screen.getByRole('button', { name: 'Take the challenge' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('The server did not answer')
  })
})
