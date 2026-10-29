'use client'

import { useState } from 'react'
import { httpUrlOrNull } from './safe-url'

/**
 * A snippet the question is about, which is not a sentence and must not be set
 * as one. It scrolls sideways rather than wrapping: a function body folded
 * across five lines mid-token is the thing this block exists to stop.
 */
export function QuestionCode({ code, language }: { code: string; language: string | null }) {
  return (
    <div className="flex flex-col gap-1.5">
      {language !== null && <p className="text-ink-quiet text-meta">{language}</p>}
      {/* Focusable because it scrolls: a region a mouse can pan and a keyboard
          cannot is unreachable for anyone without the mouse. */}
      <pre
        // biome-ignore lint/a11y/noNoninteractiveTabindex: a region that scrolls has to be reachable by keyboard (WCAG 2.1.1), and this one pans sideways rather than wrapping
        tabIndex={0}
        className="overflow-x-auto rounded-md border border-rule bg-rule/35 p-4 font-mono text-[0.9375rem] leading-relaxed"
      >
        {/* Plain children: the snippet is author-supplied and stays text. */}
        <code>{code}</code>
      </pre>
    </div>
  )
}

// An author-supplied external URL: a plain <img> rather than next/image, which
// would need every host allow-listed. A fixed max height keeps a slow or
// oversized file from pushing the options off the screen, and a broken one
// disappears instead of leaving a torn frame. Nothing here gates answering.
// The scheme is checked here too: upload validation already restricts the
// column, so this is a second line rather than the only one, and the Milestone 2
// editor is a second way into the same column. TheoryLink carries the same
// check for a stronger reason: an <a href> is where a javascript: URL runs.
export function QuestionImage({ src }: { src: string }) {
  const [broken, setBroken] = useState(false)
  const safe = httpUrlOrNull(src)
  if (!safe) return null
  if (broken) return null

  return (
    // next/image would need every remote host allow-listed before a quiz with
    // an image could render at all, and the host set is whatever authors type.
    // biome-ignore lint/performance/noImgElement: author-supplied remote URL
    <img
      src={safe}
      // Empty on purpose: the prompt carries the meaning, and an author-written
      // alt does not exist in the schema.
      alt=""
      decoding="async"
      onError={() => setBroken(true)}
      className="max-h-64 w-full object-contain object-left"
    />
  )
}
