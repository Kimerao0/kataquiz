import { segmentInlineCode } from '@/lib/quiz-schema/inline-code'

/**
 * Author-supplied prose, with its backticked runs set as code.
 *
 * The rule itself lives in the schema package, which the README and the format
 * help already describe; this is only how the segments are painted. They are
 * rendered as children and never as markup: quiz content is public and
 * uploaded by strangers, so nothing here can produce an element an author
 * chose. The segmenter is imported from its own file rather than the
 * `quiz-schema` barrel, which would drag zod and yaml into the browser bundle.
 */
export function QuizText({ value }: { value: string }) {
  const segments = segmentInlineCode(value)

  // The common case is prose with no code in it at all, and returning the
  // string itself keeps the surrounding element's text a single node.
  if (segments.length === 0) return null
  if (segments.length === 1 && segments[0].kind === 'text') return segments[0].value

  return (
    <>
      {segments.map((segment, index) => {
        // The segmenter emits an empty text segment between adjacent spans and
        // before a leading one; there is nothing to paint for those.
        if (segment.value === '') return null

        return segment.kind === 'code' ? (
          <code
            // biome-ignore lint/suspicious/noArrayIndexKey: segments are re-derived from `value` on every change, so a segment's position in the string is its identity
            key={index}
            // Mono and a hairline tint, and it breaks between tokens rather
            // than inside one: `typeof x === 'string'` split mid-word across
            // two lines is unreadable.
            className="rounded-[3px] bg-rule/50 px-[0.25em] py-[0.1em] font-mono text-[0.9em] [overflow-wrap:break-word] [word-break:normal]"
          >
            {segment.value}
          </code>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: as above
          <span key={index}>{segment.value}</span>
        )
      })}
    </>
  )
}
