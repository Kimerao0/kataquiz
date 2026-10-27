import { gradeAnswer, hasPassed, isTimedOut, sampleQuestionIds, TIMER_GRACE_MS } from './engine'

function mulberry32(seed: number): () => number {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const range = (len: number) => Array.from({ length: len }, (_, i) => `q${i}`)

describe('sampleQuestionIds', () => {
  it('returns n distinct ids drawn from the input', () => {
    const ids = range(10)
    const result = sampleQuestionIds(ids, 4, mulberry32(1))
    expect(result).toHaveLength(4)
    expect(new Set(result).size).toBe(4)
    for (const id of result) expect(ids).toContain(id)
  })

  it('returns every id, shuffled, when n equals the input length', () => {
    const ids = range(10)
    const result = sampleQuestionIds(ids, 10, mulberry32(2))
    expect([...result].sort()).toEqual([...ids].sort())
  })

  it('returns all available ids when n exceeds the input length', () => {
    const ids = range(3)
    const result = sampleQuestionIds(ids, 50, mulberry32(3))
    expect([...result].sort()).toEqual([...ids].sort())
  })

  it('returns an empty array for an empty bank', () => {
    expect(sampleQuestionIds([], 5, mulberry32(4))).toEqual([])
  })

  it('returns an empty array when n is 0', () => {
    expect(sampleQuestionIds(range(5), 0, mulberry32(5))).toEqual([])
  })

  it('does not mutate the input array', () => {
    const ids = range(10)
    const snapshot = [...ids]
    sampleQuestionIds(ids, 10, mulberry32(6))
    expect(ids).toEqual(snapshot)
  })

  it('is deterministic for a seeded rng', () => {
    const ids = range(20)
    const first = sampleQuestionIds(ids, 10, mulberry32(42))
    const second = sampleQuestionIds(ids, 10, mulberry32(42))
    expect(first).toEqual(second)
  })

  it('produces different orders for different rng streams', () => {
    const ids = range(20)
    const a = sampleQuestionIds(ids, 20, mulberry32(1))
    const b = sampleQuestionIds(ids, 20, mulberry32(999))
    expect(a).not.toEqual(b)
  })
})

describe('gradeAnswer', () => {
  it('is true for the single correct option', () => {
    expect(gradeAnswer(['a'], ['a'])).toBe(true)
  })

  it('is false for the wrong single option', () => {
    expect(gradeAnswer(['a'], ['b'])).toBe(false)
  })

  it('is true for the exact correct set of a multi question', () => {
    expect(gradeAnswer(['a', 'b'], ['a', 'b'])).toBe(true)
  })

  it('is false for a correct subset', () => {
    expect(gradeAnswer(['a', 'b'], ['a'])).toBe(false)
  })

  it('is false for a superset containing a wrong option', () => {
    expect(gradeAnswer(['a', 'b'], ['a', 'b', 'c'])).toBe(false)
  })

  it('ignores the order of the selected ids', () => {
    expect(gradeAnswer(['a', 'b', 'c'], ['c', 'a', 'b'])).toBe(true)
  })

  it('ignores duplicates in the selection', () => {
    expect(gradeAnswer(['a', 'b'], ['a', 'a', 'b', 'b'])).toBe(true)
    expect(gradeAnswer(['a', 'b'], ['a', 'a'])).toBe(false)
  })

  it('is false for an empty selection', () => {
    expect(gradeAnswer(['a'], [])).toBe(false)
  })
})

describe('isTimedOut', () => {
  it('is false when limitSec is null, however long the elapsed time', () => {
    expect(isTimedOut(Number.MAX_SAFE_INTEGER, null)).toBe(false)
  })

  it('is false at exactly the limit', () => {
    expect(isTimedOut(10_000, 10)).toBe(false)
  })

  it('is false within the grace margin', () => {
    expect(isTimedOut(10_000 + TIMER_GRACE_MS, 10)).toBe(false)
  })

  it('is true beyond the limit plus grace', () => {
    expect(isTimedOut(10_000 + TIMER_GRACE_MS + 1, 10)).toBe(true)
  })

  it('is false for zero elapsed time', () => {
    expect(isTimedOut(0, 10)).toBe(false)
  })
})

describe('hasPassed', () => {
  it('passes at exactly maxErrors', () => {
    expect(hasPassed(3, 3)).toBe(true)
  })

  it('passes below maxErrors', () => {
    expect(hasPassed(2, 3)).toBe(true)
  })

  it('fails at maxErrors + 1', () => {
    expect(hasPassed(4, 3)).toBe(false)
  })

  it('fails any error when maxErrors is 0', () => {
    expect(hasPassed(1, 0)).toBe(false)
  })

  it('passes with zero errors when maxErrors is 0', () => {
    expect(hasPassed(0, 0)).toBe(true)
  })
})
