import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithMessages } from '@/test/intl'
import { UploadForm } from './upload-form'

const { uploadQuizAction } = vi.hoisted(() => ({ uploadQuizAction: vi.fn() }))

// A factory mock, so the real Server Action module — and the pg Pool it builds
// at import time through @/lib/session — never loads in jsdom. The action has
// its own tests against the database.
vi.mock('./actions', () => ({ uploadQuizAction }))

const PASTED = 'version: 1\ntitle: Road signs\n'

function textarea() {
  return screen.getByLabelText<HTMLTextAreaElement>('Or paste the file contents')
}

function fileInput() {
  return screen.getByLabelText<HTMLInputElement>('Quiz file')
}

function submit() {
  return userEvent.click(screen.getByRole('button', { name: 'Upload quiz' }))
}

beforeEach(() => {
  vi.clearAllMocks()
  uploadQuizAction.mockResolvedValue({ ok: false, errors: ['version: must be 1'] })
})

describe('upload form', () => {
  it('keeps the pasted quiz when the upload is rejected', async () => {
    renderWithMessages(<UploadForm />)

    await userEvent.type(textarea(), PASTED)
    await submit()
    await screen.findByRole('alert')

    // React resets the uncontrolled fields of a <form action> once the action
    // returns. The author's only copy of the quiz is in this box, so it has to
    // survive the rejection that sends them back to it.
    expect(textarea()).toHaveValue(PASTED)
  })

  it('says the chosen file is gone when the upload is rejected', async () => {
    renderWithMessages(<UploadForm />)

    await userEvent.upload(fileInput(), new File([PASTED], 'quiz.yaml', { type: 'text/yaml' }))
    await submit()
    await screen.findByRole('alert')

    // The same reset empties the file input in a browser, and no script may
    // put the file back. Saying so beats letting the author press Upload again
    // on a form that now carries nothing.
    expect(screen.getByText(/cleared the chosen file/)).toBeVisible()
    expect(fileInput()).toHaveAccessibleDescription(/cleared the chosen file/)
  })

  it('says nothing about a file when none was attached', async () => {
    renderWithMessages(<UploadForm />)

    await userEvent.type(textarea(), PASTED)
    await submit()
    await screen.findByRole('alert')

    expect(screen.queryByText(/cleared the chosen file/)).not.toBeInTheDocument()
  })

  it('counts the question in an error from one, not from zero', async () => {
    uploadQuizAction.mockResolvedValue({
      ok: false,
      errors: ['questions.3.options: must have between 2 and 10 options'],
    })
    renderWithMessages(<UploadForm />)

    await userEvent.type(textarea(), PASTED)
    await submit()

    // questions.3 is the fourth question. The schema's own message is carried
    // through untouched; only the position is rewritten.
    expect(
      await screen.findByText('Question 4, options: must have between 2 and 10 options'),
    ).toBeVisible()
  })

  it('leaves an error that names no question alone', async () => {
    uploadQuizAction.mockResolvedValue({
      ok: false,
      errors: ['run.questionsPerRun: must not exceed the number of questions'],
    })
    renderWithMessages(<UploadForm />)

    await userEvent.type(textarea(), PASTED)
    await submit()

    expect(
      await screen.findByText('run.questionsPerRun: must not exceed the number of questions'),
    ).toBeVisible()
  })

  it('lists repeated errors as separate items without a key collision', async () => {
    const duplicate = 'a single question must have exactly one correct option'
    uploadQuizAction.mockResolvedValue({
      ok: false,
      errors: [`questions.0.options: ${duplicate}`, `questions.1.options: ${duplicate}`, duplicate],
    })
    // React reports a repeated key on console.error and nowhere else, so that
    // is where a collision has to be caught.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    renderWithMessages(<UploadForm />)
    await userEvent.type(textarea(), PASTED)
    await submit()
    await screen.findByRole('alert')

    expect(screen.getAllByRole('listitem')).toHaveLength(3)
    const keyWarnings = consoleError.mock.calls.filter((call) =>
      call.some((argument) => typeof argument === 'string' && argument.includes('same key')),
    )
    expect(keyWarnings).toEqual([])
    consoleError.mockRestore()
  })
})
