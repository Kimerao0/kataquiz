import { screen } from '@testing-library/react'
import type { LiveStep } from '@/lib/paths/queries'
import type { Tier } from '@/lib/run/engine'
import { renderWithMessages } from '@/test/intl'
import { PathProgress } from './path-progress'

const steps: LiveStep[] = [
  { position: 1, quizId: 'id-1', quizSlug: 'react-basics', quizTitle: 'React basics' },
  { position: 2, quizId: 'id-2', quizSlug: 'react-hooks', quizTitle: 'React hooks' },
  { position: 3, quizId: 'id-3', quizSlug: 'react-perf', quizTitle: 'React performance' },
]

function tiersOf(...entries: Tier[]) {
  return new Map(entries.map((tier, index) => [`id-${index + 1}`, tier]))
}

function renderProgress(tiers: Map<string, Tier> | null) {
  renderWithMessages(<PathProgress pathSlug="road-to-react" steps={steps} tiers={tiers} />)
}

describe('PathProgress', () => {
  it('shows the done, perfected and left counts for a mix', () => {
    renderProgress(tiersOf('gold', 'bronze'))

    expect(screen.getByText('2 done · 1 perfected · 1 left')).toBeInTheDocument()
  })

  it('shows a bronze path ribbon when every step is passed and the weakest is bronze', () => {
    renderProgress(tiersOf('gold', 'silver', 'bronze'))

    expect(screen.getByText('Your best: Bronze')).toBeInTheDocument()
  })

  it('shows no path ribbon while a step is unpassed', () => {
    renderProgress(tiersOf('gold', 'gold'))

    expect(screen.queryByText(/Your best/)).not.toBeInTheDocument()
  })

  it('shows a gold path ribbon when every step is gold', () => {
    renderProgress(tiersOf('gold', 'gold', 'gold'))

    expect(screen.getByText('Your best: Gold')).toBeInTheDocument()
  })

  it('shows a silver path ribbon when the weakest step is silver', () => {
    renderProgress(tiersOf('gold', 'silver', 'gold'))

    expect(screen.getByText('Your best: Silver')).toBeInTheDocument()
  })

  it('continues to step 3 when steps 1 and 2 are passed', () => {
    renderProgress(tiersOf('gold', 'bronze'))

    expect(screen.getByRole('link', { name: 'Continue' })).toHaveAttribute(
      'href',
      '/q/react-perf/run?path=road-to-react',
    )
  })

  it('offers Perfect next to step 2 when all are passed and step 2 is the first below gold', () => {
    renderProgress(tiersOf('gold', 'silver', 'bronze'))

    expect(screen.getByRole('link', { name: 'Perfect next' })).toHaveAttribute(
      'href',
      '/q/react-hooks/run?path=road-to-react',
    )
    expect(screen.queryByRole('link', { name: 'Continue' })).not.toBeInTheDocument()
  })

  it('shows no button when every step is gold', () => {
    renderProgress(tiersOf('gold', 'gold', 'gold'))

    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('shows a guest no progress line or ribbon, and Continue to the first step', () => {
    renderProgress(null)

    expect(screen.queryByText(/ done · /)).not.toBeInTheDocument()
    expect(screen.queryByText(/Your best/)).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Continue' })).toHaveAttribute(
      'href',
      '/q/react-basics/run?path=road-to-react',
    )
  })
})
