import { readFileSync } from 'node:fs'
import { stringify } from 'yaml'
import { isPathText, parsePathText } from './file'

function makePath(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    kind: 'path',
    title: 'Road to Software Architect',
    language: 'en',
    steps: [{ quiz: 'a-1' }, { quiz: 'b-2' }],
    ...overrides,
  }
}

function parse(path: Record<string, unknown>) {
  return parsePathText(stringify(path))
}

describe('parsePathText', () => {
  it('parses a path with slug steps', () => {
    const result = parse(makePath())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.steps).toEqual([{ quiz: 'a-1' }, { quiz: 'b-2' }])
  })

  it('parses title steps', () => {
    const result = parse(
      makePath({ steps: [{ title: 'Architect Roadmap 01: React fundamentals' }] }),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.steps).toEqual([{ title: 'Architect Roadmap 01: React fundamentals' }])
  })

  it('rejects more than 100 steps', () => {
    const steps = Array.from({ length: 101 }, (_, i) => ({ quiz: `quiz-${i}` }))
    const result = parse(makePath({ steps }))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.some((error) => error.startsWith('steps:'))).toBe(true)
  })

  it('rejects a duplicate step', () => {
    const result = parse(makePath({ steps: [{ quiz: 'a-1' }, { quiz: 'a-1' }] }))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.join('\n')).toContain('step 2')
  })

  it('rejects a step with both quiz and title', () => {
    const result = parse(makePath({ steps: [{ quiz: 'a-1', title: 'A' }] }))
    expect(result.ok).toBe(false)
  })

  it('rejects an empty steps list', () => {
    const result = parse(makePath({ steps: [] }))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.some((error) => error.startsWith('steps:'))).toBe(true)
  })
})

describe('isPathText', () => {
  it('is true for a path in YAML', () => {
    expect(isPathText(stringify(makePath()))).toBe(true)
  })

  it('is true for a path in JSON', () => {
    expect(isPathText(JSON.stringify(makePath()))).toBe(true)
  })

  it('is false for a quiz file', () => {
    expect(isPathText(readFileSync('seeds/typescript-basics.yaml', 'utf8'))).toBe(false)
  })

  it('is false for unparseable text', () => {
    expect(isPathText('{')).toBe(false)
  })
})
