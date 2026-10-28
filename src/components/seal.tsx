// A hanko: the mark that says a thing is approved, or that it is final. Pure
// decoration for assistive tech, so it is hidden from them; the words next to
// it carry the meaning. `color` picks the ink: ai for approval, suo for
// something that went wrong.
export function Seal({
  glyph,
  size,
  color = 'ai',
  page = false,
}: {
  glyph: string
  size?: string
  color?: 'ai' | 'suo'
  // A page-level seal tells the header to drop its own: one per page.
  page?: boolean
}) {
  return (
    <span
      aria-hidden
      className="seal"
      data-length={Math.min(glyph.length, 3)}
      data-page-seal={page ? '' : undefined}
      style={
        {
          '--seal-size': size,
          '--seal-color': `var(--${color})`,
        } as React.CSSProperties
      }
    >
      <span>{glyph}</span>
    </span>
  )
}
