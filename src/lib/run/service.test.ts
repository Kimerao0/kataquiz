import { eq } from 'drizzle-orm'
import { attemptAnswers, attempts, options, questions, quizzes, user } from '@/db/schema'
import { type TestTx, withTestDb } from '@/test/db'
import { TIMER_GRACE_MS } from './engine'
import {
  DuplicateAnswerError,
  EmptyQuizError,
  NotYourAttemptError,
  type Player,
  QuestionNotInAttemptError,
  QuizNotFoundError,
  startRun,
  submitAnswer,
} from './service'

type SeedOptions = {
  questionCount?: number
  questionsPerRun?: number
  maxErrors?: number
  timePerQuestionSec?: number | null
  isHidden?: boolean
}

type SeededQuestion = {
  id: string
  explanation: string
  theoryUrl: string
  correctOptionIds: string[]
  wrongOptionIds: string[]
}

type Seed = {
  quizId: string
  player: Player
  questions: SeededQuestion[]
}

// Every test runs against a quiz that exists: one author, one quiz, and N
// single-choice questions with one right and one wrong option each.
async function seedQuiz(tx: TestTx, overrides: SeedOptions = {}): Promise<Seed> {
  const {
    questionCount = 3,
    questionsPerRun = questionCount,
    maxErrors = 1,
    timePerQuestionSec = null,
    isHidden = false,
  } = overrides

  const userId = `user-${crypto.randomUUID()}`
  await tx.insert(user).values({ id: userId, name: 'Player', email: `${userId}@example.com` })

  const [quiz] = await tx
    .insert(quizzes)
    .values({
      slug: `quiz-${crypto.randomUUID()}`,
      authorId: userId,
      title: 'Italian Driving Licence - Road Signs',
      language: 'it',
      questionsPerRun,
      maxErrors,
      timePerQuestionSec,
      isHidden,
    })
    .returning({ id: quizzes.id })

  const player: Player = { kind: 'user', userId }
  if (questionCount === 0) return { quizId: quiz.id, player, questions: [] }

  const rows = Array.from({ length: questionCount }, (_, index) => ({
    quizId: quiz.id,
    position: index,
    type: 'single' as const,
    prompt: `Question ${index}`,
    explanation: `Rule ${index} says so`,
    theoryUrl: `https://example.com/theory/${index}`,
  }))
  const inserted = await tx.insert(questions).values(rows).returning({ id: questions.id })

  const optionRows = await tx
    .insert(options)
    .values(
      inserted.flatMap((question, index) => [
        { questionId: question.id, position: 0, text: `Right ${index}`, isCorrect: true },
        { questionId: question.id, position: 1, text: `Wrong ${index}`, isCorrect: false },
      ]),
    )
    .returning({ id: options.id, questionId: options.questionId, isCorrect: options.isCorrect })

  const bank = inserted.map((question, index) => ({
    id: question.id,
    explanation: rows[index].explanation,
    theoryUrl: rows[index].theoryUrl,
    correctOptionIds: optionIdsOf(optionRows, question.id, true),
    wrongOptionIds: optionIdsOf(optionRows, question.id, false),
  }))

  return { quizId: quiz.id, player, questions: bank }
}

function optionIdsOf(
  rows: { id: string; questionId: string; isCorrect: boolean }[],
  questionId: string,
  isCorrect: boolean,
): string[] {
  return rows
    .filter((row) => row.questionId === questionId && row.isCorrect === isCorrect)
    .map((row) => row.id)
}

function seededQuestion(seed: Seed, questionId: string): SeededQuestion {
  const question = seed.questions.find((candidate) => candidate.id === questionId)
  if (!question) throw new Error(`question ${questionId} is not part of the seed`)
  return question
}

async function readAttempt(tx: TestTx, attemptId: string) {
  const [attempt] = await tx.select().from(attempts).where(eq(attempts.id, attemptId))
  return attempt
}

// Answers correctly and well within the clock unless the test says otherwise.
async function answer(
  tx: TestTx,
  seed: Seed,
  attemptId: string,
  questionId: string,
  overrides: { selectedOptionIds?: string[]; elapsedMs?: number } = {},
) {
  const question = seededQuestion(seed, questionId)
  return submitAnswer({
    attemptId,
    questionId,
    selectedOptionIds: overrides.selectedOptionIds ?? question.correctOptionIds,
    elapsedMs: overrides.elapsedMs ?? 1200,
    player: seed.player,
    executor: tx,
  })
}

describe('startRun', () => {
  it('creates an attempt holding questionsPerRun question ids', async () => {
    await withTestDb(async (tx) => {
      const seed = await seedQuiz(tx, { questionCount: 5, questionsPerRun: 3 })

      const run = await startRun({ quizId: seed.quizId, player: seed.player, executor: tx })

      const attempt = await readAttempt(tx, run.attemptId)
      expect(attempt.questionIds).toHaveLength(3)
      expect(new Set(attempt.questionIds).size).toBe(3)
      expect(run.total).toBe(3)
      const bankIds = seed.questions.map((question) => question.id)
      for (const id of attempt.questionIds) expect(bankIds).toContain(id)
    })
  })

  it('returns the first question with its options', async () => {
    await withTestDb(async (tx) => {
      const seed = await seedQuiz(tx, { questionCount: 1, timePerQuestionSec: 30 })

      const run = await startRun({ quizId: seed.quizId, player: seed.player, executor: tx })

      expect(run.question.id).toBe(seed.questions[0].id)
      expect(run.question.type).toBe('single')
      expect(run.question.prompt).toBe('Question 0')
      expect(run.question.imageUrl).toBeNull()
      expect(run.question.options.map((option) => option.text)).toEqual(['Right 0', 'Wrong 0'])
      expect(run.timePerQuestionSec).toBe(30)
    })
  })

  it('never exposes correctness on an unanswered question', async () => {
    await withTestDb(async (tx) => {
      const seed = await seedQuiz(tx, { questionCount: 3 })

      const run = await startRun({ quizId: seed.quizId, player: seed.player, executor: tx })

      for (const option of run.question.options) {
        expect(Object.keys(option).sort()).toEqual(['id', 'text'])
      }
      // Replacing the projection with a spread of the option row would put
      // isCorrect in here, and nothing else in this file would notice.
      const payload = JSON.stringify(run)
      expect(payload).not.toContain('isCorrect')
      expect(payload).not.toContain('correct')
    })
  })

  it('replays exactly the given questionIds when provided', async () => {
    await withTestDb(async (tx) => {
      const seed = await seedQuiz(tx, { questionCount: 4, questionsPerRun: 2 })
      const replayed = [seed.questions[3].id, seed.questions[0].id, seed.questions[2].id]

      const run = await startRun({
        quizId: seed.quizId,
        player: seed.player,
        questionIds: replayed,
        executor: tx,
      })

      const attempt = await readAttempt(tx, run.attemptId)
      expect(attempt.questionIds).toEqual(replayed)
      expect(run.question.id).toBe(replayed[0])
      expect(run.total).toBe(3)
    })
  })

  it('skips ids that no longer belong to the quiz when replaying', async () => {
    await withTestDb(async (tx) => {
      const seed = await seedQuiz(tx, { questionCount: 3 })
      const otherQuiz = await seedQuiz(tx, { questionCount: 1 })
      const replayed = [
        seed.questions[0].id,
        otherQuiz.questions[0].id,
        crypto.randomUUID(),
        seed.questions[2].id,
      ]

      const run = await startRun({
        quizId: seed.quizId,
        player: seed.player,
        questionIds: replayed,
        executor: tx,
      })

      const attempt = await readAttempt(tx, run.attemptId)
      expect(attempt.questionIds).toEqual([seed.questions[0].id, seed.questions[2].id])
      expect(run.total).toBe(2)
    })
  })

  it('throws QuizNotFoundError for an unknown quiz', async () => {
    await withTestDb(async (tx) => {
      const quizId = crypto.randomUUID()
      const player: Player = { kind: 'user', userId: 'nobody' }

      await expect(startRun({ quizId, player, executor: tx })).rejects.toThrow(QuizNotFoundError)
    })
  })

  it('throws QuizNotFoundError for a hidden quiz', async () => {
    await withTestDb(async (tx) => {
      const { quizId, player } = await seedQuiz(tx, { isHidden: true })

      await expect(startRun({ quizId, player, executor: tx })).rejects.toThrow(QuizNotFoundError)
    })
  })

  it('throws EmptyQuizError when the quiz has no questions', async () => {
    await withTestDb(async (tx) => {
      const { quizId, player } = await seedQuiz(tx, { questionCount: 0, questionsPerRun: 2 })

      await expect(startRun({ quizId, player, executor: tx })).rejects.toThrow(EmptyQuizError)
    })
  })

  it('records a guest attempt with its nickname', async () => {
    await withTestDb(async (tx) => {
      const seed = await seedQuiz(tx, { questionCount: 2 })
      const guestId = crypto.randomUUID()
      const guest: Player = { kind: 'guest', guestId, nickname: 'Fast Fox' }

      const run = await startRun({ quizId: seed.quizId, player: guest, executor: tx })

      const attempt = await readAttempt(tx, run.attemptId)
      expect(attempt.guestId).toBe(guestId)
      expect(attempt.nickname).toBe('Fast Fox')
      expect(attempt.userId).toBeNull()
    })
  })
})

describe('submitAnswer', () => {
  it('stores the answer and reports it correct', async () => {
    await withTestDb(async (tx) => {
      const seed = await seedQuiz(tx, { questionCount: 2 })
      const run = await startRun({ quizId: seed.quizId, player: seed.player, executor: tx })
      const question = seededQuestion(seed, run.question.id)

      const result = await answer(tx, seed, run.attemptId, question.id)

      expect(result.correct).toBe(true)
      expect(result.timedOut).toBe(false)
      const [stored] = await tx
        .select()
        .from(attemptAnswers)
        .where(eq(attemptAnswers.attemptId, run.attemptId))
      expect(stored.isCorrect).toBe(true)
      expect(stored.selectedOptionIds).toEqual(question.correctOptionIds)
      expect(stored.elapsedMs).toBe(1200)
      const attempt = await readAttempt(tx, run.attemptId)
      expect(attempt.score).toBe(1)
      expect(attempt.errors).toBe(0)
    })
  })

  it('reports a wrong answer and still returns the explanation and theory URL', async () => {
    await withTestDb(async (tx) => {
      const seed = await seedQuiz(tx, { questionCount: 2 })
      const run = await startRun({ quizId: seed.quizId, player: seed.player, executor: tx })
      const question = seededQuestion(seed, run.question.id)

      const result = await answer(tx, seed, run.attemptId, question.id, {
        selectedOptionIds: question.wrongOptionIds,
      })

      expect(result.correct).toBe(false)
      expect(result.explanation).toBe(question.explanation)
      expect(result.theoryUrl).toBe(question.theoryUrl)
      const attempt = await readAttempt(tx, run.attemptId)
      expect(attempt.score).toBe(0)
      expect(attempt.errors).toBe(1)
    })
  })

  it('returns the correct option ids after answering', async () => {
    await withTestDb(async (tx) => {
      const seed = await seedQuiz(tx, { questionCount: 2 })
      const run = await startRun({ quizId: seed.quizId, player: seed.player, executor: tx })
      const question = seededQuestion(seed, run.question.id)

      const result = await answer(tx, seed, run.attemptId, question.id, { selectedOptionIds: [] })

      expect(result.correctOptionIds).toEqual(question.correctOptionIds)
    })
  })

  it('counts a late answer as timed out and as an error', async () => {
    await withTestDb(async (tx) => {
      const seed = await seedQuiz(tx, { questionCount: 2, timePerQuestionSec: 30 })
      const run = await startRun({ quizId: seed.quizId, player: seed.player, executor: tx })
      const question = seededQuestion(seed, run.question.id)

      const result = await answer(tx, seed, run.attemptId, question.id, {
        selectedOptionIds: question.wrongOptionIds,
        elapsedMs: 30_000 + TIMER_GRACE_MS + 1,
      })

      expect(result.timedOut).toBe(true)
      expect(result.correct).toBe(false)
      const [stored] = await tx
        .select()
        .from(attemptAnswers)
        .where(eq(attemptAnswers.attemptId, run.attemptId))
      expect(stored.timedOut).toBe(true)
      const attempt = await readAttempt(tx, run.attemptId)
      expect(attempt.score).toBe(0)
      expect(attempt.errors).toBe(1)
    })
  })

  it('counts a late answer as wrong even when the selection was right', async () => {
    await withTestDb(async (tx) => {
      const seed = await seedQuiz(tx, { questionCount: 2, timePerQuestionSec: 30 })
      const run = await startRun({ quizId: seed.quizId, player: seed.player, executor: tx })
      const question = seededQuestion(seed, run.question.id)

      const result = await answer(tx, seed, run.attemptId, question.id, {
        selectedOptionIds: question.correctOptionIds,
        elapsedMs: 30_000 + TIMER_GRACE_MS + 1,
      })

      expect(result.correct).toBe(false)
      expect(result.timedOut).toBe(true)
      const attempt = await readAttempt(tx, run.attemptId)
      expect(attempt.score).toBe(0)
      expect(attempt.errors).toBe(1)
    })
  })

  it('rejects a second answer to the same question with DuplicateAnswerError', async () => {
    await withTestDb(async (tx) => {
      const seed = await seedQuiz(tx, { questionCount: 2 })
      const run = await startRun({ quizId: seed.quizId, player: seed.player, executor: tx })

      await answer(tx, seed, run.attemptId, run.question.id)

      await expect(answer(tx, seed, run.attemptId, run.question.id)).rejects.toThrow(
        DuplicateAnswerError,
      )
    })
  })

  it('leaves score and errors unchanged after a duplicate attempt', async () => {
    await withTestDb(async (tx) => {
      const seed = await seedQuiz(tx, { questionCount: 2 })
      const run = await startRun({ quizId: seed.quizId, player: seed.player, executor: tx })
      const question = seededQuestion(seed, run.question.id)
      await answer(tx, seed, run.attemptId, question.id)

      const duplicate = answer(tx, seed, run.attemptId, question.id, {
        selectedOptionIds: question.wrongOptionIds,
      })
      await expect(duplicate).rejects.toThrow(DuplicateAnswerError)

      const attempt = await readAttempt(tx, run.attemptId)
      expect(attempt.score).toBe(1)
      expect(attempt.errors).toBe(0)
      const stored = await tx
        .select()
        .from(attemptAnswers)
        .where(eq(attemptAnswers.attemptId, run.attemptId))
      expect(stored).toHaveLength(1)
    })
  })

  it('rejects an answer from a different player with NotYourAttemptError', async () => {
    await withTestDb(async (tx) => {
      const seed = await seedQuiz(tx, { questionCount: 2 })
      const run = await startRun({ quizId: seed.quizId, player: seed.player, executor: tx })
      const question = seededQuestion(seed, run.question.id)

      const fromSomeoneElse = submitAnswer({
        attemptId: run.attemptId,
        questionId: question.id,
        selectedOptionIds: question.correctOptionIds,
        elapsedMs: 1200,
        player: { kind: 'user', userId: `user-${crypto.randomUUID()}` },
        executor: tx,
      })
      await expect(fromSomeoneElse).rejects.toThrow(NotYourAttemptError)
    })
  })

  it('rejects a question that is not part of the attempt', async () => {
    await withTestDb(async (tx) => {
      const seed = await seedQuiz(tx, { questionCount: 3, questionsPerRun: 1 })
      const run = await startRun({ quizId: seed.quizId, player: seed.player, executor: tx })
      const outsider = seed.questions.find((question) => question.id !== run.question.id)
      if (!outsider) throw new Error('expected a question outside the attempt')

      await expect(answer(tx, seed, run.attemptId, outsider.id)).rejects.toThrow(
        QuestionNotInAttemptError,
      )
    })
  })

  it('returns the next question until the set is exhausted', async () => {
    await withTestDb(async (tx) => {
      const seed = await seedQuiz(tx, { questionCount: 3 })
      const run = await startRun({ quizId: seed.quizId, player: seed.player, executor: tx })

      const first = await answer(tx, seed, run.attemptId, run.question.id)
      if (!first.next) throw new Error('expected a second question')
      expect(first.summary).toBeNull()

      const second = await answer(tx, seed, run.attemptId, first.next.id)
      if (!second.next) throw new Error('expected a third question')
      expect(second.summary).toBeNull()

      const third = await answer(tx, seed, run.attemptId, second.next.id)
      expect(third.next).toBeNull()
      expect(third.summary).not.toBeNull()

      const attempt = await readAttempt(tx, run.attemptId)
      expect(new Set([run.question.id, first.next.id, second.next.id])).toEqual(
        new Set(attempt.questionIds),
      )
    })
  })

  it('returns a summary with passed true when errors are within maxErrors', async () => {
    await withTestDb(async (tx) => {
      const seed = await seedQuiz(tx, { questionCount: 2, maxErrors: 1 })
      const run = await startRun({ quizId: seed.quizId, player: seed.player, executor: tx })
      const question = seededQuestion(seed, run.question.id)

      const wrong = await answer(tx, seed, run.attemptId, question.id, {
        selectedOptionIds: question.wrongOptionIds,
      })
      if (!wrong.next) throw new Error('expected a second question')
      const last = await answer(tx, seed, run.attemptId, wrong.next.id)

      expect(last.summary).toEqual({
        attemptId: run.attemptId,
        score: 1,
        errors: 1,
        total: 2,
        passed: true,
      })
    })
  })

  it('returns a summary with passed false when errors exceed maxErrors', async () => {
    await withTestDb(async (tx) => {
      const seed = await seedQuiz(tx, { questionCount: 2, maxErrors: 0 })
      const run = await startRun({ quizId: seed.quizId, player: seed.player, executor: tx })
      const question = seededQuestion(seed, run.question.id)

      const wrong = await answer(tx, seed, run.attemptId, question.id, {
        selectedOptionIds: question.wrongOptionIds,
      })
      if (!wrong.next) throw new Error('expected a second question')
      const last = await answer(tx, seed, run.attemptId, wrong.next.id)

      expect(last.summary).toEqual({
        attemptId: run.attemptId,
        score: 1,
        errors: 1,
        total: 2,
        passed: false,
      })
    })
  })

  it('sets finishedAt only on the final answer', async () => {
    await withTestDb(async (tx) => {
      const seed = await seedQuiz(tx, { questionCount: 2 })
      const run = await startRun({ quizId: seed.quizId, player: seed.player, executor: tx })

      const first = await answer(tx, seed, run.attemptId, run.question.id)
      if (!first.next) throw new Error('expected a second question')
      const midRun = await readAttempt(tx, run.attemptId)
      expect(midRun.finishedAt).toBeNull()

      await answer(tx, seed, run.attemptId, first.next.id)

      const finished = await readAttempt(tx, run.attemptId)
      expect(finished.finishedAt).toBeInstanceOf(Date)
    })
  })
})
