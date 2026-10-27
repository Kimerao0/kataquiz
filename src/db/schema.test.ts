import { eq } from 'drizzle-orm'
import { type TestTx, withTestDb } from '@/test/db'
import { attemptAnswers, attempts, options, questions, quizzes, rateLimits, user } from './schema'

async function insertUser(tx: TestTx) {
  const id = `user-${crypto.randomUUID()}`
  await tx.insert(user).values({ id, name: 'Author', email: `${id}@example.com` })
  return id
}

async function insertQuiz(tx: TestTx, slug = `quiz-${crypto.randomUUID()}`, authorId?: string) {
  const [quiz] = await tx
    .insert(quizzes)
    .values({
      slug,
      authorId: authorId ?? (await insertUser(tx)),
      title: 'Italian Driving Licence - Road Signs',
      language: 'it',
      questionsPerRun: 2,
      maxErrors: 1,
    })
    .returning({ id: quizzes.id })
  return quiz.id
}

describe('schema', () => {
  it('stores a quiz with its questions and options and reads them back', async () => {
    await withTestDb(async (tx) => {
      const quizId = await insertQuiz(tx)
      const inserted = await tx
        .insert(questions)
        .values([
          { quizId, position: 0, type: 'single', prompt: 'What does a red triangle mean?' },
          { quizId, position: 1, type: 'boolean', prompt: 'You may park on a crossing.' },
        ])
        .returning({ id: questions.id })

      // Inserted out of position order on purpose: the read has to sort them.
      await tx.insert(options).values([
        { questionId: inserted[0].id, position: 1, text: 'Prohibition', isCorrect: false },
        { questionId: inserted[0].id, position: 0, text: 'Warning', isCorrect: true },
        { questionId: inserted[1].id, position: 1, text: 'False', isCorrect: true },
        { questionId: inserted[1].id, position: 0, text: 'True', isCorrect: false },
      ])

      const quiz = await tx.query.quizzes.findFirst({
        where: eq(quizzes.id, quizId),
        with: {
          questions: {
            orderBy: (question, { asc }) => [asc(question.position)],
            with: { options: { orderBy: (option, { asc }) => [asc(option.position)] } },
          },
        },
      })

      if (!quiz) throw new Error('expected the quiz to be found')
      expect(quiz.questions).toHaveLength(2)
      expect(quiz.questions.flatMap((question) => question.options)).toHaveLength(4)
      expect(quiz.questions[0].options.map((option) => option.text)).toEqual([
        'Warning',
        'Prohibition',
      ])
    })
  })

  it('cascades deletes from quiz to questions to options', async () => {
    await withTestDb(async (tx) => {
      const quizId = await insertQuiz(tx)
      const [question] = await tx
        .insert(questions)
        .values({ quizId, position: 0, type: 'single', prompt: 'A question' })
        .returning({ id: questions.id })
      await tx
        .insert(options)
        .values({ questionId: question.id, position: 0, text: 'Warning', isCorrect: true })

      await tx.delete(quizzes).where(eq(quizzes.id, quizId))

      const leftQuestions = await tx.select().from(questions).where(eq(questions.quizId, quizId))
      const leftOptions = await tx.select().from(options).where(eq(options.questionId, question.id))
      expect(leftQuestions).toHaveLength(0)
      expect(leftOptions).toHaveLength(0)
    })
  })

  it('deleting a user deletes the quizzes they authored', async () => {
    await withTestDb(async (tx) => {
      const authorId = await insertUser(tx)
      const quizId = await insertQuiz(tx, undefined, authorId)

      await tx.delete(user).where(eq(user.id, authorId))

      const leftQuizzes = await tx.select().from(quizzes).where(eq(quizzes.id, quizId))
      expect(leftQuizzes).toHaveLength(0)
    })
  })

  it('deleting a user leaves their attempts in place with a null userId', async () => {
    await withTestDb(async (tx) => {
      // The quiz is somebody else's on purpose: deleting its author would take
      // the attempt with it through the quiz cascade and prove nothing.
      const quizId = await insertQuiz(tx, undefined, await insertUser(tx))
      const playerId = await insertUser(tx)
      const [attempt] = await tx
        .insert(attempts)
        .values({ quizId, userId: playerId, questionIds: [], score: 7 })
        .returning({ id: attempts.id })

      await tx.delete(user).where(eq(user.id, playerId))

      const [row] = await tx.select().from(attempts).where(eq(attempts.id, attempt.id))
      expect(row.userId).toBeNull()
      expect(row.score).toBe(7)
    })
  })

  it('rejects two quizzes with the same slug', async () => {
    await withTestDb(async (tx) => {
      await insertQuiz(tx, 'duplicate-slug')
      await expect(insertQuiz(tx, 'duplicate-slug')).rejects.toThrow()
    })
  })

  it('rejects a quiz whose authorId is not a real user', async () => {
    await withTestDb(async (tx) => {
      await expect(insertQuiz(tx, undefined, 'ghost-user')).rejects.toThrow()
    })
  })

  it('rejects two questions at the same position in one quiz', async () => {
    await withTestDb(async (tx) => {
      const quizId = await insertQuiz(tx)
      const question = { quizId, position: 0, type: 'single' as const, prompt: 'A question' }

      await tx.insert(questions).values(question)
      await expect(tx.insert(questions).values(question)).rejects.toThrow()
    })
  })

  it('rejects two answers to the same question in one attempt', async () => {
    await withTestDb(async (tx) => {
      const quizId = await insertQuiz(tx)
      const [question] = await tx
        .insert(questions)
        .values({ quizId, position: 0, type: 'single', prompt: 'A question' })
        .returning({ id: questions.id })
      const [attempt] = await tx
        .insert(attempts)
        .values({ quizId, questionIds: [question.id] })
        .returning({ id: attempts.id })
      const answer = {
        attemptId: attempt.id,
        questionId: question.id,
        selectedOptionIds: [],
        isCorrect: true,
        elapsedMs: 1200,
      }

      await tx.insert(attemptAnswers).values(answer)
      await expect(tx.insert(attemptAnswers).values(answer)).rejects.toThrow()
    })
  })

  it('allows the same question answered in two different attempts', async () => {
    await withTestDb(async (tx) => {
      const quizId = await insertQuiz(tx)
      const [question] = await tx
        .insert(questions)
        .values({ quizId, position: 0, type: 'single', prompt: 'A question' })
        .returning({ id: questions.id })
      const inserted = await tx
        .insert(attempts)
        .values([
          { quizId, questionIds: [question.id] },
          { quizId, questionIds: [question.id] },
        ])
        .returning({ id: attempts.id })

      await tx.insert(attemptAnswers).values(
        inserted.map((attempt) => ({
          attemptId: attempt.id,
          questionId: question.id,
          selectedOptionIds: [],
          isCorrect: false,
          elapsedMs: 900,
        })),
      )

      const answers = await tx
        .select()
        .from(attemptAnswers)
        .where(eq(attemptAnswers.questionId, question.id))
      expect(answers).toHaveLength(2)
    })
  })

  it('stores and reads back a uuid array in attempts.questionIds', async () => {
    await withTestDb(async (tx) => {
      const quizId = await insertQuiz(tx)
      const questionIds = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()]
      const [attempt] = await tx
        .insert(attempts)
        .values({ quizId, questionIds })
        .returning({ id: attempts.id })

      const [row] = await tx.select().from(attempts).where(eq(attempts.id, attempt.id))
      expect(row.questionIds).toEqual(questionIds)
    })
  })

  it('defaults score and errors to 0 and finishedAt to null', async () => {
    await withTestDb(async (tx) => {
      const quizId = await insertQuiz(tx)
      const [attempt] = await tx.insert(attempts).values({ quizId, questionIds: [] }).returning()

      expect(attempt.score).toBe(0)
      expect(attempt.errors).toBe(0)
      expect(attempt.finishedAt).toBeNull()
    })
  })

  it('links a challenge attempt to the attempt it answers', async () => {
    await withTestDb(async (tx) => {
      const quizId = await insertQuiz(tx)
      const [original] = await tx
        .insert(attempts)
        .values({ quizId, questionIds: [] })
        .returning({ id: attempts.id })
      const [challenge] = await tx
        .insert(attempts)
        .values({ quizId, questionIds: [], challengeOfAttemptId: original.id })
        .returning()

      expect(challenge.challengeOfAttemptId).toBe(original.id)
    })
  })

  it('reads an attempt together with its answers', async () => {
    await withTestDb(async (tx) => {
      const quizId = await insertQuiz(tx)
      const [question] = await tx
        .insert(questions)
        .values({ quizId, position: 0, type: 'single', prompt: 'Prompt' })
        .returning({ id: questions.id })
      const [attempt] = await tx
        .insert(attempts)
        .values({ quizId, questionIds: [question.id] })
        .returning({ id: attempts.id })
      await tx.insert(attemptAnswers).values({
        attemptId: attempt.id,
        questionId: question.id,
        selectedOptionIds: [],
        isCorrect: false,
        elapsedMs: 1200,
      })

      const found = await tx.query.attempts.findFirst({
        where: (row, { eq: equals }) => equals(row.id, attempt.id),
        with: { answers: true },
      })

      expect(found?.answers).toHaveLength(1)
      expect(found?.answers[0]?.elapsedMs).toBe(1200)
    })
  })

  it('stores a rate limit row keyed by string', async () => {
    await withTestDb(async (tx) => {
      const key = 'ip:203.0.113.7'
      const windowStart = new Date('2026-01-01T00:00:00.000Z')
      await tx.insert(rateLimits).values({ key, windowStart, count: 3 })

      const [row] = await tx.select().from(rateLimits).where(eq(rateLimits.key, key))
      expect(row.count).toBe(3)
      expect(row.windowStart).toEqual(windowStart)
    })
  })
})
