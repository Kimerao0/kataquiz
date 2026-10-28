import { MAX_UPLOAD_BYTES } from '@/lib/quizzes/import'
import { UPLOAD_LIMIT, UPLOAD_WINDOW_SEC } from '@/lib/rate-limit'
import { UnauthorizedError } from '@/lib/session'
import { uploadQuizAction } from './actions'

const { requireUser, checkRateLimit, importQuiz, parseQuizText } = vi.hoisted(() => ({
  requireUser: vi.fn<typeof import('@/lib/session').requireUser>(),
  checkRateLimit: vi.fn<typeof import('@/lib/rate-limit').checkRateLimit>(),
  importQuiz: vi.fn<typeof import('@/lib/quizzes/import').importQuiz>(),
  parseQuizText: vi.fn<typeof import('@/lib/quiz-schema').parseQuizText>(),
}))

// Only `requireUser` is stubbed: the action compares the thrown error against
// the real `UnauthorizedError`, so the real class has to stay in place.
vi.mock('@/lib/session', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/session')>()),
  requireUser,
}))

// Likewise the real limit constants, so the assertion below pins the values the
// action actually passes rather than copies of them.
vi.mock('@/lib/rate-limit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/rate-limit')>()),
  checkRateLimit,
}))

// MAX_UPLOAD_BYTES stays real; only the write is stubbed. These are tests of
// the action's control flow, and the import has its own test against Postgres.
vi.mock('@/lib/quizzes/import', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/quizzes/import')>()),
  importQuiz,
}))

// Validation stays real — the parser is only wrapped in a spy, so a test can
// assert both what it returned and that it was never reached.
vi.mock('@/lib/quiz-schema', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/quiz-schema')>()
  parseQuizText.mockImplementation(actual.parseQuizText)
  return { ...actual, parseQuizText }
})

// Every message resolves to its own key, so an assertion names the error the
// action chose instead of restating its English wording.
vi.mock('next-intl/server', () => ({
  getTranslations: async () => (key: string) => key,
}))

const author = { id: 'user-1', name: 'Ada Lovelace', image: null }

const validQuiz = `
version: 1
title: Italian Driving Licence - Road Signs
language: it
run:
  questionsPerRun: 1
  maxErrors: 0
questions:
  - type: single
    prompt: What does a red triangular sign mean?
    options:
      - text: Warning
        correct: true
      - text: Prohibition
        correct: false
`

function formDataWith(fields: { text?: string; file?: string }): FormData {
  const formData = new FormData()
  if (fields.text !== undefined) formData.set('text', fields.text)
  if (fields.file !== undefined) {
    formData.set('file', new File([fields.file], 'quiz.yaml', { type: 'application/yaml' }))
  }
  return formData
}

function expectNothingParsedOrWritten() {
  expect(parseQuizText).not.toHaveBeenCalled()
  expect(importQuiz).not.toHaveBeenCalled()
}

beforeEach(() => {
  vi.clearAllMocks()
  requireUser.mockResolvedValue(author)
  checkRateLimit.mockResolvedValue(true)
  importQuiz.mockResolvedValue({ quizId: 'quiz-1', slug: 'road-signs-ab12cd' })
})

describe('uploadQuizAction', () => {
  it('rejects an unauthenticated upload', async () => {
    requireUser.mockRejectedValue(new UnauthorizedError('nope'))

    const result = await uploadQuizAction(formDataWith({ text: validQuiz }))

    expect(result).toEqual({ ok: false, errors: ['unauthorized'] })
    // Auth runs before anything else looks at the payload, limiter included.
    expect(checkRateLimit).not.toHaveBeenCalled()
    expectNothingParsedOrWritten()
  })

  it('lets an unexpected session failure through instead of reporting it', async () => {
    // Returning this one as a validation error would hide an outage behind a
    // message telling the user their file was wrong.
    requireUser.mockRejectedValue(new Error('the database is down'))

    await expect(uploadQuizAction(formDataWith({ text: validQuiz }))).rejects.toThrow(
      'the database is down',
    )
    expectNothingParsedOrWritten()
  })

  it('rejects an upload over the rate limit', async () => {
    checkRateLimit.mockResolvedValue(false)

    const result = await uploadQuizAction(formDataWith({ text: validQuiz }))

    expect(result).toEqual({ ok: false, errors: ['rateLimited'] })
    expect(checkRateLimit).toHaveBeenCalledWith(
      `upload:${author.id}`,
      UPLOAD_LIMIT,
      UPLOAD_WINDOW_SEC,
    )
    expectNothingParsedOrWritten()
  })

  it('rejects a payload larger than MAX_UPLOAD_BYTES', async () => {
    const result = await uploadQuizAction(formDataWith({ text: 'a'.repeat(MAX_UPLOAD_BYTES + 1) }))

    // The size error and not a parse error: the guard has to run before the
    // parser, or a megabyte of junk is parsed before anyone measures it.
    expect(result).toEqual({ ok: false, errors: ['tooLarge'] })
    expectNothingParsedOrWritten()
  })

  it('measures the limit in bytes, not characters', async () => {
    // 'è' is one character and two bytes, so this payload is under the limit
    // by length and over it by size.
    const payload = 'è'.repeat(Math.ceil(MAX_UPLOAD_BYTES / 2) + 1)
    expect(payload.length).toBeLessThan(MAX_UPLOAD_BYTES)
    expect(Buffer.byteLength(payload, 'utf8')).toBeGreaterThan(MAX_UPLOAD_BYTES)

    const result = await uploadQuizAction(formDataWith({ text: payload }))

    expect(result).toEqual({ ok: false, errors: ['tooLarge'] })
    expectNothingParsedOrWritten()
  })

  it('rejects an empty submission with its own message', async () => {
    const result = await uploadQuizAction(formDataWith({ text: '   \n  ' }))

    // Its own message, not whatever the parser says about an empty document.
    expect(result).toEqual({ ok: false, errors: ['empty'] })
    expectNothingParsedOrWritten()
  })

  it('prefers the uploaded file over the pasted textarea', async () => {
    const pasted = validQuiz.replace('Road Signs', 'Pasted Text')

    const result = await uploadQuizAction(formDataWith({ file: validQuiz, text: pasted }))

    expect(result).toEqual({ ok: true, slug: 'road-signs-ab12cd' })
    expect(importQuiz).toHaveBeenCalledWith({
      file: expect.objectContaining({ title: 'Italian Driving Licence - Road Signs' }),
      authorId: author.id,
    })
  })

  it('returns the slug on a valid upload', async () => {
    const result = await uploadQuizAction(formDataWith({ text: validQuiz }))

    expect(result).toEqual({ ok: true, slug: 'road-signs-ab12cd' })
    expect(importQuiz).toHaveBeenCalledWith({
      file: expect.objectContaining({ title: 'Italian Driving Licence - Road Signs' }),
      authorId: author.id,
    })
  })

  it('returns the schema errors unchanged for an invalid file', async () => {
    const result = await uploadQuizAction(formDataWith({ text: 'version: 2\ntitle: Nope\n' }))

    const parsed = parseQuizText.mock.results[0].value
    if (parsed.ok) throw new Error('expected the file to be rejected')
    if (result.ok) throw new Error('expected the upload to fail')
    // Unchanged: the parser's own messages, not a translated stand-in.
    expect(result.errors).toEqual(parsed.errors)
    expect(result.errors.join('\n')).toMatch(/version/)
    expect(importQuiz).not.toHaveBeenCalled()
  })
})
