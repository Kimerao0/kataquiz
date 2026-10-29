import { eq, inArray } from 'drizzle-orm'
import { attemptAnswers, attempts, options, questions, quizzes, user } from '@/db/schema'
import { type TestTx, withTestDb } from '@/test/db'
import { TIMER_GRACE_MS } from './engine'
import {
  AttemptNotFoundError,
  DuplicateAnswerError,
  EmptyQuizError,
  findResumableRun,
  NotYourAttemptError,
  type Player,
  type PublicQuestion,
  QuestionNotInAttemptError,
  QuizNotFoundError,
  type RunStart,
  resumeRun,
  startRun,
  submitAnswer,
} from './service'

type SeedOptions = {
  questionCount?: number
  questionsPerRun?: number
  maxErrors?: number
  timePerQuestionSec?: number | null
  isHidden?: boolean
  /** More than two makes a coincidental shuffle collision implausible. */
  optionsPerQuestion?: number
  /** 'boolean' seeds True/False options, which are exempt from the shuffle. */
  questionType?: 'single' | 'boolean'
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
// single-choice questions, each with the one right option stored first and the
// rest wrong — the way authors overwhelmingly write them.
async function seedQuiz(tx: TestTx, overrides: SeedOptions = {}): Promise<Seed> {
  const {
    questionCount = 3,
    questionsPerRun = questionCount,
    maxErrors = 1,
    timePerQuestionSec = null,
    isHidden = false,
    optionsPerQuestion = 2,
    questionType = 'single' as 'single' | 'boolean',
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
    type: questionType,
    prompt: `Question ${index}`,
    explanation: `Rule ${index} says so`,
    theoryUrl: `https://example.com/theory/${index}`,
  }))
  const inserted = await tx.insert(questions).values(rows).returning({ id: questions.id })

  const optionRows = await tx
    .insert(options)
    .values(
      inserted.flatMap((question, index) =>
        Array.from({ length: optionsPerQuestion }, (_, position) => ({
          questionId: question.id,
          position,
          text:
            questionType === 'boolean'
              ? ['True', 'False'][position]
              : position === 0
                ? `Right ${index}`
                : `Wrong ${index}.${position}`,
          isCorrect: position === 0,
        })),
      ),
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

// The order the player was shown, as one comparable value.
function orderOf(question: PublicQuestion): string {
  return question.options.map((option) => option.id).join(',')
}

// Starts runs until the shuffle puts the right answer somewhere other than the
// top of the list. The order is a pure function of the attempt id, so this is a
// search across attempts and not a retry of a flaky call.
async function runWhereRightAnswerIsNotFirst(tx: TestTx, seed: Seed): Promise<RunStart> {
  const [correctId] = seed.questions[0].correctOptionIds
  for (let i = 0; i < 20; i++) {
    const run = await startRun({ quizId: seed.quizId, player: seed.player, executor: tx })
    if (run.question.options[0].id !== correctId) return run
  }
  throw new Error('the shuffle never moved the right answer off the first position')
}

async function readAttempt(tx: TestTx, attemptId: string) {
  const [attempt] = await tx.select().from(attempts).where(eq(attempts.id, attemptId))
  return attempt
}

// Deleting a question cascades to the answers that recorded it, but not to the
// `questionIds` snapshot on the attempt: that is a uuid[] column, which is
// exactly why a run can still be holding an id that no longer resolves.
async function deleteQuestions(tx: TestTx, questionIds: string[]): Promise<void> {
  await tx.delete(questions).where(inArray(questions.id, questionIds))
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

// Plays every question the run holds, in the stored order, and returns the last
// result: the one that carries the summary.
async function playToTheEnd(tx: TestTx, seed: Seed, attemptId: string) {
  const { questionIds } = await readAttempt(tx, attemptId)
  let last: Awaited<ReturnType<typeof answer>> | undefined
  for (const id of questionIds) last = await answer(tx, seed, attemptId, id)
  if (!last) throw new Error('expected the attempt to hold questions')
  return last
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
      expect(run.question.code).toBeNull()
      expect(run.question.codeLanguage).toBeNull()
      // Sorted: which options come back is this test's business, the order they
      // come back in belongs to the shuffle tests below.
      expect(run.question.options.map((option) => option.text).sort()).toEqual([
        'Right 0',
        'Wrong 0.1',
      ])
      expect(run.timePerQuestionSec).toBe(30)
    })
  })

  it('serves the code block and its language on the public question', async () => {
    await withTestDb(async (tx) => {
      const seed = await seedQuiz(tx, { questionCount: 1 })
      const code =
        "function f(x: string | number) {\n  if (typeof x === 'string') {\n    // here\n  }\n}"
      await tx
        .update(questions)
        .set({ code, codeLanguage: 'typescript' })
        .where(eq(questions.id, seed.questions[0].id))

      const run = await startRun({ quizId: seed.quizId, player: seed.player, executor: tx })

      expect(run.question.code).toBe(code)
      expect(run.question.codeLanguage).toBe('typescript')
    })
  })

  it('never exposes correctness on an unanswered question', async () => {
    await withTestDb(async (tx) => {
      const seed = await seedQuiz(tx, { questionCount: 3 })

      const run = await startRun({ quizId: seed.quizId, player: seed.player, executor: tx })

      for (const option of run.question.options) {
        expect(Object.keys(option).sort()).toEqual(['id', 'text'])
      }
      // The question is projected column by column for the same reason, so its
      // key set is pinned here too: a spread of the question row would widen
      // this silently every time a column is added to the table.
      expect(Object.keys(run.question).sort()).toEqual([
        'code',
        'codeLanguage',
        'id',
        'imageUrl',
        'options',
        'prompt',
        'type',
      ])
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

  it('shuffles option order', async () => {
    await withTestDb(async (tx) => {
      const seed = await seedQuiz(tx, { questionCount: 1, optionsPerQuestion: 6 })

      const orders = new Set<string>()
      for (let i = 0; i < 8; i++) {
        const run = await startRun({ quizId: seed.quizId, player: seed.player, executor: tx })
        orders.add(orderOf(run.question))
      }

      // The seed stores the right answer first every time. Hand the stored
      // order straight to the player and all eight runs collapse onto one
      // signature, which is the leak this test exists to keep closed.
      expect(orders.size).toBeGreaterThan(1)
    })
  })

  it('never shuffles a true/false question', async () => {
    // Shuffling exists to stop a player learning the position instead of the
    // rule. With two options a player reads both anyway, so the leak is
    // negligible while "False, True" is a jarring read. Many attempts, because
    // a two-item shuffle agreeing by chance is a coin toss each time.
    await withTestDb(async (tx) => {
      const seed = await seedQuiz(tx, { questionCount: 1, questionType: 'boolean' })

      for (let attempt = 0; attempt < 12; attempt++) {
        const run = await startRun({ quizId: seed.quizId, player: seed.player, executor: tx })
        expect(run.question.options.map((option) => option.text)).toEqual(['True', 'False'])
      }
    })
  })

  it('returns a stable order for the same attempt', async () => {
    await withTestDb(async (tx) => {
      const seed = await seedQuiz(tx, { questionCount: 2, optionsPerQuestion: 6 })
      const run = await startRun({ quizId: seed.quizId, player: seed.player, executor: tx })
      const attempt = await readAttempt(tx, run.attemptId)
      const other = attempt.questionIds.find((id) => id !== run.question.id)
      if (!other) throw new Error('expected a second question in the attempt')

      // Answering the other question first makes the service hand this one back
      // as `next`: a genuine second read of the same question in one attempt,
      // which is what a retried submit or a re-render asks for.
      const result = await answer(tx, seed, run.attemptId, other)

      if (!result.next) throw new Error('expected the unanswered question back')
      expect(result.next.id).toBe(run.question.id)
      expect(orderOf(result.next)).toBe(orderOf(run.question))
    })
  })

  it('gives two attempts on the same question different orders', async () => {
    await withTestDb(async (tx) => {
      const seed = await seedQuiz(tx, { questionCount: 1, optionsPerQuestion: 10 })

      const first = await startRun({ quizId: seed.quizId, player: seed.player, executor: tx })
      const second = await startRun({ quizId: seed.quizId, player: seed.player, executor: tx })

      expect(second.attemptId).not.toBe(first.attemptId)
      expect(second.question.id).toBe(first.question.id)
      // Ten options: two attempts landing on the same order by chance is one in
      // 3.6 million, so a red here is a bug and not luck.
      expect(orderOf(second.question)).not.toBe(orderOf(first.question))
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

  it('grades correctly regardless of the order the options were presented in', async () => {
    await withTestDb(async (tx) => {
      const seed = await seedQuiz(tx, { questionCount: 1, optionsPerQuestion: 6 })
      const [question] = seed.questions
      const [correctId] = question.correctOptionIds

      const displaced = await runWhereRightAnswerIsNotFirst(tx, seed)
      // Proven rather than assumed: in this attempt the right answer sits
      // somewhere other than the top of the list the player saw.
      const shownAt = displaced.question.options.findIndex((option) => option.id === correctId)
      expect(shownAt).toBeGreaterThan(0)

      const right = await answer(tx, seed, displaced.attemptId, question.id, {
        selectedOptionIds: [correctId],
      })
      expect(right.correct).toBe(true)
      expect(right.correctOptionIds).toEqual([correctId])

      // And the option that happened to be shown first is still wrong: grading
      // that ever went back to comparing positions would fail one of these two
      // halves whichever way round it did it.
      const other = await runWhereRightAnswerIsNotFirst(tx, seed)
      const [shownFirst] = other.question.options
      const firstPick = await answer(tx, seed, other.attemptId, question.id, {
        selectedOptionIds: [shownFirst.id],
      })
      expect(firstPick.correct).toBe(false)
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

  it('skips a question deleted mid-run and serves the next surviving one', async () => {
    await withTestDb(async (tx) => {
      const seed = await seedQuiz(tx, { questionCount: 3 })
      const run = await startRun({ quizId: seed.quizId, player: seed.player, executor: tx })
      // The stored order, not the seed order: the sample decides which id is
      // second, and this test is about the one the player would be served next.
      const [first, second, third] = (await readAttempt(tx, run.attemptId)).questionIds

      await deleteQuestions(tx, [second])

      const result = await answer(tx, seed, run.attemptId, first)

      // The deleted one is stepped over, not served as nothing.
      expect(result.next?.id).toBe(third)
      expect(result.summary).toBeNull()
      expect((await readAttempt(tx, run.attemptId)).finishedAt).toBeNull()

      // And the run still reaches its end from there.
      const last = await answer(tx, seed, run.attemptId, third)
      expect(last.next).toBeNull()
      expect(last.summary).not.toBeNull()
    })
  })

  it('finishes the run when every remaining question was deleted', async () => {
    await withTestDb(async (tx) => {
      const seed = await seedQuiz(tx, { questionCount: 3, maxErrors: 1 })
      const run = await startRun({ quizId: seed.quizId, player: seed.player, executor: tx })
      const [first, second, third] = (await readAttempt(tx, run.attemptId)).questionIds

      await deleteQuestions(tx, [second, third])

      const result = await answer(tx, seed, run.attemptId, first)

      // next and summary both null is the stranded run: the player has nothing
      // to press and the server never calls the run over. One of the two has to
      // be there, and with nothing left to serve it is the summary.
      expect(result.next).toBeNull()
      expect(result.summary).not.toBeNull()
      expect(result.summary).toEqual({
        attemptId: run.attemptId,
        score: 1,
        errors: 0,
        // The set the run was started with, which is what the attempt stores
        // and what the challenge comparison reports too — the player answered
        // fewer than that because two of them stopped existing.
        total: 3,
        passed: true,
      })
    })
  })

  it('sets finishedAt when it finishes early for that reason', async () => {
    await withTestDb(async (tx) => {
      const seed = await seedQuiz(tx, { questionCount: 3 })
      const run = await startRun({ quizId: seed.quizId, player: seed.player, executor: tx })
      const [first, second, third] = (await readAttempt(tx, run.attemptId)).questionIds

      await deleteQuestions(tx, [second, third])

      const result = await answer(tx, seed, run.attemptId, first)

      // The separate assertion, and the one that matters: a run can come back
      // looking finished and still have no finishedAt, because the summary is
      // built in JS while finishedAt is written by the UPDATE. Nothing in the
      // return value would show it, and the consequence is invisible until
      // later — getChallenge refuses an attempt with no finishedAt, so the
      // player is quietly denied the challenge link they earned.
      const attempt = await readAttempt(tx, run.attemptId)
      expect(attempt.finishedAt).toBeInstanceOf(Date)

      // Pinned together so the pair can never drift: a summary is the server
      // saying the run is over, and finishedAt is where it says so durably.
      expect(result.summary).not.toBeNull()
    })
  })
})

describe('findResumableRun', () => {
  it('finds the run in flight with how far it got', async () => {
    await withTestDb(async (tx) => {
      const seed = await seedQuiz(tx, { questionCount: 5, questionsPerRun: 3 })
      const run = await startRun({ quizId: seed.quizId, player: seed.player, executor: tx })
      await answer(tx, seed, run.attemptId, run.question.id)

      const found = await findResumableRun({
        quizId: seed.quizId,
        player: seed.player,
        executor: tx,
      })

      expect(found).toEqual({ attemptId: run.attemptId, answered: 1, total: run.total })
    })
  })

  it('ignores a finished run', async () => {
    await withTestDb(async (tx) => {
      const seed = await seedQuiz(tx, { questionCount: 2 })
      const run = await startRun({ quizId: seed.quizId, player: seed.player, executor: tx })
      await playToTheEnd(tx, seed, run.attemptId)

      const found = await findResumableRun({
        quizId: seed.quizId,
        player: seed.player,
        executor: tx,
      })

      expect(found).toBeNull()
    })
  })

  it('ignores an attempt nobody answered', async () => {
    await withTestDb(async (tx) => {
      const seed = await seedQuiz(tx, { questionCount: 2 })
      await startRun({ quizId: seed.quizId, player: seed.player, executor: tx })

      const found = await findResumableRun({
        quizId: seed.quizId,
        player: seed.player,
        executor: tx,
      })

      // Offering to resume this would be offering a run the player never began.
      expect(found).toBeNull()
    })
  })

  it("ignores another player's run", async () => {
    await withTestDb(async (tx) => {
      const seed = await seedQuiz(tx, { questionCount: 2 })
      const run = await startRun({ quizId: seed.quizId, player: seed.player, executor: tx })
      await answer(tx, seed, run.attemptId, run.question.id)
      const otherUser: Player = { kind: 'user', userId: `user-${crypto.randomUUID()}` }
      const guest: Player = { kind: 'guest', guestId: crypto.randomUUID(), nickname: '' }

      // The ownership guard: drop it and a stranger is offered somebody else's
      // run, which resumeRun would then refuse to open.
      for (const player of [otherUser, guest]) {
        const found = await findResumableRun({ quizId: seed.quizId, player, executor: tx })
        expect(found).toBeNull()
      }
    })
  })

  it('finds a guest their own run', async () => {
    await withTestDb(async (tx) => {
      const seed = await seedQuiz(tx, { questionCount: 2 })
      const guest: Player = { kind: 'guest', guestId: crypto.randomUUID(), nickname: 'Fast Fox' }
      const run = await startRun({ quizId: seed.quizId, player: guest, executor: tx })
      await answer(tx, { ...seed, player: guest }, run.attemptId, run.question.id)

      const found = await findResumableRun({ quizId: seed.quizId, player: guest, executor: tx })

      expect(found?.attemptId).toBe(run.attemptId)
    })
  })

  it('ignores a challenge run', async () => {
    await withTestDb(async (tx) => {
      const seed = await seedQuiz(tx, { questionCount: 2 })
      // The run being challenged belongs to somebody else, which is what a
      // challenge is. It also has to: started by this player it would be a
      // second unfinished attempt of their own, and the zero-answer guard
      // would answer null whether the challenge filter existed or not — the
      // test would pass against a function that had lost it.
      const opponent: Player = { kind: 'guest', guestId: crypto.randomUUID(), nickname: 'Rival' }
      const original = await startRun({ quizId: seed.quizId, player: opponent, executor: tx })
      const challenge = await startRun({
        quizId: seed.quizId,
        player: seed.player,
        challengeOfAttemptId: original.attemptId,
        executor: tx,
      })
      await answer(tx, seed, challenge.attemptId, challenge.question.id)

      const found = await findResumableRun({
        quizId: seed.quizId,
        player: seed.player,
        executor: tx,
      })

      // Resumed from the plain quiz page it would lose its head-to-head framing.
      expect(found).toBeNull()
    })
  })

  it('takes the most recent of two runs', async () => {
    await withTestDb(async (tx) => {
      const seed = await seedQuiz(tx, { questionCount: 2 })
      const older = await startRun({ quizId: seed.quizId, player: seed.player, executor: tx })
      const newer = await startRun({ quizId: seed.quizId, player: seed.player, executor: tx })
      await answer(tx, seed, older.attemptId, older.question.id)
      await answer(tx, seed, newer.attemptId, newer.question.id)
      // started_at defaults to now(), which Postgres fixes at the start of the
      // transaction: inside this harness both rows carry the same instant and
      // "latest" would be a tie. So the times are written explicitly, and the
      // run inserted first is made the later one, so insertion order cannot
      // produce the right answer by accident.
      await tx
        .update(attempts)
        .set({ startedAt: new Date('2026-01-02T00:00:00Z') })
        .where(eq(attempts.id, older.attemptId))
      await tx
        .update(attempts)
        .set({ startedAt: new Date('2026-01-01T00:00:00Z') })
        .where(eq(attempts.id, newer.attemptId))

      const found = await findResumableRun({
        quizId: seed.quizId,
        player: seed.player,
        executor: tx,
      })

      expect(found?.attemptId).toBe(older.attemptId)
    })
  })

  it('looks past an attempt nobody answered', async () => {
    await withTestDb(async (tx) => {
      const seed = await seedQuiz(tx, { questionCount: 2 })
      const played = await startRun({ quizId: seed.quizId, player: seed.player, executor: tx })
      await answer(tx, seed, played.attemptId, played.question.id)
      const abandoned = await startRun({ quizId: seed.quizId, player: seed.player, executor: tx })
      // Written explicitly for the reason the test above gives: inside one
      // transaction both rows carry the same now(), so without this the order
      // is a tie and a function that only looks at the latest row could pass by
      // luck.
      await tx
        .update(attempts)
        .set({ startedAt: new Date('2026-01-02T00:00:00Z') })
        .where(eq(attempts.id, abandoned.attemptId))
      await tx
        .update(attempts)
        .set({ startedAt: new Date('2026-01-01T00:00:00Z') })
        .where(eq(attempts.id, played.attemptId))

      const found = await findResumableRun({
        quizId: seed.quizId,
        player: seed.player,
        executor: tx,
      })

      // A Start over the player walked away from immediately must not hide the
      // run that still has their work in it.
      expect(found?.attemptId).toBe(played.attemptId)
    })
  })
})

describe('resumeRun', () => {
  it('serves the question the server is waiting for', async () => {
    await withTestDb(async (tx) => {
      const seed = await seedQuiz(tx, { questionCount: 4 })
      const run = await startRun({ quizId: seed.quizId, player: seed.player, executor: tx })
      const [first, second] = (await readAttempt(tx, run.attemptId)).questionIds
      await answer(tx, seed, run.attemptId, first)

      const resumed = await resumeRun({
        quizId: seed.quizId,
        attemptId: run.attemptId,
        player: seed.player,
        executor: tx,
      })

      if (resumed.status !== 'playing') throw new Error('expected a run still in play')
      expect(resumed.answered).toBe(1)
      expect(resumed.total).toBe(run.total)
      expect(resumed.question.id).toBe(second)
    })
  })

  it('returns the history in played order with the option order the player saw', async () => {
    await withTestDb(async (tx) => {
      const seed = await seedQuiz(tx, { questionCount: 4, optionsPerQuestion: 4 })
      const run = await startRun({ quizId: seed.quizId, player: seed.player, executor: tx })
      const [first, second] = (await readAttempt(tx, run.attemptId)).questionIds
      const firstPick = seededQuestion(seed, first).wrongOptionIds.slice(0, 1)
      const afterFirst = await answer(tx, seed, run.attemptId, first, {
        selectedOptionIds: firstPick,
      })
      if (!afterFirst.next) throw new Error('expected a second question')
      const secondPick = seededQuestion(seed, second).correctOptionIds
      await answer(tx, seed, run.attemptId, second, { selectedOptionIds: secondPick })

      const resumed = await resumeRun({
        quizId: seed.quizId,
        attemptId: run.attemptId,
        player: seed.player,
        executor: tx,
      })

      expect(resumed.history.map((entry) => entry.question.id)).toEqual([first, second])
      expect(resumed.history.map((entry) => entry.selectedOptionIds)).toEqual([
        firstPick,
        secondPick,
      ])
      // Seeded on the attempt: a resumed question that reshuffled would quietly
      // relabel what the player picked.
      expect(orderOf(resumed.history[0].question)).toBe(orderOf(run.question))
      expect(orderOf(resumed.history[1].question)).toBe(orderOf(afterFirst.next))
    })
  })

  it('carries the verdict, the explanation and the theory link', async () => {
    await withTestDb(async (tx) => {
      const seed = await seedQuiz(tx, { questionCount: 3 })
      const run = await startRun({ quizId: seed.quizId, player: seed.player, executor: tx })
      const [first, second] = (await readAttempt(tx, run.attemptId)).questionIds
      await answer(tx, seed, run.attemptId, first, {
        selectedOptionIds: seededQuestion(seed, first).wrongOptionIds,
      })
      await answer(tx, seed, run.attemptId, second)

      const resumed = await resumeRun({
        quizId: seed.quizId,
        attemptId: run.attemptId,
        player: seed.player,
        executor: tx,
      })

      const [wrong, right] = resumed.history.map((entry) => entry.result)
      const wrongSource = seededQuestion(seed, first)
      const rightSource = seededQuestion(seed, second)
      expect(wrong.correct).toBe(false)
      expect(right.correct).toBe(true)
      expect(wrong.correctOptionIds).toEqual(wrongSource.correctOptionIds)
      expect(right.correctOptionIds).toEqual(rightSource.correctOptionIds)
      expect(wrong.explanation).toBe(wrongSource.explanation)
      expect(wrong.theoryUrl).toBe(wrongSource.theoryUrl)
      expect(right.explanation).toBe(rightSource.explanation)
      expect(right.theoryUrl).toBe(rightSource.theoryUrl)
      // What the server said next at grading time is not something a replay may
      // invent.
      for (const result of [wrong, right]) {
        expect(result.next).toBeNull()
        expect(result.summary).toBeNull()
      }
    })
  })

  it('carries a timeout as a timeout', async () => {
    await withTestDb(async (tx) => {
      const seed = await seedQuiz(tx, { questionCount: 3, timePerQuestionSec: 30 })
      const run = await startRun({ quizId: seed.quizId, player: seed.player, executor: tx })
      // The right selection, so only the clock can be what made it wrong.
      await answer(tx, seed, run.attemptId, run.question.id, {
        elapsedMs: 30_000 + TIMER_GRACE_MS + 1,
      })

      const resumed = await resumeRun({
        quizId: seed.quizId,
        attemptId: run.attemptId,
        player: seed.player,
        executor: tx,
      })

      expect(resumed.history[0].result.timedOut).toBe(true)
      expect(resumed.history[0].result.correct).toBe(false)
    })
  })

  it("refuses another player's attempt", async () => {
    await withTestDb(async (tx) => {
      const seed = await seedQuiz(tx, { questionCount: 2 })
      const run = await startRun({ quizId: seed.quizId, player: seed.player, executor: tx })
      const stranger: Player = { kind: 'user', userId: `user-${crypto.randomUUID()}` }

      await expect(
        resumeRun({
          quizId: seed.quizId,
          attemptId: run.attemptId,
          player: stranger,
          executor: tx,
        }),
      ).rejects.toThrow(NotYourAttemptError)
    })
  })

  it('refuses an attempt that does not exist', async () => {
    await withTestDb(async (tx) => {
      const seed = await seedQuiz(tx, { questionCount: 2 })

      await expect(
        resumeRun({
          quizId: seed.quizId,
          attemptId: crypto.randomUUID(),
          player: seed.player,
          executor: tx,
        }),
      ).rejects.toThrow(AttemptNotFoundError)
    })
  })

  it('refuses a run on a quiz that has since been hidden', async () => {
    await withTestDb(async (tx) => {
      const seed = await seedQuiz(tx, { questionCount: 2 })
      const run = await startRun({ quizId: seed.quizId, player: seed.player, executor: tx })
      await tx.update(quizzes).set({ isHidden: true }).where(eq(quizzes.id, seed.quizId))

      await expect(
        resumeRun({
          quizId: seed.quizId,
          attemptId: run.attemptId,
          player: seed.player,
          executor: tx,
        }),
      ).rejects.toThrow(QuizNotFoundError)
    })
  })

  it('returns finished for a run that is already over', async () => {
    await withTestDb(async (tx) => {
      const seed = await seedQuiz(tx, { questionCount: 3, maxErrors: 1 })
      const run = await startRun({ quizId: seed.quizId, player: seed.player, executor: tx })
      const [first, second, third] = (await readAttempt(tx, run.attemptId)).questionIds
      await answer(tx, seed, run.attemptId, first, {
        selectedOptionIds: seededQuestion(seed, first).wrongOptionIds,
      })
      await answer(tx, seed, run.attemptId, second)
      const last = await answer(tx, seed, run.attemptId, third)

      const resumed = await resumeRun({
        quizId: seed.quizId,
        attemptId: run.attemptId,
        player: seed.player,
        executor: tx,
      })

      if (resumed.status !== 'finished') throw new Error('expected a finished run')
      expect(last.summary).not.toBeNull()
      expect(resumed.summary).toEqual(last.summary)
      expect(resumed.answered).toBe(3)
      expect(resumed.history).toHaveLength(3)
    })
  })

  it('finishes a run whose remaining questions were all deleted', async () => {
    await withTestDb(async (tx) => {
      const seed = await seedQuiz(tx, { questionCount: 3 })
      const run = await startRun({ quizId: seed.quizId, player: seed.player, executor: tx })
      const [first, second, third] = (await readAttempt(tx, run.attemptId)).questionIds
      await answer(tx, seed, run.attemptId, first)
      await deleteQuestions(tx, [second, third])

      const resumed = await resumeRun({
        quizId: seed.quizId,
        attemptId: run.attemptId,
        player: seed.player,
        executor: tx,
      })

      expect(resumed.status).toBe('finished')
      // The write is the point: without it the dead attempt is offered for ever.
      expect((await readAttempt(tx, run.attemptId)).finishedAt).toBeInstanceOf(Date)
    })
  })

  it('refuses an attempt from another quiz', async () => {
    await withTestDb(async (tx) => {
      const seed = await seedQuiz(tx, { questionCount: 2 })
      const otherQuiz = await seedQuiz(tx, { questionCount: 2 })
      const run = await startRun({ quizId: seed.quizId, player: seed.player, executor: tx })

      // Opened from the other quiz's page the run would take that quiz's slug
      // on every link and on its summary.
      await expect(
        resumeRun({
          quizId: otherQuiz.quizId,
          attemptId: run.attemptId,
          player: seed.player,
          executor: tx,
        }),
      ).rejects.toThrow(AttemptNotFoundError)
    })
  })
})
