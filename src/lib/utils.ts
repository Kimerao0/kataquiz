import { createCn } from 'cn/config'

/**
 * Custom font sizes from the `@theme` block in globals.css (--text-*).
 * Without this, tailwind-merge reads `text-title` as a text colour and drops it
 * whenever a colour follows (or drops the colour when a size does). The test in
 * utils.test.ts checks this list against globals.css.
 */
export const CUSTOM_TEXT_SIZES = [
  'question',
  'prose',
  'meta',
  'title',
  'display',
  'display-user',
] as const

export const cn = createCn({
  extend: {
    classGroups: {
      'font-size': [{ text: [...CUSTOM_TEXT_SIZES] }],
    },
  },
})
