import { screen } from '@testing-library/react'
import type { PathPlacement } from '@/lib/paths/queries'
import { renderWithMessages } from '@/test/intl'
import { PathNext } from './path-next'

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
  previous: null,
  next: after,
}

describe('PathNext', () => {
  it('renders nothing without placements', () => {
    const { container } = renderWithMessages(<PathNext placements={[]} />)

    expect(container).toBeEmptyDOMElement()
  })

  it('links the next step keeping the path', () => {
    renderWithMessages(<PathNext placements={[middle]} />)

    expect(
      screen.getByRole('link', { name: 'Next in Road to React: React performance' }),
    ).toHaveAttribute('href', '/q/react-perf/run?path=road-to-react')
  })

  it('points to the path page on the last step', () => {
    renderWithMessages(<PathNext placements={[{ ...middle, next: null }]} />)

    expect(screen.getByRole('link', { name: 'Last step of Road to React' })).toHaveAttribute(
      'href',
      '/p/road-to-react',
    )
  })

  it('renders one line per placement', () => {
    renderWithMessages(
      <PathNext
        placements={[middle, { ...middle, pathSlug: 'web-basics', pathTitle: 'Web basics' }]}
      />,
    )

    expect(
      screen.getByRole('link', { name: 'Next in Road to React: React performance' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Next in Web basics: React performance' }),
    ).toBeInTheDocument()
  })
})
