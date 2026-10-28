import { screen } from '@testing-library/react'
import { renderWithMessages } from '@/test/intl'
import NotFound from './not-found'

describe('not found page', () => {
  it('explains the dead link and offers the catalog', () => {
    renderWithMessages(<NotFound />)

    expect(screen.getByRole('heading', { name: 'That link leads nowhere' })).toBeVisible()
    // The copy has to fit all four causes of a 404 here, so it names the two
    // most likely ones rather than guessing at one.
    expect(screen.getByText(/challenge link/)).toBeVisible()
    expect(screen.getByText(/removed/)).toBeVisible()
    expect(screen.getByRole('link', { name: 'Browse quizzes' })).toHaveAttribute('href', '/')
  })
})
