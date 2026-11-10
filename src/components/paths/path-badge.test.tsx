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
})
