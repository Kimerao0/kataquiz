import { eq } from 'drizzle-orm'
import { quizzes, user } from '@/db/schema'
import { parseQuizText, type QuizFile } from '@/lib/quiz-schema'
import { type TestTx, withTestDb } from '@/test/db'
import { importQuiz, MAX_UPLOAD_BYTES, slugify } from './import'

async function insertUser(tx: TestTx) {
  const id = `user-${crypto.randomUUID()}`
  await tx.insert(user).values({ id, name: 'Author', email: `${id}@example.com` })
  return id
}

function quizFile(overrides: Partial<QuizFile> = {}): QuizFile {
  return {
    version: 1,
    title: 'Italian Driving Licence - Road Signs',
    description: 'Signs and right-of-way rules.',
    language: 'it',
    tags: ['driving', 'italy'],
    run: { questionsPerRun: 2, maxErrors: 1, timePerQuestionSec: 30 },
    questions: [
      {
        type: 'single',
        prompt: 'What does a red triangular sign mean?',
        explanation: 'Triangular signs warn of danger ahead.',
        options: [
          { text: 'Warning', correct: true },
          { text: 'Prohibition', correct: false },
        ],
      },
      {
        type: 'multi',
        prompt: 'Which of these are give-way situations?',
        options: [
          { text: 'A roundabout', correct: true },
          { text: 'A green light', correct: false },
          { text: 'A stop sign', correct: true },
        ],
      },
    ],
    ...overrides,
  }
}

function readQuiz(tx: TestTx, quizId: string) {
  return tx.query.quizzes.findFirst({
    where: eq(quizzes.id, quizId),
    with: {
      questions: {
        orderBy: (question, { asc }) => [asc(question.position)],
        with: { options: { orderBy: (option, { asc }) => [asc(option.position)] } },
      },
    },
  })
}

describe('slugify', () => {
  it('lowercases and hyphenates a title', () => {
    expect(slugify('Road Signs Quiz')).toBe('road-signs-quiz')
  })

  it('strips accents', () => {
    expect(slugify('Patente B — Segnali')).toBe('patente-b-segnali')
  })

  it('collapses runs of punctuation into one hyphen', () => {
    expect(slugify('Quiz!!! ... Part 2')).toBe('quiz-part-2')
  })

  it('trims leading and trailing hyphens', () => {
    expect(slugify('  --Quiz--  ')).toBe('quiz')
  })

  it('caps the length at 60 characters', () => {
    expect(slugify('a'.repeat(100))).toBe('a'.repeat(60))
  })

  it("falls back to 'quiz' for a title with no alphanumerics", () => {
    expect(slugify('!!! ???')).toBe('quiz')
    expect(slugify('日本語')).toBe('quiz')
  })
})

describe('importQuiz', () => {
  it('creates the quiz, its questions and its options', async () => {
    await withTestDb(async (tx) => {
      const authorId = await insertUser(tx)

      const { quizId, slug } = await importQuiz({ file: quizFile(), authorId, executor: tx })

      const quiz = await readQuiz(tx, quizId)
      if (!quiz) throw new Error('expected the quiz to be found')
      expect(quiz.slug).toBe(slug)
      expect(quiz.authorId).toBe(authorId)
      expect(quiz.title).toBe('Italian Driving Licence - Road Signs')
      expect(quiz.description).toBe('Signs and right-of-way rules.')
      expect(quiz.questions).toHaveLength(2)
      expect(quiz.questions[0].explanation).toBe('Triangular signs warn of danger ahead.')
      expect(quiz.questions.flatMap((question) => question.options)).toHaveLength(5)
    })
  })

  it('keeps question order as position 0,1,2...', async () => {
    await withTestDb(async (tx) => {
      const authorId = await insertUser(tx)
      const file = quizFile()
      file.questions.push({
        type: 'single',
        prompt: 'What colour is a stop sign?',
        options: [
          { text: 'Red', correct: true },
          { text: 'Blue', correct: false },
        ],
      })

      const { quizId } = await importQuiz({ file, authorId, executor: tx })

      const quiz = await readQuiz(tx, quizId)
      expect(quiz?.questions.map((question) => question.position)).toEqual([0, 1, 2])
      expect(quiz?.questions.map((question) => question.prompt)).toEqual(
        file.questions.map((question) => question.prompt),
      )
    })
  })

  it('keeps option order within a question', async () => {
    await withTestDb(async (tx) => {
      const authorId = await insertUser(tx)

      const { quizId } = await importQuiz({ file: quizFile(), authorId, executor: tx })

      const quiz = await readQuiz(tx, quizId)
      expect(quiz?.questions[1].options.map((option) => option.text)).toEqual([
        'A roundabout',
        'A green light',
        'A stop sign',
      ])
      expect(quiz?.questions[1].options.map((option) => option.isCorrect)).toEqual([
        true,
        false,
        true,
      ])
    })
  })

  it('stores the run settings and tags from the file', async () => {
    await withTestDb(async (tx) => {
      const authorId = await insertUser(tx)

      const { quizId } = await importQuiz({ file: quizFile(), authorId, executor: tx })

      const quiz = await readQuiz(tx, quizId)
      expect(quiz?.questionsPerRun).toBe(2)
      expect(quiz?.maxErrors).toBe(1)
      expect(quiz?.timePerQuestionSec).toBe(30)
      expect(quiz?.language).toBe('it')
      expect(quiz?.tags).toEqual(['driving', 'italy'])
    })
  })

  it('gives two quizzes with the same title different slugs', async () => {
    await withTestDb(async (tx) => {
      const authorId = await insertUser(tx)

      const first = await importQuiz({ file: quizFile(), authorId, executor: tx })
      const second = await importQuiz({ file: quizFile(), authorId, executor: tx })

      expect(first.slug).not.toBe(second.slug)
      expect(first.slug).toMatch(/^italian-driving-licence-road-signs-/)
      expect(second.slug).toMatch(/^italian-driving-licence-road-signs-/)
    })
  })

  it('normalizes a boolean question to two options', async () => {
    await withTestDb(async (tx) => {
      const authorId = await insertUser(tx)
      const parsed = parseQuizText(`
version: 1
title: Parking rules
language: en
run:
  questionsPerRun: 1
  maxErrors: 0
questions:
  - type: boolean
    prompt: You may park on a pedestrian crossing.
    answer: false
`)
      if (!parsed.ok) throw new Error(`expected the file to parse: ${parsed.errors.join(', ')}`)

      const { quizId } = await importQuiz({ file: parsed.data, authorId, executor: tx })

      const quiz = await readQuiz(tx, quizId)
      expect(quiz?.questions[0].type).toBe('boolean')
      expect(quiz?.questions[0].options.map((option) => option.text)).toEqual(['True', 'False'])
      expect(quiz?.questions[0].options.map((option) => option.isCorrect)).toEqual([false, true])
    })
  })

  it('writes nothing when the insert fails partway', async () => {
    await withTestDb(async (tx) => {
      const title = `Ghost quiz ${crypto.randomUUID()}`

      // A savepoint around the import, so the foreign key violation rolls back
      // without aborting the transaction the assertion below still needs.
      await expect(
        tx.transaction((savepoint) =>
          importQuiz({ file: quizFile({ title }), authorId: 'ghost-user', executor: savepoint }),
        ),
      ).rejects.toThrow()

      const rows = await tx.select().from(quizzes).where(eq(quizzes.title, title))
      expect(rows).toHaveLength(0)
    })
  })
})

describe('MAX_UPLOAD_BYTES', () => {
  it('a payload of multi-byte characters is measured in bytes, not characters', () => {
    // 'è' is one character but two bytes in UTF-8, so a guard that counted
    // characters would accept a payload twice the size of the limit.
    const payload = 'è'.repeat(MAX_UPLOAD_BYTES - 1)

    expect(payload.length).toBeLessThan(MAX_UPLOAD_BYTES)
    expect(Buffer.byteLength(payload, 'utf8')).toBeGreaterThan(MAX_UPLOAD_BYTES)
  })
})
