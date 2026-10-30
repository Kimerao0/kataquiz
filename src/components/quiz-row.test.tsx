import { screen } from '@testing-library/react'
import type { QuizSummary } from '@/lib/quizzes/search'
import { renderWithMessages } from '@/test/intl'
import { QuizRow } from './quiz-row'

const quiz: QuizSummary = {
  id: 'quiz-1',
  slug: 'ts-basics',
  title: 'TypeScript basics',
  description: 'Types, generics and narrowing.',
  tags: ['typescript'],
  questionCount: 12,
  questionsPerRun: 10,
  maxErrors: 3,
  timePerQuestionSec: null,
  authorName: 'Ada Lovelace',
  createdAt: new Date('2026-01-01T00:00:00Z'),
}

describe('quiz row', () => {
  it('shows no tier mark when the player has no best tier', () => {
    const { container } = renderWithMessages(<QuizRow quiz={quiz} />)

    expect(screen.queryByText(/Your best/)).not.toBeInTheDocument()
    expect(container.querySelector('svg[class*="text-tier-"]')).not.toBeInTheDocument()
  })

  it('shows the tier mark when a tier is given', () => {
    renderWithMessages(<QuizRow quiz={quiz} tier="gold" />)

    expect(screen.getByText('Your best: Gold')).toBeInTheDocument()
  })
})
