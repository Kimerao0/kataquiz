import { attemptAnswers, attempts, options, questions, quizzes, user } from '@/db/schema'
import { type TestTx, withTestDb } from '@/test/db'
import { canSeeStats, getQuestionStats, operatorIds } from './stats'

async function insertUser(tx: TestTx) {
  const id = `user-${crypto.randomUUID()}`
  await tx.insert(user).values({ id, name: 'Author', email: `${id}@example.com` })
  return id
}

async function seedQuiz(tx: TestTx) {
  const authorId = await insertUser(tx)
  const [quiz] = await tx
    .insert(quizzes)
    .values({
      slug: `quiz-${crypto.randomUUID()}`,
      authorId,
      title: 'A quiz',
      language: 'it',
      questionsPerRun: 10,
      maxErrors: 3,
    })
    .returning({ id: quizzes.id })

  return quiz.id
}

type OptionSeed = { text: string; correct: boolean }

// Returns the question id and its option ids, keyed by option text.
async function seedQuestion(
  tx: TestTx,
  seed: { quizId: string; position: number; type?: 'single' | 'multi'; options?: OptionSeed[] },
) {
  const [question] = await tx
    .insert(questions)
    .values({
      quizId: seed.quizId,
      position: seed.position,
      type: seed.type ?? 'single',
      prompt: `Question ${seed.position}`,
    })
    .returning({ id: questions.id })

  const optionSeeds = seed.options ?? [
    { text: 'Right', correct: true },
    { text: 'Wrong', correct: false },
  ]
  const rows = await tx
    .insert(options)
    .values(
      optionSeeds.map((option, index) => ({
        questionId: question.id,
        position: index + 1,
        text: option.text,
        isCorrect: option.correct,
      })),
    )
    .returning({ id: options.id, text: options.text })

  const optionIds = new Map(rows.map((row) => [row.text, row.id]))
  return { id: question.id, optionIds }
}

type AnswerSeed = { selected?: string[]; correct: boolean; timedOut?: boolean }

// One attempt per answer: an attempt can only answer a question once.
async function seedAnswers(tx: TestTx, quizId: string, questionId: string, answers: AnswerSeed[]) {
  for (const answer of answers) {
    const [attempt] = await tx
      .insert(attempts)
      .values({ quizId, questionIds: [questionId] })
      .returning({ id: attempts.id })
    await tx.insert(attemptAnswers).values({
      attemptId: attempt.id,
      questionId,
      selectedOptionIds: answer.selected ?? [],
      isCorrect: answer.correct,
      elapsedMs: 1000,
      timedOut: answer.timedOut ?? false,
    })
  }
}

const right: AnswerSeed = { correct: true }
const wrong: AnswerSeed = { correct: false }

describe('getQuestionStats', () => {
  it('computes the error rate over every answer', async () => {
    await withTestDb(async (tx) => {
      const quizId = await seedQuiz(tx)
      const question = await seedQuestion(tx, { quizId, position: 1 })
      await seedAnswers(tx, quizId, question.id, [right, right, right, wrong, wrong])

      const [stat] = await getQuestionStats(quizId, tx)

      expect(stat.answers).toBe(5)
      expect(stat.errorRate).toBe(0.4)
    })
  })

  it('counts a timed-out answer as wrong', async () => {
    await withTestDb(async (tx) => {
      const quizId = await seedQuiz(tx)
      const question = await seedQuestion(tx, { quizId, position: 1 })
      await seedAnswers(tx, quizId, question.id, [
        right,
        right,
        right,
        right,
        { correct: false, timedOut: true },
      ])

      const [stat] = await getQuestionStats(quizId, tx)

      expect(stat.errorRate).toBe(0.2)
    })
  })

  it('names the wrong option picked most on a single question', async () => {
    await withTestDb(async (tx) => {
      const quizId = await seedQuiz(tx)
      const question = await seedQuestion(tx, {
        quizId,
        position: 1,
        options: [
          { text: 'Paris', correct: true },
          { text: 'Lyon', correct: false },
          { text: 'Nice', correct: false },
        ],
      })
      const pick = (text: string) => [question.optionIds.get(text) as string]
      await seedAnswers(tx, quizId, question.id, [
        { selected: pick('Lyon'), correct: false },
        { selected: pick('Nice'), correct: false },
        { selected: pick('Nice'), correct: false },
      ])

      const [stat] = await getQuestionStats(quizId, tx)

      expect(stat.topWrongPick).toEqual({ text: 'Nice', count: 2 })
    })
  })

  it('counts only the wrong options of a wrong multi answer', async () => {
    await withTestDb(async (tx) => {
      const quizId = await seedQuiz(tx)
      const question = await seedQuestion(tx, {
        quizId,
        position: 1,
        type: 'multi',
        options: [
          { text: 'Signal', correct: true },
          { text: 'Check mirrors', correct: true },
          { text: 'Sound the horn', correct: false },
          { text: 'Speed up', correct: false },
        ],
      })
      const pick = (...texts: string[]) =>
        texts.map((text) => question.optionIds.get(text) as string)
      // Signal is in three wrong selections: counting it would put a correct
      // option on top.
      await seedAnswers(tx, quizId, question.id, [
        { selected: pick('Signal', 'Sound the horn'), correct: false },
        { selected: pick('Signal', 'Sound the horn'), correct: false },
        { selected: pick('Speed up'), correct: false },
        { selected: pick('Signal'), correct: false },
      ])

      const [stat] = await getQuestionStats(quizId, tx)

      expect(stat.topWrongPick).toEqual({ text: 'Sound the horn', count: 2 })
    })
  })

  it('counts an option repeated within one answer once', async () => {
    await withTestDb(async (tx) => {
      const quizId = await seedQuiz(tx)
      const question = await seedQuestion(tx, { quizId, position: 1 })
      const w = question.optionIds.get('Wrong') as string
      await seedAnswers(tx, quizId, question.id, [{ selected: [w, w, w], correct: false }])

      const [stat] = await getQuestionStats(quizId, tx)

      expect(stat.topWrongPick).toEqual({ text: 'Wrong', count: 1 })
    })
  })

  it('ignores a picked option that belongs to another question', async () => {
    await withTestDb(async (tx) => {
      const quizId = await seedQuiz(tx)
      const q1 = await seedQuestion(tx, { quizId, position: 1 })
      const q2 = await seedQuestion(tx, { quizId, position: 2 })
      const foreign = q2.optionIds.get('Wrong') as string
      await seedAnswers(tx, quizId, q1.id, [{ selected: [foreign], correct: false }])

      const stats = await getQuestionStats(quizId, tx)

      const stat = stats.find((entry) => entry.questionId === q1.id)
      expect(stat?.topWrongPick).toBeNull()
    })
  })

  it('withholds the rate below five answers and lists the question after rated ones', async () => {
    await withTestDb(async (tx) => {
      const quizId = await seedQuiz(tx)
      const few = await seedQuestion(tx, { quizId, position: 1 })
      const enough = await seedQuestion(tx, { quizId, position: 2 })
      await seedAnswers(tx, quizId, few.id, [wrong, wrong, wrong, wrong])
      await seedAnswers(tx, quizId, enough.id, [right, right, right, right, wrong])

      const stats = await getQuestionStats(quizId, tx)

      expect(stats.map((stat) => stat.questionId)).toEqual([enough.id, few.id])
      expect(stats[1].errorRate).toBeNull()
    })
  })

  it("ignores answers to another quiz's questions", async () => {
    await withTestDb(async (tx) => {
      const quizId = await seedQuiz(tx)
      const otherQuizId = await seedQuiz(tx)
      const question = await seedQuestion(tx, { quizId, position: 1 })
      const other = await seedQuestion(tx, { quizId: otherQuizId, position: 1 })
      const otherWrong = [other.optionIds.get('Wrong') as string]
      await seedAnswers(tx, otherQuizId, other.id, [
        { selected: otherWrong, correct: false },
        { selected: otherWrong, correct: false },
      ])

      const stats = await getQuestionStats(quizId, tx)

      expect(stats).toHaveLength(1)
      expect(stats[0]).toMatchObject({ questionId: question.id, answers: 0, topWrongPick: null })
    })
  })

  it('lists a question nobody has answered', async () => {
    await withTestDb(async (tx) => {
      const quizId = await seedQuiz(tx)
      const answered = await seedQuestion(tx, { quizId, position: 1 })
      const unanswered = await seedQuestion(tx, { quizId, position: 2 })
      await seedAnswers(tx, quizId, answered.id, [right])

      const stats = await getQuestionStats(quizId, tx)

      const stat = stats.find((entry) => entry.questionId === unanswered.id)
      expect(stat).toMatchObject({ answers: 0, errorRate: null, topWrongPick: null })
    })
  })
})

describe('canSeeStats', () => {
  const quiz = { authorId: 'author' }

  it("lets the quiz's author in", () => {
    expect(canSeeStats({ id: 'author' }, quiz, new Set())).toBe(true)
  })

  it('lets an operator in', () => {
    expect(canSeeStats({ id: 'operator' }, quiz, new Set(['operator']))).toBe(true)
  })

  it('keeps another signed-in user out', () => {
    expect(canSeeStats({ id: 'someone' }, quiz, new Set(['operator']))).toBe(false)
  })

  it('keeps a signed-out visitor out', () => {
    expect(canSeeStats(null, quiz, new Set(['operator']))).toBe(false)
  })

  it('keeps a non-operator out of an orphaned quiz', () => {
    expect(canSeeStats({ id: 'someone' }, { authorId: null }, new Set())).toBe(false)
  })
})

describe('operatorIds', () => {
  it('trims ids and drops empty entries', () => {
    expect(operatorIds(' a, ,b ')).toEqual(new Set(['a', 'b']))
  })
})
