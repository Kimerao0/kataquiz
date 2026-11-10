import { attempts, quizzes, user } from '@/db/schema'
import type { Tier } from '@/lib/run/engine'
import { type TestTx, withTestDb } from '@/test/db'
import {
  continueTarget,
  getPathProgress,
  nextSuggestions,
  pathTier,
  progressCounts,
  stepStatus,
} from './progress'
import type { LiveStep, PathPlacement } from './queries'

function makeSteps(count: number): LiveStep[] {
  return Array.from({ length: count }, (_, index) => ({
    position: index + 1,
    quizId: `quiz-${index + 1}`,
    quizSlug: `slug-${index + 1}`,
    quizTitle: `Quiz ${index + 1}`,
  }))
}

describe('stepStatus', () => {
  it('maps a missing tier to todo', () => {
    expect(stepStatus(null)).toBe('todo')
    // Guards the stub: a non-null tier must not read as todo.
    expect(stepStatus('gold')).not.toBe('todo')
  })

  it('maps bronze to toPerfect', () => {
    expect(stepStatus('bronze')).toBe('toPerfect')
  })

  it('maps silver to toPerfect', () => {
    expect(stepStatus('silver')).toBe('toPerfect')
  })

  it('maps gold to perfected', () => {
    expect(stepStatus('gold')).toBe('perfected')
  })
})

describe('pathTier', () => {
  it('is gold only when every step is gold', () => {
    expect(pathTier(['gold', 'gold', 'gold'])).toBe('gold')
  })

  it('is silver when the weakest step is silver', () => {
    expect(pathTier(['gold', 'silver', 'gold'])).toBe('silver')
  })

  it('is bronze when the weakest step is bronze', () => {
    expect(pathTier(['gold', 'bronze'])).toBe('bronze')
  })

  it('is null with an unpassed step', () => {
    expect(pathTier(['gold', null, 'gold'])).toBeNull()
    // Guards the stub: a fully passed path must not be null.
    expect(pathTier(['silver'])).toBe('silver')
  })

  it('is null for no steps', () => {
    expect(pathTier([])).toBeNull()
    // Guards the stub: a fully passed path must not be null.
    expect(pathTier(['gold'])).toBe('gold')
  })
})

describe('continueTarget', () => {
  it('points at the first step not passed', () => {
    const steps = makeSteps(4)
    const tiers = new Map<string, Tier>([
      ['quiz-1', 'gold'],
      ['quiz-2', 'bronze'],
    ])

    const target = continueTarget(steps, tiers)

    expect(target).toEqual({ step: steps[2], mode: 'continue' })
  })

  it('points at the first step below gold to perfect when all are passed', () => {
    const steps = makeSteps(3)
    const tiers = new Map<string, Tier>([
      ['quiz-1', 'gold'],
      ['quiz-2', 'silver'],
      ['quiz-3', 'bronze'],
    ])

    const target = continueTarget(steps, tiers)

    expect(target).toEqual({ step: steps[1], mode: 'perfect' })
  })

  it('is null when every step is gold', () => {
    const steps = makeSteps(2)
    const tiers = new Map<string, Tier>([
      ['quiz-1', 'gold'],
      ['quiz-2', 'gold'],
    ])

    expect(continueTarget(steps, tiers)).toBeNull()
    // Guards the stub: the same steps with a gap must yield a target.
    expect(continueTarget(steps, new Map())).not.toBeNull()
  })

  it('starts a guest at the first step', () => {
    const steps = makeSteps(3)

    expect(continueTarget(steps, null)).toEqual({ step: steps[0], mode: 'continue' })
  })

  it('is null for a path with no steps', () => {
    expect(continueTarget([], null)).toBeNull()
    expect(continueTarget([], new Map())).toBeNull()
    // Guards the stub: with steps, a guest gets a target.
    expect(continueTarget(makeSteps(1), null)).not.toBeNull()
  })
})

describe('progressCounts', () => {
  it('counts done, perfected and left over a mix of tiers', () => {
    const steps = makeSteps(4)
    const tiers = new Map<string, Tier>([
      ['quiz-1', 'gold'],
      ['quiz-2', 'silver'],
      ['quiz-4', 'bronze'],
    ])

    expect(progressCounts(steps, tiers)).toEqual({ done: 3, perfected: 1, left: 1 })
  })
})

function makePlacements(count: number): PathPlacement[] {
  return Array.from({ length: count }, (_, index) => ({
    pathSlug: `path-${index + 1}`,
    pathTitle: `Path ${index + 1}`,
    position: 1,
    total: 2,
    previous: null,
    next: null,
  }))
}

describe('nextSuggestions', () => {
  it('keeps only the requested path when the quiz is in it', () => {
    const placements = makePlacements(4)

    expect(nextSuggestions(placements, 'path-2')).toEqual([placements[1]])
  })

  it('ignores a path the quiz is not in and returns up to 3', () => {
    const placements = makePlacements(5)

    expect(nextSuggestions(placements, 'elsewhere')).toEqual(placements.slice(0, 3))
  })

  it('ignores null and returns up to 3', () => {
    const placements = makePlacements(5)

    expect(nextSuggestions(placements, null)).toEqual(placements.slice(0, 3))
  })

  it('returns an empty list for no placements', () => {
    expect(nextSuggestions([], 'path-1')).toEqual([])
    expect(nextSuggestions([], null)).toEqual([])
  })
})

async function insertUser(tx: TestTx) {
  const id = `user-${crypto.randomUUID()}`
  await tx.insert(user).values({ id, name: 'Player', email: `${id}@example.com` })
  return id
}

async function seedQuiz(tx: TestTx, authorId: string) {
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

async function seedRun(tx: TestTx, userId: string, quizId: string, score: number, errors: number) {
  await tx.insert(attempts).values({
    quizId,
    questionIds: [],
    userId,
    score,
    errors,
    finishedAt: new Date(),
  })
}

function stepFor(quizId: string, position: number): LiveStep {
  return { position, quizId, quizSlug: `slug-${position}`, quizTitle: `Quiz ${position}` }
}

describe('getPathProgress', () => {
  it("returns best tiers for the path's quizzes only", async () => {
    await withTestDb(async (tx) => {
      const userId = await insertUser(tx)
      const inPath = await seedQuiz(tx, userId)
      const outside = await seedQuiz(tx, userId)
      await seedRun(tx, userId, inPath, 10, 0)
      await seedRun(tx, userId, outside, 10, 0)

      const tiers = await getPathProgress(userId, [stepFor(inPath, 1)], tx)

      expect(tiers.get(inPath)).toBe('gold')
      expect(tiers.has(outside)).toBe(false)
    })
  })

  it('returns an empty map for a user with no runs', async () => {
    await withTestDb(async (tx) => {
      const userId = await insertUser(tx)
      const quizId = await seedQuiz(tx, userId)

      const tiers = await getPathProgress(userId, [stepFor(quizId, 1)], tx)

      expect(tiers.size).toBe(0)
    })
  })
})
