import { db } from '@/db/client'
import { type Executor, getBestTiers } from '@/lib/quizzes/progress'
import { type Tier, worstTier } from '@/lib/run/engine'
import type { LiveStep } from './queries'

export type StepStatus = 'todo' | 'toPerfect' | 'perfected'

export function stepStatus(tier: Tier | null): StepStatus {
  if (tier === null) return 'todo'
  if (tier === 'gold') return 'perfected'
  return 'toPerfect'
}

export function pathTier(stepTiers: (Tier | null)[]): Tier | null {
  const passed = stepTiers.filter((tier): tier is Tier => tier !== null)
  if (passed.length !== stepTiers.length) return null
  return worstTier(passed)
}

export function continueTarget(
  steps: LiveStep[],
  tiers: Map<string, Tier> | null,
): { step: LiveStep; mode: 'continue' | 'perfect' } | null {
  if (tiers === null) return steps.length > 0 ? { step: steps[0], mode: 'continue' } : null

  const unplayed = steps.find((step) => !tiers.has(step.quizId))
  if (unplayed) return { step: unplayed, mode: 'continue' }

  const imperfect = steps.find((step) => tiers.get(step.quizId) !== 'gold')
  if (imperfect) return { step: imperfect, mode: 'perfect' }

  return null
}

export function progressCounts(
  steps: LiveStep[],
  tiers: Map<string, Tier>,
): { done: number; perfected: number; left: number } {
  const done = steps.filter((step) => tiers.has(step.quizId)).length
  const perfected = steps.filter((step) => tiers.get(step.quizId) === 'gold').length
  return { done, perfected, left: steps.length - done }
}

export async function getPathProgress(
  userId: string,
  steps: LiveStep[],
  executor: Executor = db,
): Promise<Map<string, Tier>> {
  return getBestTiers(
    userId,
    steps.map((step) => step.quizId),
    executor,
  )
}
