import { screen } from '@testing-library/react'
import type { PathPlacement } from '@/lib/paths/queries'
import { renderWithMessages } from '@/test/intl'
import { PathBadge } from './path-badge'

const placement = (pathSlug: string, pathTitle: string, position: number): PathPlacement => ({
  pathSlug,
  pathTitle,
  position,
  total: 4,
  previous: null,
  next: null,
})

describe('PathBadge', () => {
  it('renders nothing when the quiz is in no path', () => {
    const { container } = renderWithMessages(<PathBadge placements={[]} />)

    expect(container).toBeEmptyDOMElement()
  })

  it('shows the first path with the position, linking to it', () => {
    renderWithMessages(<PathBadge placements={[placement('road-to-react', 'Road to React', 2)]} />)

    expect(screen.getByRole('link', { name: 'Road to React · 2/4' })).toHaveAttribute(
      'href',
      '/p/road-to-react',
    )
    expect(screen.queryByText(/^\+\d/)).not.toBeInTheDocument()
  })

  it('adds +N when the quiz is in more paths', () => {
    renderWithMessages(
      <PathBadge
        placements={[
          placement('road-to-react', 'Road to React', 2),
          placement('web-basics', 'Web basics', 1),
          placement('frontend', 'Frontend', 3),
        ]}
      />,
    )

    expect(screen.getByRole('link', { name: 'Road to React · 2/4' })).toBeInTheDocument()
    expect(screen.getByText('+2')).toBeInTheDocument()
  })

  it('lifts the link above the row stretched link', () => {
    renderWithMessages(<PathBadge placements={[placement('road-to-react', 'Road to React', 2)]} />)

    const link = screen.getByRole('link', { name: 'Road to React · 2/4' })
    expect(link).toHaveClass('relative')
    expect(link).toHaveClass('z-10')
  })

  it('labels +N for screen readers, hiding the visible text from them', () => {
    renderWithMessages(
      <PathBadge
        placements={[
          placement('road-to-react', 'Road to React', 2),
          placement('web-basics', 'Web basics', 1),
          placement('frontend', 'Frontend', 3),
        ]}
      />,
    )

    expect(screen.getByText('2 more paths')).toBeInTheDocument()
    expect(screen.getByText('+2')).toHaveAttribute('aria-hidden', 'true')
  })

  it('uses the singular label for one more path', () => {
    renderWithMessages(
      <PathBadge
        placements={[
          placement('road-to-react', 'Road to React', 2),
          placement('web-basics', 'Web basics', 1),
        ]}
      />,
    )

    expect(screen.getByText('1 more path')).toBeInTheDocument()
  })
})
