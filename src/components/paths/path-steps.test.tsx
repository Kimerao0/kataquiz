import { screen, within } from '@testing-library/react'
import type { LiveStep } from '@/lib/paths/queries'
import type { Tier } from '@/lib/run/engine'
import { renderWithMessages } from '@/test/intl'
import { PathSteps } from './path-steps'

const steps: LiveStep[] = [
  { position: 1, quizId: 'id-1', quizSlug: 'react-basics', quizTitle: 'React basics' },
  { position: 2, quizId: 'id-2', quizSlug: 'react-hooks', quizTitle: 'React hooks' },
  { position: 3, quizId: 'id-3', quizSlug: 'react-perf', quizTitle: 'React performance' },
]

describe('PathSteps', () => {
  it('links every step to its run with the path, in order', () => {
    renderWithMessages(<PathSteps pathSlug="road-to-react" steps={steps} tiers={null} />)

    const hrefs = screen.getAllByRole('link').map((link) => link.getAttribute('href'))

    expect(hrefs).toEqual([
      '/q/react-basics/run?path=road-to-react',
      '/q/react-hooks/run?path=road-to-react',
      '/q/react-perf/run?path=road-to-react',
    ])
  })

  it('shows the position and the title on each row', () => {
    renderWithMessages(<PathSteps pathSlug="road-to-react" steps={steps} tiers={null} />)

    const rows = screen.getAllByRole('listitem')

    expect(rows).toHaveLength(3)
    steps.forEach((step, index) => {
      const row = within(rows[index])
      expect(row.getByText(step.quizTitle)).toBeInTheDocument()
      expect(row.getByText(new RegExp(`\\b${step.position}\\b`))).toBeInTheDocument()
    })
  })

  it('marks steps to do, to perfect and perfected from the tiers, with ribbons on the passed ones', () => {
    const tiers = new Map<string, Tier>([
      ['id-1', 'gold'],
      ['id-2', 'silver'],
    ])

    renderWithMessages(<PathSteps pathSlug="road-to-react" steps={steps} tiers={tiers} />)

    const [first, second, third] = screen.getAllByRole('listitem').map((row) => within(row))
    expect(first.getByText('perfected')).toBeInTheDocument()
    expect(first.getByText('Your best: Gold')).toBeInTheDocument()
    expect(second.getByText('to perfect')).toBeInTheDocument()
    expect(second.getByText('Your best: Silver')).toBeInTheDocument()
    expect(third.getByText('to do')).toBeInTheDocument()
    expect(third.queryByText(/Your best/)).not.toBeInTheDocument()
  })

  it('shows no status or ribbon for a guest', () => {
    renderWithMessages(<PathSteps pathSlug="road-to-react" steps={steps} tiers={null} />)

    expect(screen.queryByText('to do')).not.toBeInTheDocument()
    expect(screen.queryByText('to perfect')).not.toBeInTheDocument()
    expect(screen.queryByText('perfected')).not.toBeInTheDocument()
    expect(screen.queryByText(/Your best/)).not.toBeInTheDocument()
  })
})
