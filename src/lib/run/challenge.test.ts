import { eq, inArray } from 'drizzle-orm'
import { attempts, options, questions, quizzes, user } from '@/db/schema'
import { type TestTx, withTestDb } from '@/test/db'
import {
  ChallengeNotFoundError,
  getChallenge,
  getChallengeComparison,
  NotAChallengeError,
  startChallengeRun,
} from './challenge'
import {
  type AnswerResult,
  EmptyQuizError,
  type Player,
  type RunStart,
  type RunSummary,
  startRun,
  submitAnswer,
} from './service'

const QUIZ_TITLE = 'Italian Driving Licence - Road Signs'

type SeedOptions = {
  questionCount?: number
  questionsPerRun?: number
  maxErrors?: number
}

type SeededQuestion = {
  id: string
  correctOptionIds: string[]
  wrongOptionIds: string[]
}

type Seed = {
  quizId: string
  slug: string
  title: string
  player: Player
  questions: SeededQuestion[]
}

async function seedUser(tx: TestTx, name: string): Promise<string> {
  const userId = `user-${crypto.randomUUID()}`
  await tx.insert(user).values({ id: userId, name, email: `${userId}@example.com` })
  return userId
}

// The player who takes a challenge, never the one who issued it.
async function seedChallenger(tx: TestTx): Promise<Player> {
  return { kind: 'user', userId: await seedUser(tx, 'Challenger') }
}

// One author, one quiz, and N single-choice questions with one right and one
// wrong option each: the same shape service.test.ts plays against.
async function seedQuiz(tx: TestTx, overrides: SeedOptions = {}): Promise<Seed> {
  const { questionCount = 3, questionsPerRun = questionCount, maxErrors = 1 } = overrides

  const userId = await seedUser(tx, 'Player')
  const slug = `quiz-${crypto.randomUUID()}`
  const [quiz] = await tx
    .insert(quizzes)
    .values({
      slug,
      authorId: userId,
      title: QUIZ_TITLE,
      language: 'it',
      questionsPerRun,
      maxErrors,
    })
    .returning({ id: quizzes.id })

  const rows = Array.from({ length: questionCount }, (_, index) => ({
    quizId: quiz.id,
    position: index,
    type: 'single' as const,
    prompt: `Question ${index}`,
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

  return {
    quizId: quiz.id,
    slug,
    title: QUIZ_TITLE,
    player: { kind: 'user', userId },
    questions: inserted.map((question) => ({
      id: question.id,
      correctOptionIds: optionIdsOf(optionRows, question.id, true),
      wrongOptionIds: optionIdsOf(optionRows, question.id, false),
    })),
  }
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

// Deleting a question cascades to the answers that recorded it, which is what
// lets these tests edit a quiz somebody has already played.
async function deleteQuestions(tx: TestTx, questionIds: string[]): Promise<void> {
  await tx.delete(questions).where(inArray(questions.id, questionIds))
}

// Answers correctly and well within the clock unless the test says otherwise.
async function answer(
  tx: TestTx,
  seed: Seed,
  player: Player,
  attemptId: string,
  questionId: string,
  overrides: { selectedOptionIds?: string[] } = {},
): Promise<AnswerResult> {
  const question = seededQuestion(seed, questionId)
  return submitAnswer({
    attemptId,
    questionId,
    selectedOptionIds: overrides.selectedOptionIds ?? question.correctOptionIds,
    elapsedMs: 1200,
    player,
    executor: tx,
  })
}

// Answers every question of a run, the first `wrongCount` of them wrongly, and
// returns the summary of the now finished attempt.
async function playToEnd(
  tx: TestTx,
  seed: Seed,
  player: Player,
  run: RunStart,
  wrongCount = 0,
): Promise<RunSummary> {
  let nextId: string | null = run.question.id
  let remainingWrong = wrongCount
  let summary: RunSummary | null = null

  while (nextId) {
    const question = seededQuestion(seed, nextId)
    const selected = remainingWrong > 0 ? question.wrongOptionIds : question.correctOptionIds
    remainingWrong -= 1
    const result = await answer(tx, seed, player, run.attemptId, nextId, {
      selectedOptionIds: selected,
    })
    nextId = result.next?.id ?? null
    summary = result.summary
  }

  if (!summary) throw new Error('expected a summary at the end of the run')
  return summary
}

// A run played start to finish, which is the only kind that can be challenged.
async function finishedRun(
  tx: TestTx,
  seed: Seed,
  player: Player,
  overrides: { questionIds?: string[]; wrongCount?: number } = {},
): Promise<string> {
  const run = await startRun({
    quizId: seed.quizId,
    player,
    questionIds: overrides.questionIds,
    executor: tx,
  })
  await playToEnd(tx, seed, player, run, overrides.wrongCount)
  return run.attemptId
}

describe('getChallenge', () => {
  it('returns the invite for a finished attempt', async () => {
    await withTestDb(async (tx) => {
      const seed = await seedQuiz(tx, { questionCount: 3 })
      const attemptId = await finishedRun(tx, seed, seed.player)

      const invite = await getChallenge(attemptId, tx)

      expect(invite).toEqual({
        attemptId,
        quizId: seed.quizId,
        quizSlug: seed.slug,
        quizTitle: seed.title,
        opponentName: 'Player',
        questionCount: 3,
      })
    })
  })

  it('never includes a score, error count or pass flag', async () => {
    await withTestDb(async (tx) => {
      const seed = await seedQuiz(tx, { questionCount: 3 })
      const attemptId = await finishedRun(tx, seed, seed.player, { wrongCount: 1 })

      const invite = await getChallenge(attemptId, tx)
      if (!invite) throw new Error('expected an invite')

      // The exact key set, not a subset: the whole point of the invite is that
      // the opponent's result cannot leak into it under any name.
      expect(Object.keys(invite).sort()).toEqual([
        'attemptId',
        'opponentName',
        'questionCount',
        'quizId',
        'quizSlug',
        'quizTitle',
      ])
    })
  })

  it('returns null for an unknown attempt id', async () => {
    await withTestDb(async (tx) => {
      expect(await getChallenge(crypto.randomUUID(), tx)).toBeNull()
    })
  })

  it('returns null for an unfinished attempt', async () => {
    await withTestDb(async (tx) => {
      const seed = await seedQuiz(tx, { questionCount: 3 })
      const run = await startRun({ quizId: seed.quizId, player: seed.player, executor: tx })

      expect(await getChallenge(run.attemptId, tx)).toBeNull()
    })
  })

  it('returns null for an attempt on a hidden quiz', async () => {
    await withTestDb(async (tx) => {
      const seed = await seedQuiz(tx, { questionCount: 2 })
      const attemptId = await finishedRun(tx, seed, seed.player)
      // Hidden after the run: startRun refuses a hidden quiz outright.
      await tx.update(quizzes).set({ isHidden: true }).where(eq(quizzes.id, seed.quizId))

      expect(await getChallenge(attemptId, tx)).toBeNull()
    })
  })

  it('uses the guest nickname as the opponent name', async () => {
    await withTestDb(async (tx) => {
      const seed = await seedQuiz(tx, { questionCount: 2 })
      const guest: Player = { kind: 'guest', guestId: crypto.randomUUID(), nickname: 'Fast Fox' }
      const attemptId = await finishedRun(tx, seed, guest)

      const invite = await getChallenge(attemptId, tx)

      expect(invite?.opponentName).toBe('Fast Fox')
    })
  })

  it('uses the user name as the opponent name', async () => {
    await withTestDb(async (tx) => {
      const seed = await seedQuiz(tx, { questionCount: 2 })
      const opponent: Player = { kind: 'user', userId: await seedUser(tx, 'Giulia') }
      const attemptId = await finishedRun(tx, seed, opponent)

      const invite = await getChallenge(attemptId, tx)

      expect(invite?.opponentName).toBe('Giulia')
    })
  })

  it("falls back to 'anonymous' when a guest left no nickname", async () => {
    await withTestDb(async (tx) => {
      const seed = await seedQuiz(tx, { questionCount: 2 })
      const guest: Player = { kind: 'guest', guestId: crypto.randomUUID(), nickname: '' }
      const attemptId = await finishedRun(tx, seed, guest)

      const invite = await getChallenge(attemptId, tx)

      expect(invite?.opponentName).toBe('anonymous')
    })
  })

  it('counts only questions that still exist', async () => {
    await withTestDb(async (tx) => {
      const seed = await seedQuiz(tx, { questionCount: 4 })
      const attemptId = await finishedRun(tx, seed, seed.player)

      await deleteQuestions(tx, [seed.questions[0].id, seed.questions[2].id])

      const invite = await getChallenge(attemptId, tx)

      expect(invite?.questionCount).toBe(2)
    })
  })
})

describe('startChallengeRun', () => {
  it('replays exactly the same ordered question ids', async () => {
    await withTestDb(async (tx) => {
      const seed = await seedQuiz(tx, { questionCount: 5, questionsPerRun: 3 })
      const challenger = await seedChallenger(tx)
      const attemptId = await finishedRun(tx, seed, seed.player)
      const played = (await readAttempt(tx, attemptId)).questionIds

      const run = await startChallengeRun({ attemptId, player: challenger, executor: tx })

      const attempt = await readAttempt(tx, run.attemptId)
      expect(attempt.questionIds).toEqual(played)
      expect(run.question.id).toBe(played[0])
      expect(run.total).toBe(3)
    })
  })

  it('skips questions deleted since the original run, keeping the order of the rest', async () => {
    await withTestDb(async (tx) => {
      const seed = await seedQuiz(tx, { questionCount: 5 })
      const challenger = await seedChallenger(tx)
      const bank = seed.questions.map((question) => question.id)
      // Reversed on purpose: a replay that re-read the quiz in position order
      // would pass against a set that happens to be stored in that order.
      const attemptId = await finishedRun(tx, seed, seed.player, {
        questionIds: [...bank].reverse(),
      })

      await deleteQuestions(tx, [bank[1], bank[3]])

      const run = await startChallengeRun({ attemptId, player: challenger, executor: tx })

      const attempt = await readAttempt(tx, run.attemptId)
      expect(attempt.questionIds).toEqual([bank[4], bank[2], bank[0]])
      expect(run.question.id).toBe(bank[4])
      expect(run.total).toBe(3)
    })
  })

  it('links the new attempt to the one it answers', async () => {
    await withTestDb(async (tx) => {
      const seed = await seedQuiz(tx, { questionCount: 2 })
      const challenger = await seedChallenger(tx)
      const attemptId = await finishedRun(tx, seed, seed.player)

      const run = await startChallengeRun({ attemptId, player: challenger, executor: tx })

      const attempt = await readAttempt(tx, run.attemptId)
      expect(attempt.challengeOfAttemptId).toBe(attemptId)
    })
  })

  it('throws ChallengeNotFoundError for an unknown attempt', async () => {
    await withTestDb(async (tx) => {
      const challenger = await seedChallenger(tx)

      const run = startChallengeRun({
        attemptId: crypto.randomUUID(),
        player: challenger,
        executor: tx,
      })
      await expect(run).rejects.toThrow(ChallengeNotFoundError)
    })
  })

  it('throws ChallengeNotFoundError for an unfinished attempt', async () => {
    await withTestDb(async (tx) => {
      const seed = await seedQuiz(tx, { questionCount: 3 })
      const challenger = await seedChallenger(tx)
      const abandoned = await startRun({
        quizId: seed.quizId,
        player: seed.player,
        executor: tx,
      })

      const run = startChallengeRun({
        attemptId: abandoned.attemptId,
        player: challenger,
        executor: tx,
      })
      await expect(run).rejects.toThrow(ChallengeNotFoundError)
    })
  })

  it('throws EmptyQuizError when every question of the set was deleted', async () => {
    await withTestDb(async (tx) => {
      const seed = await seedQuiz(tx, { questionCount: 2 })
      const challenger = await seedChallenger(tx)
      const attemptId = await finishedRun(tx, seed, seed.player)

      await deleteQuestions(
        tx,
        seed.questions.map((question) => question.id),
      )

      const run = startChallengeRun({ attemptId, player: challenger, executor: tx })
      await expect(run).rejects.toThrow(EmptyQuizError)
    })
  })

  it("lets a guest take a user's challenge", async () => {
    await withTestDb(async (tx) => {
      const seed = await seedQuiz(tx, { questionCount: 2 })
      const attemptId = await finishedRun(tx, seed, seed.player)
      const guestId = crypto.randomUUID()
      const guest: Player = { kind: 'guest', guestId, nickname: 'Fast Fox' }

      const run = await startChallengeRun({ attemptId, player: guest, executor: tx })

      const attempt = await readAttempt(tx, run.attemptId)
      expect(attempt.guestId).toBe(guestId)
      expect(attempt.nickname).toBe('Fast Fox')
      expect(attempt.userId).toBeNull()
      expect(attempt.challengeOfAttemptId).toBe(attemptId)
    })
  })
})

describe('getChallengeComparison', () => {
  it('returns null while the challenger has not finished', async () => {
    await withTestDb(async (tx) => {
      const seed = await seedQuiz(tx, { questionCount: 3 })
      const challenger = await seedChallenger(tx)
      const theirAttemptId = await finishedRun(tx, seed, seed.player)
      const run = await startChallengeRun({
        attemptId: theirAttemptId,
        player: challenger,
        executor: tx,
      })

      const first = await answer(tx, seed, challenger, run.attemptId, run.question.id)
      expect(await getChallengeComparison(run.attemptId, tx)).toBeNull()

      if (!first.next) throw new Error('expected a second question')
      const second = await answer(tx, seed, challenger, run.attemptId, first.next.id)
      expect(await getChallengeComparison(run.attemptId, tx)).toBeNull()

      // Nothing changed between the two calls below but the last answer, which
      // is what sets finishedAt and so what reveals the opponent.
      if (!second.next) throw new Error('expected a third question')
      await answer(tx, seed, challenger, run.attemptId, second.next.id)
      expect(await getChallengeComparison(run.attemptId, tx)).not.toBeNull()
    })
  })

  it('returns both summaries once the challenger finishes', async () => {
    await withTestDb(async (tx) => {
      const seed = await seedQuiz(tx, { questionCount: 3, maxErrors: 1 })
      const challenger = await seedChallenger(tx)
      const theirAttemptId = await finishedRun(tx, seed, seed.player, { wrongCount: 1 })
      const run = await startChallengeRun({
        attemptId: theirAttemptId,
        player: challenger,
        executor: tx,
      })
      await playToEnd(tx, seed, challenger, run)

      const comparison = await getChallengeComparison(run.attemptId, tx)

      expect(comparison).toEqual({
        mine: { attemptId: run.attemptId, score: 3, errors: 0, total: 3, passed: true },
        theirs: { attemptId: theirAttemptId, score: 2, errors: 1, total: 3, passed: true },
      })
    })
  })

  it("reports each player's own total when the sets differ in length", async () => {
    await withTestDb(async (tx) => {
      const seed = await seedQuiz(tx, { questionCount: 4 })
      const challenger = await seedChallenger(tx)
      const theirAttemptId = await finishedRun(tx, seed, seed.player)

      await deleteQuestions(tx, [seed.questions[1].id])

      const run = await startChallengeRun({
        attemptId: theirAttemptId,
        player: challenger,
        executor: tx,
      })
      await playToEnd(tx, seed, challenger, run)

      const comparison = await getChallengeComparison(run.attemptId, tx)

      expect(comparison?.mine.total).toBe(3)
      expect(comparison?.theirs.total).toBe(4)
    })
  })

  it('throws NotAChallengeError for an attempt that is not a challenge', async () => {
    await withTestDb(async (tx) => {
      const seed = await seedQuiz(tx, { questionCount: 2 })
      const attemptId = await finishedRun(tx, seed, seed.player)

      const comparison = getChallengeComparison(attemptId, tx)
      await expect(comparison).rejects.toThrow(NotAChallengeError)
    })
  })
})
