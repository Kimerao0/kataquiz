import { screen } from '@testing-library/react'
import type { PathPlacement } from '@/lib/paths/queries'
import { renderWithMessages } from '@/test/intl'
import { PathPlacements } from './path-placements'

const before = { position: 1, quizId: 'id-1', quizSlug: 'react-basics', quizTitle: 'React basics' }
const after = {
  position: 3,
  quizId: 'id-3',
  quizSlug: 'react-perf',
  quizTitle: 'React performance',
}

const middle: PathPlacement = {
  pathSlug: 'road-to-react',
  pathTitle: 'Road to React',
  position: 2,
  total: 3,
  previous: before,
  next: after,
}

describe('PathPlacements', () => {
  it('renders nothing when the quiz is in no path', () => {
    const { container } = renderWithMessages(<PathPlacements placements={[]} />)

    expect(container).toBeEmptyDOMElement()
  })

  it('links the path, the previous step and the next step', () => {
    renderWithMessages(<PathPlacements placements={[middle]} />)

    expect(screen.getByRole('link', { name: 'Step 2 of 3 in Road to React' })).toHaveAttribute(
      'href',
      '/p/road-to-react',
    )
    expect(screen.getByRole('link', { name: 'Previous: React basics' })).toHaveAttribute(
      'href',
      '/q/react-basics/run?path=road-to-react',
    )
    expect(screen.getByRole('link', { name: 'Next: React performance' })).toHaveAttribute(
      'href',
      '/q/react-perf/run?path=road-to-react',
    )
  })

  it('omits the previous link on the first step', () => {
    renderWithMessages(<PathPlacements placements={[{ ...middle, position: 1, previous: null }]} />)

    expect(screen.queryByRole('link', { name: /^Previous/ })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /^Next/ })).toBeInTheDocument()
  })

  it('omits the next link on the last step', () => {
    renderWithMessages(<PathPlacements placements={[{ ...middle, position: 3, next: null }]} />)

    expect(screen.queryByRole('link', { name: /^Next/ })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /^Previous/ })).toBeInTheDocument()
  })

  it('renders one line per path', () => {
    renderWithMessages(
      <PathPlacements
        placements={[middle, { ...middle, pathSlug: 'web-basics', pathTitle: 'Web basics' }]}
      />,
    )

    expect(screen.getByRole('link', { name: 'Step 2 of 3 in Web basics' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Step 2 of 3 in Road to React' })).toBeInTheDocument()
  })
})
