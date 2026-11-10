import { screen } from '@testing-library/react'
import type { PathCard } from '@/lib/paths/queries'
import { renderWithMessages } from '@/test/intl'
import { PathCardView } from './path-card-view'

const card: PathCard = {
  slug: 'road-to-react',
  title: 'Road to React',
  stepCount: 3,
  quizIds: ['id-1', 'id-2', 'id-3'],
}

describe('PathCardView', () => {
  it('shows the title as a link to the path, with the step count', () => {
    renderWithMessages(<PathCardView card={card} tier={null} />)

    expect(screen.getByRole('link', { name: 'Road to React' })).toHaveAttribute(
      'href',
      '/p/road-to-react',
    )
    expect(screen.getByText('3 steps')).toBeInTheDocument()
  })

  it('shows a tier ribbon only when a tier is given', () => {
    const { unmount } = renderWithMessages(<PathCardView card={card} tier={null} />)
    expect(screen.queryByText(/Your best/)).not.toBeInTheDocument()
    unmount()

    renderWithMessages(<PathCardView card={card} tier="gold" />)
    expect(screen.getByText('Your best: Gold')).toBeInTheDocument()
  })
})
