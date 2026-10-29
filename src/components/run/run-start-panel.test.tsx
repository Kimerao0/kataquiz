import { fireEvent, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { PublicQuestion, RunStart } from '@/lib/run/service'
import { renderWithMessages } from '@/test/intl'
import { RunStartPanel } from './run-start-panel'

const { startRunAction, resumeRunAction, submitAnswerAction, fetchChallengeComparisonAction } =
  vi.hoisted(() => ({
    startRunAction: vi.fn(),
    resumeRunAction: vi.fn(),
    submitAnswerAction: vi.fn(),
    fetchChallengeComparisonAction: vi.fn(),
  }))

// Factory mocks, so the real modules — and the pg Pool they build at import
// time through @/lib/run/service — never load in jsdom. The real RunPlayer and
// RunSummary are rendered below: they load fine against these, and a stand-in
// could not prove the right props were handed over.
vi.mock('@/app/(app)/q/[slug]/actions', () => ({
  startRunAction,
  resumeRunAction,
  submitAnswerAction,
}))
vi.mock('@/app/c/[attemptId]/actions', () => ({ fetchChallengeComparisonAction }))

const question: PublicQuestion = {
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

const started: RunStart = {
  attemptId: 'attempt-new',
  question,
  total: 10,
  timePerQuestionSec: null,
}

const resumable = { attemptId: 'attempt-old', answered: 3, total: 10 }

function renderPanel(overrides: Partial<Parameters<typeof RunStartPanel>[0]> = {}) {
  return renderWithMessages(
    <RunStartPanel
      slug="road-signs"
      questionsPerRun={10}
      maxErrors={2}
      timePerQuestionSec={null}
      askNickname={false}
      resumable={null}
      {...overrides}
    />,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  startRunAction.mockResolvedValue({ ok: true, run: started })
})

describe('run start panel', () => {
  it('offers no resume when there is no run to pick up', () => {
    renderPanel({ resumable: null })

    expect(screen.queryByRole('button', { name: 'Resume' })).not.toBeInTheDocument()
    expect(screen.queryByText(/You left a run unfinished/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Begin' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'Start over' })).not.toBeInTheDocument()
  })

  it('offers the unfinished run and relabels Begin as Start over', () => {
    renderPanel({ resumable })

    expect(screen.getByText('You left a run unfinished — 3 of 10 answered.')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Resume' })).toBeEnabled()
    // The label is the only thing telling the player that Begin would not
    // continue the old run.
    expect(screen.getByRole('button', { name: 'Start over' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'Begin' })).not.toBeInTheDocument()
  })

  it('hands a resumed run over to the player, mid-run', async () => {
    resumeRunAction.mockResolvedValue({
      ok: true,
      run: {
        status: 'playing',
        attemptId: 'attempt-old',
        question,
        total: 10,
        timePerQuestionSec: null,
        answered: 3,
        history: [],
      },
    })
    renderPanel({ resumable })

    await userEvent.click(screen.getByRole('button', { name: 'Resume' }))

    expect(await screen.findByRole('heading', { name: question.prompt })).toBeVisible()
    expect(resumeRunAction).toHaveBeenCalledTimes(1)
    expect(resumeRunAction).toHaveBeenCalledWith({ slug: 'road-signs', attemptId: 'attempt-old' })
    expect(startRunAction).not.toHaveBeenCalled()
    // The position is what proves the answered count reached the player; a
    // plain start would read question 1.
    expect(screen.getByText('Question 4 of 10')).toBeInTheDocument()
    // The panel is gone, not stacked under the run.
    expect(screen.queryByRole('button', { name: 'Start over' })).not.toBeInTheDocument()
  })

  it('takes the offer away when the server refuses the resume', async () => {
    resumeRunAction.mockResolvedValue({ ok: false, error: 'gone' })
    renderPanel({ resumable })

    await userEvent.click(screen.getByRole('button', { name: 'Resume' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('That run is no longer available')
    expect(screen.queryByRole('button', { name: 'Resume' })).not.toBeInTheDocument()
    expect(screen.queryByText(/You left a run unfinished/)).not.toBeInTheDocument()
    // What is left is a run to start from the top, on a button that works.
    expect(screen.getByRole('button', { name: 'Begin' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'Start over' })).not.toBeInTheDocument()
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
    expect(screen.getByText('You left a run unfinished — 3 of 10 answered.')).toBeVisible()
    // The label is what tells it apart from 'gone', which hands Begin back.
    expect(screen.getByRole('button', { name: 'Start over' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'Begin' })).not.toBeInTheDocument()
  })

  // Begin and Resume used to guard only against themselves: a slow Resume
  // followed by Start over made a second attempt and left the mounted run with
  // one attempt's id and another's question. Each test asserts the disabled
  // state AND that the other action never fires, because either alone would
  // survive the other half of the fix being removed.
  it('does not start a run while a resume is in flight', async () => {
    let release: (value: unknown) => void = () => {}
    resumeRunAction.mockReturnValue(
      new Promise((resolve) => {
        release = resolve
      }),
    )
    renderPanel({ resumable })

    await userEvent.click(screen.getByRole('button', { name: 'Resume' }))

    const startOver = screen.getByRole('button', { name: 'Start over' })
    expect(startOver).toBeDisabled()
    // A disabled button swallows the click, so submit the form directly: that
    // is the path that reaches the handler if only the attribute were guarding.
    await userEvent.click(startOver)
    const form = startOver.closest('form')
    expect(form).not.toBeNull()
    fireEvent.submit(form as HTMLFormElement)
    expect(startRunAction).not.toHaveBeenCalled()

    release({
      ok: true,
      run: {
        status: 'playing',
        attemptId: 'attempt-old',
        question,
        total: 10,
        timePerQuestionSec: null,
        answered: 3,
        history: [],
      },
    })

    expect(await screen.findByRole('heading', { name: question.prompt })).toBeVisible()
    expect(screen.getByText('Question 4 of 10')).toBeInTheDocument()
    expect(resumeRunAction).toHaveBeenCalledTimes(1)
    expect(startRunAction).not.toHaveBeenCalled()
  })

  it('does not resume a run while a start is in flight', async () => {
    let release: (value: unknown) => void = () => {}
    startRunAction.mockReturnValue(
      new Promise((resolve) => {
        release = resolve
      }),
    )
    renderPanel({ resumable })

    const resumeButton = screen.getByRole('button', { name: 'Resume' })
    await userEvent.click(screen.getByRole('button', { name: 'Start over' }))

    expect(screen.getByRole('button', { name: 'Starting…' })).toBeDisabled()
    expect(resumeButton).toBeDisabled()
    await userEvent.click(resumeButton)
    expect(resumeRunAction).not.toHaveBeenCalled()
    expect(startRunAction).toHaveBeenCalledTimes(1)

    release({ ok: true, run: started })

    expect(await screen.findByRole('heading', { name: question.prompt })).toBeVisible()
    expect(screen.getByText('Question 1 of 10')).toBeInTheDocument()
    expect(resumeRunAction).not.toHaveBeenCalled()
    expect(startRunAction).toHaveBeenCalledTimes(1)
  })

  it('shows the summary when the run was finished elsewhere', async () => {
    resumeRunAction.mockResolvedValue({
      ok: true,
      run: {
        status: 'finished',
        attemptId: 'attempt-old',
        summary: { attemptId: 'attempt-old', score: 7, errors: 3, total: 10, passed: true },
        answered: 10,
        history: [],
      },
    })
    renderPanel({ resumable })

    await userEvent.click(screen.getByRole('button', { name: 'Resume' }))

    expect(await screen.findByText('7 of 10 correct · 3 mistakes')).toBeVisible()
    // No question to answer: the run is over.
    expect(screen.queryByRole('radio')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Resume' })).not.toBeInTheDocument()
  })

  it('still begins a fresh run with the ordinary start', async () => {
    renderPanel()

    await userEvent.click(screen.getByRole('button', { name: 'Begin' }))

    expect(await screen.findByRole('heading', { name: question.prompt })).toBeVisible()
    expect(startRunAction).toHaveBeenCalledTimes(1)
    expect(startRunAction).toHaveBeenCalledWith({ slug: 'road-signs', nickname: undefined })
    expect(resumeRunAction).not.toHaveBeenCalled()
    expect(screen.getByText('Question 1 of 10')).toBeInTheDocument()
  })
})
