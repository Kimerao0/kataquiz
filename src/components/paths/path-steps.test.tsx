import { screen, within } from '@testing-library/react'
import type { LiveStep } from '@/lib/paths/queries'
import { renderWithMessages } from '@/test/intl'
import { PathSteps } from './path-steps'

const steps: LiveStep[] = [
  { position: 1, quizId: 'id-1', quizSlug: 'react-basics', quizTitle: 'React basics' },
  { position: 2, quizId: 'id-2', quizSlug: 'react-hooks', quizTitle: 'React hooks' },
  { position: 3, quizId: 'id-3', quizSlug: 'react-perf', quizTitle: 'React performance' },
]

describe('PathSteps', () => {
  it('links every step to its run with the path, in order', () => {
    renderWithMessages(<PathSteps pathSlug="road-to-react" steps={steps} />)

    const hrefs = screen.getAllByRole('link').map((link) => link.getAttribute('href'))

    expect(hrefs).toEqual([
      '/q/react-basics/run?path=road-to-react',
      '/q/react-hooks/run?path=road-to-react',
      '/q/react-perf/run?path=road-to-react',
    ])
  })

  it('shows the position and the title on each row', () => {
    renderWithMessages(<PathSteps pathSlug="road-to-react" steps={steps} />)

    const rows = screen.getAllByRole('listitem')

    expect(rows).toHaveLength(3)
    steps.forEach((step, index) => {
      const row = within(rows[index])
      expect(row.getByText(step.quizTitle)).toBeInTheDocument()
      expect(row.getByText(new RegExp(`\\b${step.position}\\b`))).toBeInTheDocument()
    })
  })
})
