import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CUSTOM_TEXT_SIZES, cn } from './utils'

describe('cn with the project text tokens', () => {
  it.each([
    ['text-title', 'text-ink', 'text-title text-ink'],
    ['text-meta', 'text-suo', 'text-meta text-suo'],
    ['text-ink-quiet text-meta', undefined, 'text-ink-quiet text-meta'],
    ['text-question', 'text-ink', 'text-question text-ink'],
    ['text-display', 'text-ai', 'text-display text-ai'],
    ['text-display-user', 'text-paper', 'text-display-user text-paper'],
    ['text-prose', 'text-rule', 'text-prose text-rule'],
  ])('keeps both size and colour: %s + %s', (a, b, expected) => {
    expect(cn(a, b)).toBe(expected)
  })

  it('keeps a colour written before a size, and a size before a colour', () => {
    expect(cn('text-ink', 'text-title')).toBe('text-ink text-title')
    expect(cn('text-title', 'text-ink')).toBe('text-title text-ink')
  })

  it('keeps a size alone', () => {
    expect(cn('text-title')).toBe('text-title')
  })

  it('keeps a colour alone', () => {
    expect(cn('text-ink')).toBe('text-ink')
  })

  it('collapses two sizes to the last', () => {
    expect(cn('text-meta', 'text-title')).toBe('text-title')
  })

  it('collapses two colours to the last', () => {
    expect(cn('text-ink', 'text-suo')).toBe('text-suo')
  })

  it('still lets a custom size override a stock size', () => {
    expect(cn('text-sm', 'text-meta')).toBe('text-meta')
  })
})

describe('CUSTOM_TEXT_SIZES', () => {
  it('lists every --text-* size declared in globals.css', () => {
    const css = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8')
    const declared = [...css.matchAll(/^\s*--text-([a-z-]+?)\s*:/gm)]
      .map((m) => m[1])
      .filter((name): name is string => name !== undefined && !name.endsWith('--line-height'))
    expect([...CUSTOM_TEXT_SIZES].sort()).toEqual([...new Set(declared)].sort())
  })
})
