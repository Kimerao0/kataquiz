import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithMessages } from '@/test/intl'
import AppError from './error'

describe('error page', () => {
  it('offers a retry that runs and a way home', async () => {
    const retry = vi.fn()
    renderWithMessages(<AppError retry={retry} />)

    expect(screen.getByRole('heading', { name: 'This page did not load' })).toBeVisible()
    expect(screen.getByRole('link', { name: 'Browse quizzes' })).toHaveAttribute('href', '/')

    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))

    expect(retry).toHaveBeenCalledTimes(1)
  })

  it('says nothing about the thrown error itself', () => {
    renderWithMessages(<AppError retry={vi.fn()} />)

    // The component takes no `error` prop at all, so there is no path for a
    // digest or a stack to reach the page. This pins the copy that replaces it.
    expect(screen.getByText(/Something broke on our side/)).toBeVisible()
  })
})
