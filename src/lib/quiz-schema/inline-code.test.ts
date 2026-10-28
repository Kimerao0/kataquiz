import { segmentInlineCode } from './inline-code'

const text = (value: string) => ({ kind: 'text' as const, value })
const code = (value: string) => ({ kind: 'code' as const, value })

describe('segmentInlineCode', () => {
  it('returns exactly one text segment for a string with no backticks', () => {
    expect(segmentInlineCode('What does a red triangular sign mean?')).toEqual([
      text('What does a red triangular sign mean?'),
    ])
  })

  it('returns an empty list for an empty string', () => {
    expect(segmentInlineCode('')).toEqual([])
  })

  it('splits a span in the middle of a sentence', () => {
    expect(segmentInlineCode('the type of `x` here')).toEqual([
      text('the type of '),
      code('x'),
      text(' here'),
    ])
  })

  it('emits a leading empty text segment for a span at the very start', () => {
    expect(segmentInlineCode('`x` is narrowed')).toEqual([
      text(''),
      code('x'),
      text(' is narrowed'),
    ])
  })

  it('emits no trailing text segment for a span at the very end', () => {
    expect(segmentInlineCode('narrowed to `string`')).toEqual([
      text('narrowed to '),
      code('string'),
    ])
  })

  it('is one span and nothing else when the whole string is a span', () => {
    expect(segmentInlineCode('`unknown`')).toEqual([text(''), code('unknown')])
  })

  it('separates two adjacent spans with an empty text segment', () => {
    expect(segmentInlineCode('`a``b`')).toEqual([text(''), code('a'), text(''), code('b')])
  })

  it('handles several spans in one string', () => {
    expect(segmentInlineCode('`typeof` and `instanceof` narrow')).toEqual([
      text(''),
      code('typeof'),
      text(' and '),
      code('instanceof'),
      text(' narrow'),
    ])
  })

  describe('unpaired backticks', () => {
    it('treats a lone backtick as literal text', () => {
      expect(segmentInlineCode('a ` b')).toEqual([text('a ` b')])
    })

    it('does not let an unclosed backtick swallow the rest of the string', () => {
      expect(segmentInlineCode('the `x operator is odd')).toEqual([text('the `x operator is odd')])
    })

    it('keeps the trailing unpaired backtick literal after a closed span', () => {
      expect(segmentInlineCode('`a` and `')).toEqual([text(''), code('a'), text(' and `')])
    })
  })

  describe('empty pairs', () => {
    it('treats an empty pair as two literal backticks', () => {
      expect(segmentInlineCode('an empty `` pair')).toEqual([text('an empty `` pair')])
    })

    it('treats a string of only two backticks as literal text', () => {
      expect(segmentInlineCode('``')).toEqual([text('``')])
    })

    it('treats a string of only one backtick as literal text', () => {
      expect(segmentInlineCode('`')).toEqual([text('`')])
    })

    it('treats a string of only three backticks as literal text', () => {
      expect(segmentInlineCode('```')).toEqual([text('```')])
    })

    it('treats a string of only four backticks as literal text', () => {
      expect(segmentInlineCode('````')).toEqual([text('````')])
    })

    // The documented consequence of the empty-pair rule: double backticks are
    // not a markdown-style delimiter here.
    it('leaves a markdown-style double-backtick run literal', () => {
      expect(segmentInlineCode('``x``')).toEqual([text('``x``')])
    })
  })

  describe('escapes', () => {
    it('renders an escaped backtick as a literal backtick, not a delimiter', () => {
      expect(segmentInlineCode('a \\` b')).toEqual([text('a ` b')])
    })

    it('does not let an escaped backtick open a span', () => {
      expect(segmentInlineCode('\\`x\\`')).toEqual([text('`x`')])
    })

    it('does not let an escaped backtick close a span', () => {
      expect(segmentInlineCode('`a\\`b` end')).toEqual([text(''), code('a`b'), text(' end')])
    })

    it('leaves a backslash that is not before a backtick literal', () => {
      expect(segmentInlineCode('a \\n path C:\\x')).toEqual([text('a \\n path C:\\x')])
    })

    it('leaves a trailing backslash literal', () => {
      expect(segmentInlineCode('ends with \\')).toEqual([text('ends with \\')])
    })

    it('keeps a literal backslash before an escaped backtick', () => {
      expect(segmentInlineCode('\\\\`')).toEqual([text('\\`')])
    })
  })

  describe('whitespace', () => {
    it('does not trim the span', () => {
      expect(segmentInlineCode('a `  x  ` b')).toEqual([text('a '), code('  x  '), text(' b')])
    })

    it('allows a newline inside a span', () => {
      expect(segmentInlineCode('a `one\ntwo` b')).toEqual([
        text('a '),
        code('one\ntwo'),
        text(' b'),
      ])
    })
  })

  it('never returns markup, only values', () => {
    const segments = segmentInlineCode('<script>alert(1)</script> and `<b>x</b>`')
    expect(segments).toEqual([text('<script>alert(1)</script> and '), code('<b>x</b>')])
  })
})
