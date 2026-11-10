import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { RunStart } from '@/lib/run/service'
import { renderWithMessages } from '@/test/intl'
import { ChallengeInvitePanel } from './challenge-invite-panel'

const {
  startChallengeRunAction,
  fetchChallengeComparisonAction,
  submitAnswerAction,
  resumeRunAction,
} = vi.hoisted(() => ({
  startChallengeRunAction: vi.fn(),
  fetchChallengeComparisonAction: vi.fn(),
  submitAnswerAction: vi.fn(),
  resumeRunAction: vi.fn(),
}))

// Factory mocks, so the real modules — and the pg Pool they build at import
// time through @/lib/run/challenge — never load in jsdom. Both actions have
// their own tests against the service.
vi.mock('@/app/c/[attemptId]/actions', () => ({
  startChallengeRunAction,
  fetchChallengeComparisonAction,
}))

// Reached by Resume, and once the run starts and RunPlayer mounts.
vi.mock('@/app/(app)/q/[slug]/actions', () => ({ submitAnswerAction, resumeRunAction }))

const run: RunStart = {
  attemptId: 'attempt-2',
  question: {
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
  },
  total: 12,
  timePerQuestionSec: null,
}

const resumable = { attemptId: 'attempt-old', answered: 3, total: 12 }

function renderPanel(overrides: Partial<Parameters<typeof ChallengeInvitePanel>[0]> = {}) {
  return renderWithMessages(
    <ChallengeInvitePanel
      attemptId="attempt-1"
      quizSlug="road-signs"
      opponentName="Ada"
      questionCount={12}
      askNickname={true}
      resumable={null}
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

  it('offers no resume when there is no run to pick up', () => {
    renderPanel({ resumable: null })

    expect(screen.queryByRole('button', { name: 'Resume' })).not.toBeInTheDocument()
    expect(screen.queryByText(/You left a run unfinished/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Take the challenge' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'Start over' })).not.toBeInTheDocument()
  })

  it('offers the unfinished challenge run and relabels the start as Start over', () => {
    renderPanel({ resumable })

    expect(screen.getByText('You left a run unfinished — 3 of 12 answered.')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Resume' })).toBeEnabled()
    // The label is the only thing telling the player that starting would not
    // continue the old run.
    expect(screen.getByRole('button', { name: 'Start over' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'Take the challenge' })).not.toBeInTheDocument()
  })

  it('hands a resumed run over to the player, mid-run', async () => {
    resumeRunAction.mockResolvedValue({
      ok: true,
      run: {
        status: 'playing',
        attemptId: 'attempt-old',
        question: run.question,
        total: 12,
        timePerQuestionSec: null,
        answered: 3,
        history: [],
      },
    })
    renderPanel({ resumable })

    await userEvent.click(screen.getByRole('button', { name: 'Resume' }))

    expect(await screen.findByRole('heading', { name: run.question.prompt })).toBeVisible()
    expect(resumeRunAction).toHaveBeenCalledTimes(1)
    expect(resumeRunAction).toHaveBeenCalledWith({ slug: 'road-signs', attemptId: 'attempt-old' })
    expect(startChallengeRunAction).not.toHaveBeenCalled()
    // The position is what proves the answered count reached the player; a
    // plain start would read question 1.
    expect(screen.getByText('Question 4 of 12')).toBeInTheDocument()
    // The panel is gone, not stacked under the run.
    expect(screen.queryByRole('button', { name: 'Start over' })).not.toBeInTheDocument()
  })

  it('takes the offer away when the server refuses the resume', async () => {
    resumeRunAction.mockResolvedValue({ ok: false, error: 'gone' })
    renderPanel({ resumable })

    await userEvent.click(screen.getByRole('button', { name: 'Resume' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('That run is no longer available. Take the challenge again.')
    expect(screen.queryByRole('button', { name: 'Resume' })).not.toBeInTheDocument()
    expect(screen.queryByText(/You left a run unfinished/)).not.toBeInTheDocument()
    // What is left is a challenge to take from the top, on a button that works.
    expect(screen.getByRole('button', { name: 'Take the challenge' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'Start over' })).not.toBeInTheDocument()
  })

  it('treats a run that finished meanwhile as gone', async () => {
    resumeRunAction.mockResolvedValue({
      ok: true,
      run: {
        status: 'finished',
        attemptId: 'attempt-old',
        summary: { attemptId: 'attempt-old', score: 7, errors: 3, total: 12, passed: true },
        answered: 12,
        history: [],
      },
    })
    renderPanel({ resumable })

    await userEvent.click(screen.getByRole('button', { name: 'Resume' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'That run is no longer available. Take the challenge again.',
    )
    expect(screen.queryByRole('button', { name: 'Resume' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Take the challenge' })).toBeEnabled()
  })

  it('leaves the offer on screen when the resume is rate limited', async () => {
    resumeRunAction.mockResolvedValue({ ok: false, error: 'rateLimited' })
    renderPanel({ resumable })

    await userEvent.click(screen.getByRole('button', { name: 'Resume' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('You have resumed runs a lot recently')
    // Unlike 'gone', only this request was refused: the run is still there, so
    // the offer stays and Resume can be tried again.
    expect(screen.getByRole('button', { name: 'Resume' })).toBeEnabled()
    expect(screen.getByText('You left a run unfinished — 3 of 12 answered.')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Start over' })).toBeEnabled()
  })

  // Defends R4.8: a challenge plays someone else's set, so its summary is no
  // step on a path, whatever paths the quiz is in.
  it('suggests no path step on the summary of a finished challenge run', async () => {
    submitAnswerAction.mockResolvedValue({
      ok: true,
      result: {
        correct: true,
        timedOut: false,
        correctOptionIds: ['o1'],
        explanation: null,
        theoryUrl: null,
        next: null,
        summary: { attemptId: 'attempt-2', score: 1, errors: 0, total: 1, passed: true },
      },
    })
    fetchChallengeComparisonAction.mockResolvedValue({
      ok: true,
      comparison: {
        mine: { attemptId: 'attempt-2', score: 1, errors: 0, total: 1, passed: true },
        theirs: { attemptId: 'attempt-1', score: 0, errors: 1, total: 1, passed: false },
      },
    })
    renderPanel({ askNickname: false })

    await userEvent.click(screen.getByRole('button', { name: 'Take the challenge' }))
    await userEvent.click(await screen.findByRole('radio', { name: 'Warning' }))
    await userEvent.click(await screen.findByRole('button', { name: 'See your result' }))

    expect(await screen.findByText('1 of 1 correct · no mistakes')).toBeVisible()
    expect(screen.queryByText(/Next in/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Last step of/)).not.toBeInTheDocument()
  })
})
