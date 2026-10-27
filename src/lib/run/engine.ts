export const TIMER_GRACE_MS = 2000

export function sampleQuestionIds(ids: string[], n: number, rng: () => number): string[] {
  const copy = [...ids]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy.slice(0, Math.max(0, Math.min(n, copy.length)))
}

export function gradeAnswer(correctOptionIds: string[], selectedOptionIds: string[]): boolean {
  const correct = new Set(correctOptionIds)
  const selected = new Set(selectedOptionIds)
  if (correct.size !== selected.size) return false
  for (const id of selected) {
    if (!correct.has(id)) return false
  }
  return true
}

export function isTimedOut(elapsedMs: number, limitSec: number | null): boolean {
  if (limitSec === null) return false
  return elapsedMs > limitSec * 1000 + TIMER_GRACE_MS
}

export function hasPassed(errors: number, maxErrors: number): boolean {
  return errors <= maxErrors
}
