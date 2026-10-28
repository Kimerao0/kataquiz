import { screen } from '@testing-library/react'
import { parseQuizText } from '@/lib/quiz-schema'
import { renderWithMessages } from '@/test/intl'
import { FormatHelp } from './format-help'

describe('upload format help', () => {
  it('is collapsed until the author opens it', () => {
    const { container } = renderWithMessages(<FormatHelp />)

    const details = container.querySelector('details')
    expect(details).not.toBeNull()
    expect(details).not.toHaveAttribute('open')
    // The summary is the keyboard handle, and it is in the document rather
    // than hidden with the rest of the panel.
    expect(screen.getByText('What does a quiz file look like?')).toBeVisible()
  })

  it('shows an example that the real schema accepts', () => {
    const { container } = renderWithMessages(<FormatHelp />)

    const example = container.querySelector('code')?.textContent ?? ''
    // The parser the upload action runs, not a copy of it: an example that has
    // drifted from the schema fails here rather than on an author's first try.
    const parsed = parseQuizText(example)

    expect(parsed.ok ? [] : parsed.errors).toEqual([])
    expect(parsed.ok).toBe(true)
    // One of each type, so the example answers the three shapes a question can
    // take rather than only the common one.
    expect(example).toContain('type: single')
    expect(example).toContain('type: multi')
    expect(example).toContain('type: boolean')
    expect(example).toContain('explanation:')
  })
})
