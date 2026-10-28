// Quiz text is authored by hand and rendered to other players, so the one thing
// this file must never do is produce markup. It returns a list the UI renders as
// React children; nothing here is ever injected anywhere, which is the whole
// reason the result is a discriminated list rather than a string of HTML.

export type TextSegment = { kind: 'text' | 'code'; value: string }

const BACKTICK = '`'
const BACKSLASH = '\\'

/**
 * Splits authored text into literal text and inline-code spans.
 *
 * A pair of single backticks delimits code. Anything the rules below do not
 * recognise as a pair stays literal text: an author who typed a backtick for
 * some other reason gets a backtick, never a span that swallows the rest of
 * the sentence.
 *
 * - An unpaired backtick is literal.
 * - An empty pair is two literal backticks, not an empty span. A side effect
 *   worth knowing: a markdown-style ``double`` run is therefore literal too.
 * - A backslash escapes a backtick, in text and inside a span alike. The
 *   backslash is only special immediately before a backtick; anywhere else it
 *   is itself literal.
 * - A span is never trimmed and may contain newlines: the author's text is
 *   preserved exactly, apart from resolving the escape above.
 */
export function segmentInlineCode(input: string): TextSegment[] {
  const segments: TextSegment[] = []
  let text = ''
  let index = 0

  while (index < input.length) {
    if (isEscapedBacktick(input, index)) {
      text += BACKTICK
      index += 2
      continue
    }

    if (input[index] !== BACKTICK) {
      text += input[index]
      index += 1
      continue
    }

    const close = findClosingBacktick(input, index + 1)

    if (close === -1) {
      text += BACKTICK
      index += 1
      continue
    }

    if (close === index + 1) {
      text += BACKTICK + BACKTICK
      index += 2
      continue
    }

    // Flushed even when empty: a span at the very start of the input still
    // yields the leading text segment, so a consumer can rely on a text
    // segment sitting between any two code spans.
    segments.push({ kind: 'text', value: text })
    text = ''
    segments.push({ kind: 'code', value: unescapeBackticks(input.slice(index + 1, close)) })
    index = close + 1
  }

  if (text !== '') segments.push({ kind: 'text', value: text })
  return segments
}

function isEscapedBacktick(input: string, index: number): boolean {
  return input[index] === BACKSLASH && input[index + 1] === BACKTICK
}

// -1 when there is none, which is what makes the opening backtick literal
// rather than the start of a run to the end of the string.
function findClosingBacktick(input: string, start: number): number {
  let index = start
  while (index < input.length) {
    if (isEscapedBacktick(input, index)) {
      index += 2
      continue
    }
    if (input[index] === BACKTICK) return index
    index += 1
  }
  return -1
}

function unescapeBackticks(value: string): string {
  return value.replaceAll(`${BACKSLASH}${BACKTICK}`, BACKTICK)
}
