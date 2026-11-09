const TAG_SLUG_MAX_LENGTH = 40

// Tags are user-supplied, so only a reduced form of one is fit for a
// Content-Disposition header. A tag with nothing left after reduction drops
// out of the name instead of inventing a placeholder.
function tagSlug(tag: string): string {
  return (
    tag
      .normalize('NFD')
      // The combining marks NFD split off: 'è' becomes 'e' plus one of these.
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .slice(0, TAG_SLUG_MAX_LENGTH)
      .replace(/^-+|-+$/g, '')
  )
}

// The date is the UTC one, the same day exportedAt carries inside the file.
export function mistakesExportFilename(tag: string | null, now: Date): string {
  const date = now.toISOString().slice(0, 10)
  const slug = tag ? tagSlug(tag) : ''
  if (!slug) return `kataquiz-mistakes-${date}.json`
  return `kataquiz-mistakes-${slug}-${date}.json`
}
