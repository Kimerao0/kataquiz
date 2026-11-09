import { attemptAnswers, attempts, options, questions, quizzes, user } from '@/db/schema'
import { type TestTx, withTestDb } from '@/test/db'
import {
  getMistakeSummaries,
  getMistakes,
  getMistakeTags,
  type Mistake,
  parseMistakesTag,
  toMistakesExport,
} from './mistakes'

async function insertUser(tx: TestTx) {
  const id = `user-${crypto.randomUUID()}`
  await tx.insert(user).values({ id, name: 'Player', email: `${id}@example.com` })
  return id
}

async function seedQuiz(tx: TestTx, seed: { tags?: string[]; hidden?: boolean } = {}) {
  const [quiz] = await tx
    .insert(quizzes)
    .values({
      slug: `quiz-${crypto.randomUUID()}`,
      title: 'A quiz',
      language: 'en',
      tags: seed.tags ?? [],
      questionsPerRun: 10,
      maxErrors: 3,
      isHidden: seed.hidden ?? false,
    })
    .returning({ id: quizzes.id, slug: quizzes.slug })

  return quiz
}

async function seedQuestion(
  tx: TestTx,
  quizId: string,
  position: number,
  imageUrl: string | null = null,
) {
  const [question] = await tx
    .insert(questions)
    .values({ quizId, position, type: 'single', prompt: `Question ${position}`, imageUrl })
    .returning({ id: questions.id })

  await tx.insert(options).values([
    { questionId: question.id, position: 1, text: 'Right', isCorrect: true },
    { questionId: question.id, position: 2, text: 'Wrong', isCorrect: false },
  ])
  return question.id
}

type AnswerSeed = {
  quizId: string
  questionId: string
  userId: string | null
  correct: boolean
  at?: Date
}

// One attempt per answer: an attempt can only answer a question once. A null
// user is a guest run.
async function seedAnswer(tx: TestTx, seed: AnswerSeed) {
  const [attempt] = await tx
    .insert(attempts)
    .values({
      quizId: seed.quizId,
      questionIds: [seed.questionId],
      userId: seed.userId,
      guestId: seed.userId ? null : `guest-${crypto.randomUUID()}`,
    })
    .returning({ id: attempts.id })

  await tx.insert(attemptAnswers).values({
    attemptId: attempt.id,
    questionId: seed.questionId,
    selectedOptionIds: [],
    isCorrect: seed.correct,
    elapsedMs: 1000,
    answeredAt: seed.at ?? new Date(),
  })
}

describe('getMistakes', () => {
  it("leaves out another player's mistakes", async () => {
    await withTestDb(async (tx) => {
      const userId = await insertUser(tx)
      const otherId = await insertUser(tx)
      const quiz = await seedQuiz(tx)
      const mine = await seedQuestion(tx, quiz.id, 1)
      const theirs = await seedQuestion(tx, quiz.id, 2)
      await seedAnswer(tx, { quizId: quiz.id, questionId: mine, userId, correct: false })
      await seedAnswer(tx, { quizId: quiz.id, questionId: theirs, userId: otherId, correct: false })

      const mistakes = await getMistakes(userId, { tag: null }, tx)

      expect(mistakes.map((mistake) => mistake.questionId)).toEqual([mine])
    })
  })

  it('leaves out guest runs', async () => {
    await withTestDb(async (tx) => {
      const userId = await insertUser(tx)
      const quiz = await seedQuiz(tx)
      const signedIn = await seedQuestion(tx, quiz.id, 1)
      const asGuest = await seedQuestion(tx, quiz.id, 2)
      await seedAnswer(tx, { quizId: quiz.id, questionId: signedIn, userId, correct: false })
      await seedAnswer(tx, { quizId: quiz.id, questionId: asGuest, userId: null, correct: false })

      const mistakes = await getMistakes(userId, { tag: null }, tx)

      expect(mistakes.map((mistake) => mistake.questionId)).toEqual([signedIn])
    })
  })

  it('leaves out a question only ever answered correctly', async () => {
    await withTestDb(async (tx) => {
      const userId = await insertUser(tx)
      const quiz = await seedQuiz(tx)
      const missed = await seedQuestion(tx, quiz.id, 1)
      const known = await seedQuestion(tx, quiz.id, 2)
      await seedAnswer(tx, { quizId: quiz.id, questionId: missed, userId, correct: false })
      await seedAnswer(tx, { quizId: quiz.id, questionId: known, userId, correct: true })
      await seedAnswer(tx, { quizId: quiz.id, questionId: known, userId, correct: true })

      const mistakes = await getMistakes(userId, { tag: null }, tx)

      expect(mistakes.map((mistake) => mistake.questionId)).toEqual([missed])
    })
  })

  it('leaves out a hidden quiz', async () => {
    await withTestDb(async (tx) => {
      const userId = await insertUser(tx)
      const listed = await seedQuiz(tx)
      const hidden = await seedQuiz(tx, { hidden: true })
      const onListed = await seedQuestion(tx, listed.id, 1)
      const onHidden = await seedQuestion(tx, hidden.id, 1)
      await seedAnswer(tx, { quizId: listed.id, questionId: onListed, userId, correct: false })
      await seedAnswer(tx, { quizId: hidden.id, questionId: onHidden, userId, correct: false })

      const mistakes = await getMistakes(userId, { tag: null }, tx)

      expect(mistakes.map((mistake) => mistake.questionId)).toEqual([onListed])
    })
  })

  it('keeps only quizzes carrying the tag when filtered', async () => {
    await withTestDb(async (tx) => {
      const userId = await insertUser(tx)
      const aws = await seedQuiz(tx, { tags: ['cloud', 'aws'] })
      const k8s = await seedQuiz(tx, { tags: ['k8s'] })
      const onAws = await seedQuestion(tx, aws.id, 1)
      const onK8s = await seedQuestion(tx, k8s.id, 1)
      await seedAnswer(tx, { quizId: aws.id, questionId: onAws, userId, correct: false })
      await seedAnswer(tx, { quizId: k8s.id, questionId: onK8s, userId, correct: false })

      const filtered = await getMistakes(userId, { tag: 'aws' }, tx)
      const all = await getMistakes(userId, { tag: null }, tx)

      expect(filtered.map((mistake) => mistake.questionId)).toEqual([onAws])
      expect(all.map((mistake) => mistake.questionId).sort()).toEqual([onAws, onK8s].sort())
    })
  })

  it('counts wrong answers across runs and dates the last one', async () => {
    await withTestDb(async (tx) => {
      const userId = await insertUser(tx)
      const otherId = await insertUser(tx)
      const quiz = await seedQuiz(tx)
      const questionId = await seedQuestion(tx, quiz.id, 1)
      const mine = { quizId: quiz.id, questionId, userId }
      await seedAnswer(tx, { ...mine, correct: false, at: new Date('2026-10-01T10:00:00Z') })
      await seedAnswer(tx, { ...mine, correct: false, at: new Date('2026-10-05T10:00:00Z') })
      // Later than both mistakes: neither a right answer nor somebody else's
      // wrong one may count or move the date.
      await seedAnswer(tx, { ...mine, correct: true, at: new Date('2026-10-09T10:00:00Z') })
      await seedAnswer(tx, {
        ...mine,
        userId: otherId,
        correct: false,
        at: new Date('2026-10-10T10:00:00Z'),
      })

      const [mistake] = await getMistakes(userId, { tag: null }, tx)

      expect(mistake.timesWrong).toBe(2)
      expect(mistake.lastWrongAt).toEqual(new Date('2026-10-05T10:00:00Z'))
    })
  })

  it('lists the most recent mistake first', async () => {
    await withTestDb(async (tx) => {
      const userId = await insertUser(tx)
      const quiz = await seedQuiz(tx)
      const older = await seedQuestion(tx, quiz.id, 1)
      const newer = await seedQuestion(tx, quiz.id, 2)
      // Inserted oldest last, so insertion order alone would fail this.
      await seedAnswer(tx, {
        quizId: quiz.id,
        questionId: newer,
        userId,
        correct: false,
        at: new Date('2026-10-05T10:00:00Z'),
      })
      await seedAnswer(tx, {
        quizId: quiz.id,
        questionId: older,
        userId,
        correct: false,
        at: new Date('2026-10-01T10:00:00Z'),
      })

      const mistakes = await getMistakes(userId, { tag: null }, tx)

      expect(mistakes.map((mistake) => mistake.questionId)).toEqual([newer, older])
    })
  })

  it('returns the options in quiz order with the quiz they belong to', async () => {
    await withTestDb(async (tx) => {
      const userId = await insertUser(tx)
      const quiz = await seedQuiz(tx, { tags: ['aws'] })
      const [question] = await tx
        .insert(questions)
        .values({ quizId: quiz.id, position: 1, type: 'multi', prompt: 'Pick two' })
        .returning({ id: questions.id })
      // Inserted out of position order, so only the sort puts them right.
      await tx.insert(options).values([
        { questionId: question.id, position: 3, text: 'Third', isCorrect: true },
        { questionId: question.id, position: 1, text: 'First', isCorrect: false },
        { questionId: question.id, position: 2, text: 'Second', isCorrect: true },
      ])
      await seedAnswer(tx, { quizId: quiz.id, questionId: question.id, userId, correct: false })

      const [mistake] = await getMistakes(userId, { tag: null }, tx)

      expect(mistake.options).toEqual([
        { text: 'First', isCorrect: false },
        { text: 'Second', isCorrect: true },
        { text: 'Third', isCorrect: true },
      ])
      expect(mistake.type).toBe('multi')
      expect(mistake.quiz).toEqual({ slug: quiz.slug, title: 'A quiz', tags: ['aws'] })
    })
  })
})

describe('getMistakes imageUrl', () => {
  it('returns the question image url, or null without one', async () => {
    await withTestDb(async (tx) => {
      const userId = await insertUser(tx)
      const quiz = await seedQuiz(tx)
      const withImage = await seedQuestion(tx, quiz.id, 1, 'https://example.com/diagram.png')
      const withoutImage = await seedQuestion(tx, quiz.id, 2)
      await seedAnswer(tx, { quizId: quiz.id, questionId: withImage, userId, correct: false })
      await seedAnswer(tx, { quizId: quiz.id, questionId: withoutImage, userId, correct: false })

      const mistakes = await getMistakes(userId, { tag: null }, tx)

      const imageById = Object.fromEntries(mistakes.map((m) => [m.questionId, m.imageUrl]))
      expect(imageById).toEqual({
        [withImage]: 'https://example.com/diagram.png',
        [withoutImage]: null,
      })
    })
  })
})

describe('getMistakeSummaries', () => {
  it('lists the same questions in the same order as getMistakes', async () => {
    await withTestDb(async (tx) => {
      const userId = await insertUser(tx)
      const otherId = await insertUser(tx)
      const aws = await seedQuiz(tx, { tags: ['aws'] })
      const hidden = await seedQuiz(tx, { tags: ['aws'], hidden: true })
      const first = await seedQuestion(tx, aws.id, 1)
      const second = await seedQuestion(tx, aws.id, 2)
      const third = await seedQuestion(tx, aws.id, 3)
      const onHidden = await seedQuestion(tx, hidden.id, 1)
      const at = (day: number) => new Date(`2026-10-0${day}T10:00:00Z`)
      await seedAnswer(tx, { quizId: aws.id, questionId: first, userId, correct: false, at: at(2) })
      await seedAnswer(tx, { quizId: aws.id, questionId: first, userId, correct: false, at: at(4) })
      await seedAnswer(tx, {
        quizId: aws.id,
        questionId: second,
        userId,
        correct: false,
        at: at(6),
      })
      await seedAnswer(tx, { quizId: aws.id, questionId: third, userId, correct: true, at: at(8) })
      await seedAnswer(tx, {
        quizId: aws.id,
        questionId: third,
        userId: otherId,
        correct: false,
        at: at(9),
      })
      await seedAnswer(tx, {
        quizId: hidden.id,
        questionId: onHidden,
        userId,
        correct: false,
        at: at(9),
      })

      const summaries = await getMistakeSummaries(userId, { tag: 'aws' }, tx)
      const mistakes = await getMistakes(userId, { tag: 'aws' }, tx)

      expect(summaries.map((summary) => summary.questionId)).toEqual([second, first])
      expect(summaries.map((summary) => summary.questionId)).toEqual(
        mistakes.map((mistake) => mistake.questionId),
      )
      expect(summaries[1]).toEqual({
        questionId: first,
        prompt: 'Question 1',
        quizTitle: 'A quiz',
        timesWrong: 2,
        lastWrongAt: at(4),
      })
    })
  })
})

describe('getMistakeTags', () => {
  it('returns each tag of the quizzes with mistakes once, sorted', async () => {
    await withTestDb(async (tx) => {
      const userId = await insertUser(tx)
      const otherId = await insertUser(tx)
      const first = await seedQuiz(tx, { tags: ['beta', 'alpha'] })
      const second = await seedQuiz(tx, { tags: ['alpha', 'gamma'] })
      const hidden = await seedQuiz(tx, { tags: ['hidden'], hidden: true })
      const notMine = await seedQuiz(tx, { tags: ['theirs'] })
      const onlyRight = await seedQuiz(tx, { tags: ['right'] })
      for (const quiz of [first, second, hidden]) {
        const questionId = await seedQuestion(tx, quiz.id, 1)
        await seedAnswer(tx, { quizId: quiz.id, questionId, userId, correct: false })
        await seedAnswer(tx, { quizId: quiz.id, questionId, userId, correct: false })
      }
      const theirQuestion = await seedQuestion(tx, notMine.id, 1)
      await seedAnswer(tx, {
        quizId: notMine.id,
        questionId: theirQuestion,
        userId: otherId,
        correct: false,
      })
      const rightQuestion = await seedQuestion(tx, onlyRight.id, 1)
      await seedAnswer(tx, {
        quizId: onlyRight.id,
        questionId: rightQuestion,
        userId,
        correct: true,
      })

      const tags = await getMistakeTags(userId, tx)

      expect(tags).toEqual(['alpha', 'beta', 'gamma'])
    })
  })
})

describe('parseMistakesTag', () => {
  it('trims a tag and keeps it', () => {
    expect(parseMistakesTag('  aws ')).toBe('aws')
  })

  it('treats a missing, blank, too long or repeated tag as no filter', () => {
    expect(parseMistakesTag(undefined)).toBeNull()
    expect(parseMistakesTag('   ')).toBeNull()
    expect(parseMistakesTag('a'.repeat(65))).toBeNull()
    expect(parseMistakesTag(['aws', 'k8s'])).toBeNull()
  })
})

describe('toMistakesExport', () => {
  it('wraps the mistakes in the versioned export format', () => {
    const mistake: Mistake = {
      questionId: '00000000-0000-4000-8000-000000000001',
      type: 'single',
      prompt: 'Which service stores objects?',
      code: null,
      codeLanguage: null,
      imageUrl: 'https://example.com/diagram.png',
      explanation: 'S3 is object storage.',
      theoryUrl: null,
      quiz: { slug: 'aws-basics', title: 'AWS basics', tags: ['aws'] },
      options: [
        { text: 'S3', isCorrect: true },
        { text: 'EBS', isCorrect: false },
      ],
      timesWrong: 2,
      lastWrongAt: new Date('2026-10-05T10:00:00Z'),
    }

    const exported = toMistakesExport([mistake], 'aws', new Date('2026-11-03T12:00:00Z'))

    expect(exported).toEqual({
      format: 'kataquiz-mistakes',
      version: 1,
      exportedAt: '2026-11-03T12:00:00.000Z',
      tag: 'aws',
      mistakes: [
        {
          questionId: '00000000-0000-4000-8000-000000000001',
          type: 'single',
          prompt: 'Which service stores objects?',
          code: null,
          codeLanguage: null,
          imageUrl: 'https://example.com/diagram.png',
          options: [
            { text: 'S3', isCorrect: true },
            { text: 'EBS', isCorrect: false },
          ],
          explanation: 'S3 is object storage.',
          theoryUrl: null,
          quiz: { slug: 'aws-basics', title: 'AWS basics', tags: ['aws'] },
          timesWrong: 2,
          lastWrongAt: '2026-10-05T10:00:00.000Z',
        },
      ],
    })
  })

  it('carries a null tag for an unfiltered export', () => {
    const exported = toMistakesExport([], null, new Date('2026-11-03T12:00:00Z'))

    expect(exported.tag).toBeNull()
    expect(exported.mistakes).toEqual([])
  })
})
