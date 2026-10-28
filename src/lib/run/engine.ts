export const TIMER_GRACE_MS = 2000

export function sampleQuestionIds(ids: string[], n: number, rng: () => number): string[] {
  return shuffled(ids, rng).slice(0, Math.max(0, Math.min(n, ids.length)))
}

// A permutation derived from a string rather than drawn fresh: the same seed
// always yields the same order, so an order can be recomputed on every read
// instead of being stored on a row or sent back by the client.
export function seededOrder<T>(items: T[], seed: string): T[] {
  return shuffled(items, mulberry32(fnv1a(seed)))
}

function shuffled<T>(items: T[], rng: () => number): T[] {
  const copy = [...items]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

// FNV-1a. A string hash short enough to read in one sitting, and mixing enough
// that two seeds differing in a single character start from unrelated states.
function fnv1a(seed: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

// mulberry32: 32 bits of state, uniform enough for shuffling a handful of
// options and reproducible across engines, which Math.random is not.
function mulberry32(seed: number): () => number {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function gradeAnswer(correctOptionIds: string[], selectedOptionIds: string[]): boolean {
  const correct = new Set(correctOptionIds)
  const selected = new Set(selectedOptionIds)
  // Validation rejects a question with no correct option, so this is latent
  // rather than live — but without it two empty sets grade as correct.
  if (correct.size === 0) return false
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
